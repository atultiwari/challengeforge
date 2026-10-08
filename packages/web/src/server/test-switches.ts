import 'server-only'

/**
 * End-to-end tests sign up many accounts in seconds, which the rate limiters
 * rightly refuse. This switch relaxes them for TEST RUNS ONLY: it is ignored
 * whenever NODE_ENV is production, so it can never weaken a live site.
 */
export const rateLimitsDisabledForTests = (): boolean =>
  process.env.NODE_ENV !== 'production' && process.env['DISABLE_RATE_LIMITS_FOR_TESTS'] === 'true'
