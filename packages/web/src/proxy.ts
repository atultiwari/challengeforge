import { NextResponse, type NextRequest } from 'next/server'
import { buildCsp, newNonce } from '@/lib/csp'

/**
 * Runs before every page and API route: attaches a per-request CSP nonce.
 * Authorisation is NOT decided here; every page and handler checks the
 * caller's scope itself.
 */
export function proxy(request: NextRequest) {
  const csp = buildCsp(newNonce(), {
    isDev: process.env.NODE_ENV === 'development',
    https: (process.env.APP_URL ?? '').startsWith('https://'),
  })
  const requestHeaders = new Headers(request.headers)
  requestHeaders.set('Content-Security-Policy', csp)
  const response = NextResponse.next({ request: { headers: requestHeaders } })
  response.headers.set('Content-Security-Policy', csp)
  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
