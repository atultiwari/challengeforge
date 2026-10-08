import { toNextJsHandler } from 'better-auth/next-js'
import { auth } from '@/server/auth'
import { fail, sameOrigin } from '@/server/http'
import { clientIp, createRateLimiter } from '@/lib/rate-limit'
import { rateLimitsDisabledForTests } from '@/server/test-switches'
import { currentSettings } from '@/server/site-settings'

const handlers = toNextJsHandler((request: Request) => auth().handler(request))

/**
 * Our own guard in front of Better Auth for credential endpoints: an explicit
 * same-origin check, and a per-address limit keyed on the proxy-appended
 * address (Better Auth's own limiter may trust a client-supplied header).
 */
const credentialLimiter = createRateLimiter(10, 60_000)
const CREDENTIAL_PATHS = [
  '/api/auth/sign-in/email',
  '/api/auth/sign-up/email',
  // These send mail or spend a token: limit them like sign-in, so they cannot be used to flood an inbox.
  '/api/auth/request-password-reset',
  '/api/auth/reset-password',
  '/api/auth/send-verification-email',
]

export const GET = handlers.GET

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) return fail(403, 'bad_origin', 'Request refused.')
  const { pathname } = new URL(request.url)
  if (CREDENTIAL_PATHS.includes(pathname) && !rateLimitsDisabledForTests() && !credentialLimiter.allow(clientIp(request.headers))) {
    return fail(429, 'rate_limited', 'Too many attempts. Wait a minute and try again.')
  }
  if (pathname === '/api/auth/sign-up/email' && !(await currentSettings()).signupsOpen) {
    return fail(403, 'signups_closed', 'This site is not taking new accounts. Ask the site administrator.')
  }
  return handlers.POST(request)
}
