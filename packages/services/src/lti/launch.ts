/**
 * The LTI 1.3 launch, tool side (OpenID Connect third-party initiated login):
 *   1. the platform calls our login URL; we answer with a redirect to its
 *      auth URL carrying a fresh state and nonce (state also set as a cookie);
 *   2. the platform posts an id_token to our launch URL; we check the state
 *      (single use, matches the cookie), the signature (platform JWKS), issuer,
 *      audience, nonce, expiry, version and deployment.
 * Only a launch that passes every check reaches the caller.
 */
import { createRemoteJWKSet, decodeJwt, errors, jwtVerify, type JWTVerifyGetKey } from 'jose'
import { consumeLtiState, createLtiState, findPlatformForLogin, getPlatform, type Db, type LtiPlatform } from '@challengeforge/db'
import { CLAIM, LaunchPayload } from './claims'
import { LTI_ALG } from './keys'

export class LtiLaunchError extends Error {
  constructor(
    readonly code: 'unknown_platform' | 'bad_state' | 'bad_token' | 'bad_claims' | 'bad_deployment',
    message: string,
  ) {
    super(message)
    this.name = 'LtiLaunchError'
  }
}

export interface LoginParams {
  iss: string
  login_hint: string
  target_link_uri: string
  lti_message_hint?: string
  client_id?: string
}

/** Builds the redirect to the platform's auth endpoint. */
export async function startLogin(db: Db, siteId: string, appUrl: string, params: LoginParams): Promise<{ redirectUrl: string; state: string }> {
  const platform = await findPlatformForLogin(db, siteId, params.iss, params.client_id)
  if (!platform) throw new LtiLaunchError('unknown_platform', 'This LMS is not registered with this site.')
  const { state, nonce } = await createLtiState(db, siteId, platform.id)
  const url = new URL(platform.authLoginUrl)
  const query: Record<string, string> = {
    scope: 'openid',
    response_type: 'id_token',
    response_mode: 'form_post',
    prompt: 'none',
    client_id: platform.clientId,
    redirect_uri: `${appUrl}/lti/launch`,
    login_hint: params.login_hint,
    state,
    nonce,
    ...(params.lti_message_hint ? { lti_message_hint: params.lti_message_hint } : {}),
  }
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v)
  return { redirectUrl: url.href, state }
}

/** Remote key sets, one per platform URL, reused across launches (jose caches and refreshes keys). */
const remoteKeySets = new Map<string, JWTVerifyGetKey>()
export const remoteJwks = (url: string): JWTVerifyGetKey => {
  let set = remoteKeySets.get(url)
  if (!set) {
    set = createRemoteJWKSet(new URL(url), { timeoutDuration: 10_000 })
    remoteKeySets.set(url, set)
  }
  return set
}

export interface VerifiedLaunch {
  platform: LtiPlatform
  payload: LaunchPayload
}

export interface LaunchInput {
  idToken: string
  state: string
  /** The state cookie set at login; must match (login CSRF). */
  cookieState: string | undefined
}

export async function verifyLaunch(
  db: Db,
  siteId: string,
  input: LaunchInput,
  options: { jwksFor?: (url: string) => JWTVerifyGetKey; now?: Date } = {},
): Promise<VerifiedLaunch> {
  if (!input.cookieState || input.cookieState !== input.state) {
    throw new LtiLaunchError('bad_state', 'This launch could not be matched to its login. Open the activity again from your course (in a new window if your browser blocks cookies).')
  }
  const spent = await consumeLtiState(db, siteId, input.state, options.now)
  if (!spent) throw new LtiLaunchError('bad_state', 'This launch has expired or was already used. Open the activity again from your course.')
  const platform = await getPlatform(db, siteId, spent.platformId)
  if (!platform || !platform.active) throw new LtiLaunchError('unknown_platform', 'This LMS is not registered with this site.')

  let payload: Record<string, unknown>
  try {
    const verified = await jwtVerify(input.idToken, (options.jwksFor ?? remoteJwks)(platform.jwksUrl), {
      issuer: platform.issuer,
      audience: platform.clientId,
      algorithms: [LTI_ALG],
      clockTolerance: 60,
      ...(options.now ? { currentDate: options.now } : {}),
    })
    payload = verified.payload as Record<string, unknown>
  } catch (err) {
    const reason = err instanceof errors.JOSEError ? err.code : 'invalid'
    throw new LtiLaunchError('bad_token', `The launch token was rejected (${reason}).`)
  }
  // Several audiences: the authorised party must be us.
  if (Array.isArray(payload['aud']) && payload['aud'].length > 1 && payload['azp'] !== platform.clientId) {
    throw new LtiLaunchError('bad_token', 'The launch token was issued for a different tool.')
  }
  if (payload['nonce'] !== spent.nonce) throw new LtiLaunchError('bad_token', 'The launch token does not belong to this login.')
  const parsed = LaunchPayload.safeParse(payload)
  if (!parsed.success) throw new LtiLaunchError('bad_claims', `The launch is missing required LTI 1.3 information (${parsed.error.issues[0]?.path.join('.') ?? 'claims'}).`)
  if (!platform.deploymentIds.includes(parsed.data[CLAIM.deploymentId])) {
    throw new LtiLaunchError('bad_deployment', 'This LMS deployment is not registered with this site.')
  }
  return { platform, payload: parsed.data }
}

/** For error pages only: the issuer a token CLAIMS, without trusting it. */
export function unverifiedIssuer(idToken: string): string | null {
  try {
    const iss = decodeJwt(idToken).iss
    return typeof iss === 'string' ? iss : null
  } catch {
    return null
  }
}
