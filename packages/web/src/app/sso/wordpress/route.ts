import { createLtiTicket, linkWpUser, spendSsoJti, wpConnectionForSso } from '@challengeforge/db'
import { open, verifyWordPressToken, WordPressSsoError } from '@challengeforge/services'
import { safeNext } from '@/lib/safe-next'
import { db } from '@/server/db'
import { readTextCapped } from '@/server/http'
import { withinPublicLimit } from '@/server/limits'
import { field, handOffToSession, ltiError, ltiSecret } from '@/server/lti'
import { siteContextForRequest } from '@/server/site'

/**
 * WordPress single sign-on: the plugin's form posts a short-lived signed
 * token here. Verified (signature, issuer, audience, expiry, single use),
 * the WordPress user is signed in as their linked account and sent on.
 */
export async function POST(request: Request) {
  if (!withinPublicLimit('ltiLaunch', request)) return ltiError('Too many requests. Wait a minute and try again.', 429)
  const body = await readTextCapped(request, 16 * 1024)
  if (body === null) return ltiError('The request is too large.', 413)
  const token = field(new URLSearchParams(body), 'token', 4096)
  if (!token) return ltiError('The sign-in from WordPress is missing its token.')
  try {
    const ctx = await siteContextForRequest(request)
    const connection = await wpConnectionForSso(db(), ctx.site.id)
    if (!connection) return ltiError('This site is not connected to a WordPress site.', 404)
    const signOn = await verifyWordPressToken(token, { secret: open(connection.secretSealed, ltiSecret()), issuer: connection.wpUrl, audience: ctx.baseUrl })
    if (!(await spendSsoJti(db(), signOn.jti, signOn.expiresAt))) return ltiError('This sign-in link was already used. Go back to WordPress and click it again.')
    const userId = await linkWpUser(db(), ctx.site.id, signOn.wpUserId, signOn.name)
    return handOffToSession(await createLtiTicket(db(), ctx.site.id, userId), safeNext(signOn.next))
  } catch (err) {
    if (err instanceof WordPressSsoError) return ltiError(err.message)
    console.error('[sso] WordPress sign-on failed', err)
    return ltiError('Something went wrong signing you in. Please try again.', 500)
  }
}
