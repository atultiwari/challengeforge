import { LtiLaunchError, startLogin } from '@challengeforge/services'
import { db } from '@/server/db'
import { env } from '@/server/env'
import { field, ltiError, stateCookie } from '@/server/lti'
import { readTextCapped } from '@/server/http'
import { currentSite } from '@/server/scope'
import { withinPublicLimit } from '@/server/limits'

/** OIDC third-party-initiated login: the LMS calls this first (GET or POST). */
async function handle(params: URLSearchParams): Promise<Response> {
  const iss = field(params, 'iss', 255)
  const loginHint = field(params, 'login_hint')
  const target = field(params, 'target_link_uri', 2048)
  if (!iss || !loginHint || !target) return ltiError('The LMS did not send a complete login request (iss, login_hint, target_link_uri).')
  const messageHint = field(params, 'lti_message_hint')
  const clientId = field(params, 'client_id', 255)
  try {
    const site = await currentSite()
    const { redirectUrl, state } = await startLogin(db(), site.id, env().APP_URL, {
      iss,
      login_hint: loginHint,
      target_link_uri: target,
      ...(messageHint ? { lti_message_hint: messageHint } : {}),
      ...(clientId ? { client_id: clientId } : {}),
    })
    return new Response(null, { status: 302, headers: { location: redirectUrl, 'set-cookie': stateCookie(state), 'cache-control': 'no-store' } })
  } catch (err) {
    if (err instanceof LtiLaunchError) return ltiError(err.message)
    throw err
  }
}

const TOO_MANY = () => ltiError('Too many requests. Wait a minute and open the activity again.', 429)

export async function GET(request: Request) {
  if (!withinPublicLimit('ltiLogin', request)) return TOO_MANY()
  return handle(new URL(request.url).searchParams)
}

export async function POST(request: Request) {
  if (!withinPublicLimit('ltiLogin', request)) return TOO_MANY()
  const body = await readTextCapped(request, 16 * 1024)
  if (body === null) return ltiError('The login request is too large.', 413)
  return handle(new URLSearchParams(body))
}
