import { describe, expect, it } from 'vitest'
import { servicesConfigFromEnv } from '../src/config'

const base = { BETTER_AUTH_SECRET: 'x'.repeat(40) }

describe('servicesConfigFromEnv', () => {
  it('uses the mock model by default in development', () => {
    expect(servicesConfigFromEnv({ ...base, NODE_ENV: 'development' }).gateway.llmMock).toBe(true)
  })

  it('refuses to start a production site on canned mock replies unless explicitly allowed', () => {
    expect(() => servicesConfigFromEnv({ ...base, NODE_ENV: 'production' })).toThrow(/LLM_MODE/)
    expect(servicesConfigFromEnv({ ...base, NODE_ENV: 'production', ALLOW_MOCK_LLM_IN_PRODUCTION: 'true' }).gateway.llmMock).toBe(true)
    expect(servicesConfigFromEnv({ ...base, NODE_ENV: 'production', LLM_MODE: 'live', GOOGLE_API_KEY: 'k' }).gateway.llmMock).toBe(false)
  })

  it('derives a canary secret from the auth secret when none is set, and never echoes values in errors', () => {
    expect(servicesConfigFromEnv(base).canarySecret).toMatch(/^[0-9a-f]{64}$/)
    expect(() => servicesConfigFromEnv({ BETTER_AUTH_SECRET: 'short-secret-value' })).toThrow(/BETTER_AUTH_SECRET/)
    expect(() => servicesConfigFromEnv({ BETTER_AUTH_SECRET: 'short-secret-value' })).not.toThrow(/short-secret-value/)
  })
})
