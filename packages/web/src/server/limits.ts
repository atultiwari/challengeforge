import 'server-only'
import type { Scope } from '@challengeforge/db'
import { clientIp, createRateLimiter, type RateLimiter } from '@/lib/rate-limit'
import { rateLimitsDisabledForTests } from './test-switches'

const MINUTE = 60_000

/** Per-person budgets for write endpoints (Better Auth limits its own sign-in routes). */
const LIMITERS: Record<'action' | 'start' | 'author' | 'asset', RateLimiter> = {
  action: createRateLimiter(60, MINUTE),
  start: createRateLimiter(30, MINUTE),
  author: createRateLimiter(60, MINUTE),
  asset: createRateLimiter(120, MINUTE),
}

/** True when this request is within budget. Signed-in users are counted per account, others per address. */
export function withinLimit(kind: keyof typeof LIMITERS, scope: Scope, request: Request): boolean {
  if (rateLimitsDisabledForTests()) return true
  const who = scope.principal ? `u:${scope.principal.userId}` : `ip:${clientIp(request.headers)}`
  return LIMITERS[kind].allow(who)
}
