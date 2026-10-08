import { cookies } from 'next/headers'
import {
  createDeepLinkRequest,
  createLtiTicket,
  getPlayable,
  grantFromSource,
  linkLtiUser,
  listPacks,
  recordLinkUser,
  upsertLtiLink,
  ValidationError,
} from '@challengeforge/db'
import { AGS_SCORE_SCOPE, CLAIM, LtiLaunchError, displayName, isTeachingRole, verifyLaunch, type VerifiedLaunch } from '@challengeforge/services'
import { db } from '@/server/db'
import { env } from '@/server/env'
import { clearStateCookie, escapeHtml, field, LTI_STATE_COOKIE, ltiError, ltiPage, ticketCookie } from '@/server/lti'
import { currentSite } from '@/server/scope'

const MAX_FORM_BYTES = 64 * 1024
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The challenge a resource link launches: the custom parameter, else our own /play/<id> target. */
function challengeOf(launch: VerifiedLaunch): string | null {
  const custom = launch.payload[CLAIM.custom]?.['challenge_id']
  if (typeof custom === 'string' && UUID.test(custom)) return custom
  const target = launch.payload[CLAIM.targetLinkUri]
  if (!target) return null
  const url = new URL(target, env().APP_URL)
  const match = /^\/play\/([0-9a-f-]{36})$/.exec(url.pathname)
  return url.origin === new URL(env().APP_URL).origin && match && UUID.test(match[1]!) ? match[1]! : null
}

/** Hands over to /lti/session (a same-site request, carrying the ticket cookie), which signs in and goes on to `next`. */
function handOff(ticket: string, next: string): Response {
  const url = `/lti/session?next=${encodeURIComponent(next)}`
  return ltiPage('Opening…', `<meta http-equiv="refresh" content="0;url=${escapeHtml(url)}"><p>Opening the activity… <a href="${escapeHtml(url)}">Continue</a></p>`, {
    headers: [
      ['set-cookie', clearStateCookie()],
      ['set-cookie', ticketCookie(ticket)],
    ],
  })
}

async function resourceLaunch(siteId: string, launch: VerifiedLaunch, userId: string): Promise<string> {
  const p = launch.payload
  const link = p[CLAIM.resourceLink]
  if (!link) throw new LtiLaunchError('bad_claims', 'The launch has no resource link.')
  const requested = challengeOf(launch)
  if (!requested) throw new LtiLaunchError('bad_claims', 'This LMS link does not point at a challenge on this site.')
  const ags = p[CLAIM.ags]
  const { linkId, challengeId } = await upsertLtiLink(db(), {
    siteId,
    platformId: launch.platform.id,
    deploymentId: p[CLAIM.deploymentId],
    resourceLinkId: link.id,
    contextId: p[CLAIM.context]?.id ?? null,
    contextTitle: p[CLAIM.context]?.title ?? null,
    challengeId: requested,
    lineitemUrl: ags?.scope.includes(AGS_SCORE_SCOPE) ? (ags.lineitem ?? null) : null,
  })
  await recordLinkUser(db(), linkId, userId, p.sub)
  // A course placement opens a restricted pack for the people it launches.
  const scope = { siteId, principal: { userId, role: 'learner' as const } }
  const challenge = await getPlayable(db(), scope, challengeId)
  if (challenge.packId && (await listPacks(db(), scope)).some((pk) => pk.id === challenge.packId && pk.access === 'restricted')) {
    await grantFromSource(db(), siteId, userId, challenge.packId, 'lti', `${launch.platform.id.slice(0, 8)}:${p[CLAIM.context]?.id ?? link.id}`)
  }
  return `/play/${challengeId}`
}

async function deepLinkingLaunch(siteId: string, launch: VerifiedLaunch, userId: string): Promise<string> {
  const p = launch.payload
  if (!isTeachingRole(p[CLAIM.roles])) throw new LtiLaunchError('bad_claims', 'Only teachers can add activities from this site.')
  const settings = p[CLAIM.deepLinkingSettings]
  if (!settings) throw new LtiLaunchError('bad_claims', 'The LMS did not say where to send the chosen activities.')
  const ret = new URL(settings.deep_link_return_url)
  const local = ret.hostname === 'localhost' || ret.hostname === '127.0.0.1'
  if (ret.protocol !== 'https:' && !(local && ret.protocol === 'http:')) throw new LtiLaunchError('bad_claims', 'The LMS return address must use https.')
  const id = await createDeepLinkRequest(db(), siteId, { platformId: launch.platform.id, deploymentId: p[CLAIM.deploymentId], returnUrl: ret.href, data: settings.data ?? null, userId })
  return `/lti/deep-link/${id}`
}

/** The LMS posts the signed id_token here (form_post). Only a fully verified launch signs anyone in. */
export async function POST(request: Request) {
  if (Number(request.headers.get('content-length') ?? 0) > MAX_FORM_BYTES) return ltiError('The launch request is too large.', 413)
  const form = await request.formData()
  const platformError = field(form, 'error', 200)
  if (platformError) return ltiError(`The LMS reported a problem: ${platformError}.`)
  const idToken = field(form, 'id_token', 32_768)
  const state = field(form, 'state', 64)
  if (!idToken || !state) return ltiError('The launch is missing its token.')
  const cookieState = (await cookies()).get(LTI_STATE_COOKIE)?.value
  try {
    const site = await currentSite()
    const launch = await verifyLaunch(db(), site.id, { idToken, state, cookieState })
    const userId = await linkLtiUser(db(), site.id, launch.platform.id, launch.payload.sub, displayName(launch.payload))
    const next = launch.payload[CLAIM.messageType] === 'LtiDeepLinkingRequest' ? await deepLinkingLaunch(site.id, launch, userId) : await resourceLaunch(site.id, launch, userId)
    return handOff(await createLtiTicket(db(), userId), next)
  } catch (err) {
    if (err instanceof LtiLaunchError || err instanceof ValidationError) return ltiError(err.message)
    console.error('[lti] launch failed', err)
    return ltiError('Something went wrong opening the activity. Please try again.', 500)
  }
}
