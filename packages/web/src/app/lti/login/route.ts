import { LtiLaunchError, startLogin } from '@challengeforge/services'
import { db } from '@/server/db'
import { env } from '@/server/env'
import { field, ltiError, stateCookie } from '@/server/lti'
import { currentSite } from '@/server/scope'

/** OIDC third-party-initiated login: the LMS calls this first (GET or POST). */
async function handle(params: FormData | URLSearchParams): Promise<Response> {
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

export async function GET(request: Request) {
  return handle(new URL(request.url).searchParams)
}

export async function POST(request: Request) {
  return handle(await request.formData())
}
