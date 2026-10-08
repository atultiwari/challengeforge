/**
 * Only same-site relative paths are followed after sign-in (no open
 * redirects). Browsers treat "\\" like "/", so "/\\evil.com" is refused too.
 */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//') || next.includes('\\')) return '/'
  try {
    const url = new URL(next, 'http://same.invalid')
    return url.origin === 'http://same.invalid' ? `${url.pathname}${url.search}` : '/'
  } catch {
    return '/'
  }
}
