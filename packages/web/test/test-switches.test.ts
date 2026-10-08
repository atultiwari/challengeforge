import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const { rateLimitsDisabledForTests } = await import('../src/server/test-switches')

describe('test-only rate-limit switch', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('can never relax limits on a production build', () => {
    vi.stubEnv('DISABLE_RATE_LIMITS_FOR_TESTS', 'true')
    vi.stubEnv('NODE_ENV', 'production')
    expect(rateLimitsDisabledForTests()).toBe(false)
  })

  it('relaxes them only when explicitly switched on outside production', () => {
    vi.stubEnv('NODE_ENV', 'test')
    expect(rateLimitsDisabledForTests()).toBe(false)
    vi.stubEnv('DISABLE_RATE_LIMITS_FOR_TESTS', 'true')
    expect(rateLimitsDisabledForTests()).toBe(true)
  })
})
