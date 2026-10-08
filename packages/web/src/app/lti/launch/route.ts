import { cookies } from 'next/headers'
import {
  createDeepLinkRequest,
  createLtiTicket,
  getPlayable,
  grantFromSource,
  isAllowedOutboundUrl,
  linkLtiUser,
  packAccessMode,
  recordLinkUser,
  upsertLtiLink,
  ValidationError,
} from '@challengeforge/db'
import { AGS_SCORE_SCOPE, CLAIM, LtiLaunchError, displayName, isTeachingRole, verifyLaunch, type VerifiedLaunch } from '@challengeforge/services'
import { db } from '@/server/db'
import { siteContextForRequest } from '@/server/site'
import { clearStateCookie, escapeHtml, field, LTI_STATE_COOKIE, ltiError, ltiPage, ticketCookie } from '@/server/lti'
import { readTextCapped } from '@/server/http'
import { withinPublicLimit } from '@/server/limits'

const MAX_FORM_BYTES = 64 * 1024
/** A course placement keeps a restricted pack open this long after each launch. */
const LTI_GRANT_MS = 180 * 24 * 60 * 60_000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

/** The challenge a resource link launches: the custom parameter, else our own /play/<id> target. */
function challengeOf(launch: VerifiedLaunch, baseUrl: string): string | null {
  const custom = launch.payload[CLAIM.custom]?.['challenge_id']
  if (typeof custom === 'string' && UUID.test(custom)) return custom
  const target = launch.payload[CLAIM.targetLinkUri]
  if (!target) return null
  const url = new URL(target, baseUrl)
  const match = /^\/play\/([0-9a-f-]{36})$/.exec(url.pathname)
  return url.origin === new URL(baseUrl).origin && match && UUID.test(match[1]!) ? match[1]! : null
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

async function resourceLaunch(siteId: string, baseUrl: string, launch: VerifiedLaunch, userId: string): Promise<string> {
  const p = launch.payload
  const link = p[CLAIM.resourceLink]
  if (!link) throw new LtiLaunchError('bad_claims', 'The launch has no resource link.')
  const requested = challengeOf(launch, baseUrl)
  if (!requested) throw new LtiLaunchError('bad_claims', 'This LMS link does not point at a challenge on this site.')
  const ags = p[CLAIM.ags]
  const lineitem = ags?.scope.includes(AGS_SCORE_SCOPE) ? (ags.lineitem ?? null) : null
  const { linkId, challengeId } = await upsertLtiLink(db(), {
    siteId,
    platformId: launch.platform.id,
    deploymentId: p[CLAIM.deploymentId],
    resourceLinkId: link.id,
    contextId: p[CLAIM.context]?.id ?? null,
    contextTitle: p[CLAIM.context]?.title ?? null,
    challengeId: requested,
    // The grade book URL is where this server will send a bearer token: public https only.
    lineitemUrl: lineitem && isAllowedOutboundUrl(lineitem) ? lineitem : null,
  })
  await recordLinkUser(db(), linkId, userId, p.sub)
  // A course placement opens a restricted pack only on an LMS the admin trusts with that (off by default).
  // The grant expires unless launches keep renewing it, and one an admin revoked stays revoked.
  const challenge = await getPlayable(db(), { siteId, principal: { userId, role: 'learner' } }, challengeId)
  if (launch.platform.grantsAccess && challenge.packId && (await packAccessMode(db(), siteId, challenge.packId)) === 'restricted') {
    const ref = `${launch.platform.id.slice(0, 8)}:${p[CLAIM.context]?.id ?? link.id}`
    await grantFromSource(db(), siteId, userId, challenge.packId, 'lti', ref, new Date(Date.now() + LTI_GRANT_MS), { revive: false })
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
  if (!withinPublicLimit('ltiLaunch', request)) return ltiError('Too many requests. Wait a minute and open the activity again.', 429)
  const body = await readTextCapped(request, MAX_FORM_BYTES)
  if (body === null) return ltiError('The launch request is too large.', 413)
  const form = new URLSearchParams(body)
  // Never echo the platform's text: anyone can post here, and our page must not say what they choose.
  if (field(form, 'error', 200)) return ltiError('The LMS could not complete the launch. Open the activity again from your course.')
  const idToken = field(form, 'id_token', 32_768)
  const state = field(form, 'state', 64)
  if (!idToken || !state) return ltiError('The launch is missing its token.')
  const cookieState = (await cookies()).get(LTI_STATE_COOKIE)?.value
  try {
    const ctx = await siteContextForRequest(request)
    const site = ctx.site
    const launch = await verifyLaunch(db(), site.id, { idToken, state, cookieState })
    const userId = await linkLtiUser(db(), site.id, launch.platform.id, launch.payload.sub, displayName(launch.payload))
    const next = launch.payload[CLAIM.messageType] === 'LtiDeepLinkingRequest' ? await deepLinkingLaunch(site.id, launch, userId) : await resourceLaunch(site.id, ctx.baseUrl, launch, userId)
    return handOff(await createLtiTicket(db(), site.id, userId), next)
  } catch (err) {
    if (err instanceof LtiLaunchError || err instanceof ValidationError) return ltiError(err.message)
    console.error('[lti] launch failed', err)
    return ltiError('Something went wrong opening the activity. Please try again.', 500)
  }
}
