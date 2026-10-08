/**
 * Content Security Policy with a fresh nonce per request (set in proxy.ts),
 * harvested from the Lab. Next.js reads the nonce from the request's CSP
 * header and stamps it on its own scripts, so only server-rendered scripts
 * run. Development adds what React's dev tooling needs.
 */
export function buildCsp(nonce: string, options: { isDev: boolean; https: boolean }): string {
  const { isDev, https } = options
  const directives = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? ` 'unsafe-eval'` : ''}`,
    `style-src 'self'${isDev ? ` 'unsafe-inline'` : ` 'nonce-${nonce}'`}`,
    `img-src 'self' blob: data:`,
    `font-src 'self'`,
    `connect-src 'self'${isDev ? ' ws: wss:' : ''}`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    ...(https && !isDev ? ['upgrade-insecure-requests'] : []),
  ]
  return directives.join('; ')
}

/** 128 random bits, base64. */
export function newNonce(): string {
  const bytes = new Uint8Array(16)
  crypto.getRandomValues(bytes)
  return btoa(String.fromCharCode(...bytes))
}
