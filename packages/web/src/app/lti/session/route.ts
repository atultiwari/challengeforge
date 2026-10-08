import { cookies } from 'next/headers'
import { authForRequest } from '@/server/auth'
import { clearTicketCookie, LTI_TICKET_COOKIE, ltiError } from '@/server/lti'
import { safeNext } from '@/lib/safe-next'

/** Redeems a launch's one-time ticket for a session, then continues to the activity. */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const ticket = (await cookies()).get(LTI_TICKET_COOKIE)?.value ?? ''
  const next = safeNext(url.searchParams.get('next'))
  let signedIn: Response
  try {
    signedIn = await (await authForRequest(request)).api.ltiSignIn({ body: { ticket }, headers: request.headers, asResponse: true })
  } catch {
    return ltiError('This sign-in link has expired. Open the activity again from your course.', 401)
  }
  if (!signedIn.ok) return ltiError('This sign-in link has expired. Open the activity again from your course.', 401)
  const headers = new Headers({ location: next, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' })
  headers.append('set-cookie', clearTicketCookie())
  for (const cookie of signedIn.headers.getSetCookie()) headers.append('set-cookie', cookie)
  return new Response(null, { status: 303, headers })
}
