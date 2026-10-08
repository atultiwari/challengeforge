import { describe, expect, it } from 'vitest'
import { buildCsp, newNonce } from '../src/lib/csp'
import { clientIp, createRateLimiter } from '../src/lib/rate-limit'

describe('CSP', () => {
  it('allows only nonce-stamped scripts in production and blocks framing', () => {
    const csp = buildCsp('abc', { isDev: false, https: true })
    expect(csp).toContain(`script-src 'self' 'nonce-abc' 'strict-dynamic'`)
    expect(csp).not.toContain('unsafe-eval')
    expect(csp).not.toContain('unsafe-inline')
    expect(csp).toContain(`frame-ancestors 'none'`)
    expect(csp).toContain('upgrade-insecure-requests')
  })

  it('does not force https on a plain-http install', () => {
    expect(buildCsp('abc', { isDev: false, https: false })).not.toContain('upgrade-insecure-requests')
  })

  it('makes a different nonce every time', () => {
    expect(newNonce()).not.toBe(newNonce())
  })
})

describe('rate limiter', () => {
  it('allows up to the limit per window, then refuses, then resets', () => {
    const rl = createRateLimiter(2, 1000)
    expect([rl.allow('a', 0), rl.allow('a', 1), rl.allow('a', 2)]).toEqual([true, true, false])
    expect(rl.allow('b', 2)).toBe(true)
    expect(rl.allow('a', 1001)).toBe(true)
  })

  it('bounds its memory by forgetting old keys once full', () => {
    const rl = createRateLimiter(1, 1000, 3)
    for (const k of ['a', 'b', 'c', 'd']) rl.allow(k, 0)
    // 'a' used its one request, but the map overflowed at 'd' and was cleared.
    expect(rl.allow('a', 1)).toBe(true)
  })
})

describe('clientIp', () => {
  it('uses the proxy-appended (last) forwarded address, which a client cannot choose', () => {
    expect(clientIp(new Headers({ 'x-forwarded-for': '6.6.6.6, 10.0.0.1' }))).toBe('10.0.0.1')
    expect(clientIp(new Headers({ 'x-real-ip': '10.0.0.2' }))).toBe('10.0.0.2')
    expect(clientIp(new Headers())).toBe('unknown')
  })
})

describe('safeNext (post-sign-in redirect)', async () => {
  const { safeNext } = await import('../src/lib/safe-next')
  it('keeps same-site paths with their query', () => {
    expect(safeNext('/play/abc?preview=1')).toBe('/play/abc?preview=1')
  })
  it('refuses anything that could leave the site', () => {
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'evil.com', '/\\/evil.com', null, '']) {
      expect(safeNext(bad)).toBe('/')
    }
  })
})
