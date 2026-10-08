/**
 * A small fixed-window rate limiter, in memory (harvested from the Lab). The
 * process may be idled and restarted by the host, which only resets counts:
 * it blunts bursts and scripted abuse, it is not an accounting system.
 */
export interface RateLimiter {
  /** True if this request is allowed; counts it either way. */
  allow(key: string, now?: number): boolean
}

export function createRateLimiter(limit: number, windowMs: number, maxKeys = 10_000): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>()
  return {
    allow(key, now = Date.now()) {
      if (windows.size >= maxKeys) {
        for (const [k, w] of windows) if (now - w.start >= windowMs) windows.delete(k)
        if (windows.size >= maxKeys) windows.clear()
      }
      const current = windows.get(key)
      if (!current || now - current.start >= windowMs) {
        windows.set(key, { start: now, count: 1 })
        return true
      }
      const next = { start: current.start, count: current.count + 1 }
      windows.set(key, next)
      return next.count <= limit
    },
  }
}

/**
 * The client's address as the host's reverse proxy saw it: the LAST
 * X-Forwarded-For entry is the one the proxy added, so a client cannot pick it.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get('x-forwarded-for')
  if (forwarded) {
    const parts = forwarded.split(',').map((p) => p.trim()).filter(Boolean)
    const last = parts[parts.length - 1]
    if (last) return last
  }
  return headers.get('x-real-ip')?.trim() || 'unknown'
}
