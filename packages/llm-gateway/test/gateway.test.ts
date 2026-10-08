import { describe, it, expect, vi, afterEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import { complete } from '../src/gateway'
import type { GatewayCall, Sleep } from '../src/gateway'
import type { GatewayConfig } from '../src/config'
import { LlmUserFacingError } from '../src/errors'
import { encryptSecret } from '../src/credentials/crypto'
import { summariseProviderError } from '../src/user-facing'
import type { LlmStore } from '../src/store'
import { MASTER_KEY, fakeStore, sentHeaders, stubFetch, testConfig } from './helpers'

const call: GatewayCall = {
  userId: 'u1',
  challengeId: 'chat-1',
  purpose: 'chat',
  provider: 'anthropic',
  model: 'claude-haiku-4-5-20251001',
  callCap: 30,
  request: { system: 'test bot', messages: [{ role: 'user', content: 'hi' }], maxTokens: 128 },
}

const run = (c: GatewayCall, store: LlmStore, config: GatewayConfig = testConfig(), sleep?: Sleep) =>
  complete(c, { store, config, ...(sleep ? { sleep } : {}) })

function mockProviderOk(text = 'hello') {
  return stubFetch(200, {
    id: 'msg_1',
    model: 'claude-haiku-4-5-20251001',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text }],
    usage: { input_tokens: 10, output_tokens: 5 },
  })
}

const learnerKeyStore = (extra: Partial<LlmStore> & { used?: number } = {}) => {
  const sealed = encryptSecret('sk-ant-learner', MASTER_KEY)
  return fakeStore({ getCredential: async () => ({ provider: 'anthropic', ...sealed }), ...extra })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('challenge call cap', () => {
  it('allows a call under the cap and reports what is left', async () => {
    mockProviderOk()
    const r = await run(call, fakeStore({ used: 5 }))
    expect(r.callsRemaining).toBe(24)
  })

  it('blocks once the cap is reached', async () => {
    const fetchMock = mockProviderOk()
    await expect(run(call, fakeStore({ used: 30 }))).rejects.toMatchObject({ code: 'call_cap_reached' })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('enforces the cap even when the learner brought their own key', async () => {
    const fetchMock = mockProviderOk()
    await expect(run(call, learnerKeyStore({ used: 30 }))).rejects.toMatchObject({ code: 'call_cap_reached' })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('credential resolution', () => {
  it('prefers the learner key over the platform key', async () => {
    const fetchMock = mockProviderOk()
    const r = await run(call, learnerKeyStore())
    expect(r.credentialSource).toBe('byok')
    expect(sentHeaders(fetchMock)['x-api-key']).toBe('sk-ant-learner')
  })

  it('falls back to the platform key when the learner has none', async () => {
    const fetchMock = mockProviderOk()
    const r = await run(call, fakeStore())
    expect(r.credentialSource).toBe('platform')
    expect(sentHeaders(fetchMock)['x-api-key']).toBe('sk-ant-platform')
  })

  it('ignores a stored key when BYOK is switched off', async () => {
    mockProviderOk()
    const r = await run(call, learnerKeyStore(), testConfig({ byokEnabled: false }))
    expect(r.credentialSource).toBe('platform')
  })

  it('refuses rather than silently charging the platform when a stored key is unreadable', async () => {
    mockProviderOk()
    const sealedWithOtherKey = encryptSecret('sk-ant-learner', randomBytes(32).toString('base64'))
    const store = fakeStore({ getCredential: async () => ({ provider: 'anthropic', ...sealedWithOtherKey }) })
    await expect(run(call, store)).rejects.toMatchObject({ code: 'invalid_key' })
  })

  it('refuses a stored key when BYOK is on but no encryption key is configured', async () => {
    mockProviderOk()
    await expect(run(call, learnerKeyStore(), testConfig({ byokEncryptionKey: null }))).rejects.toMatchObject({
      code: 'invalid_key',
    })
  })

  it('errors clearly when no key exists at all', async () => {
    mockProviderOk()
    await expect(run(call, fakeStore(), testConfig({ platformKeys: {} }))).rejects.toMatchObject({
      code: 'no_credential',
    })
  })

  it('rejects a provider the owner has not enabled', async () => {
    mockProviderOk()
    const config = testConfig({ enabledProviders: ['anthropic'] })
    await expect(run({ ...call, provider: 'openai' }, fakeStore(), config)).rejects.toMatchObject({
      code: 'provider_disabled',
    })
  })
})

describe('rate-limit retry (free-tier keys)', () => {
  const limited = (retryAfter = '1') =>
    new Response(JSON.stringify({ error: { message: `Please retry in ${retryAfter}s` } }), { status: 429 })
  const okBody = () =>
    new Response(
      JSON.stringify({ id: 'm', model: 'claude-haiku-4-5-20251001', content: [{ type: 'text', text: 'hi' }], usage: {} }),
      { status: 200 },
    )
  const retry = { maxAttempts: 3, maxWaitSeconds: 60 }
  const recorder = () => {
    const slept: number[] = []
    const sleep: Sleep = async (ms) => void slept.push(ms)
    return { slept, sleep }
  }

  it('waits the time the provider asks for, then succeeds on one reservation', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(limited('3')).mockResolvedValueOnce(okBody()))
    const { slept, sleep } = recorder()
    const store = fakeStore()
    const r = await run({ ...call, rateLimitRetry: retry }, store, testConfig(), sleep)
    expect(r.text).toBe('hi')
    expect(slept).toEqual([4000])
    expect(store.reserved).toHaveLength(1)
    expect(store.logged).toHaveLength(1)
    expect(store.released).toHaveLength(0)
  })

  it('does not retry unless the caller opted in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => limited()))
    const { slept, sleep } = recorder()
    const store = fakeStore()
    await expect(run(call, store, testConfig(), sleep)).rejects.toMatchObject({ code: 'provider_unavailable' })
    expect(slept).toEqual([])
    expect(store.released).toHaveLength(1)
  })

  it('gives up after maxAttempts and hands the slot back', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => limited('1')))
    const { slept, sleep } = recorder()
    const store = fakeStore()
    await expect(run({ ...call, rateLimitRetry: retry }, store, testConfig(), sleep)).rejects.toThrow()
    expect(slept).toHaveLength(2)
    expect(store.released).toHaveLength(1)
  })

  it('does not hold a learner for a long wait, such as a daily quota', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => limited('3600')))
    const { slept, sleep } = recorder()
    await expect(run({ ...call, rateLimitRetry: retry }, fakeStore(), testConfig(), sleep)).rejects.toThrow()
    expect(slept).toEqual([])
  })

  it('never retries an auth failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad key', { status: 401 })))
    const { slept, sleep } = recorder()
    await expect(run({ ...call, rateLimitRetry: retry }, fakeStore(), testConfig(), sleep)).rejects.toMatchObject({
      code: 'invalid_key',
    })
    expect(slept).toEqual([])
  })

  it('tells a learner on their own key that their key is rate-limited', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => limited()))
    const { sleep } = recorder()
    await expect(run(call, learnerKeyStore(), testConfig(), sleep)).rejects.toThrow(/your api key has reached/i)
  })
})

describe('parallel requests', () => {
  it('cannot take more than the cap when calls race', async () => {
    mockProviderOk()
    const store = fakeStore({ used: 28 })
    const results = await Promise.allSettled([run(call, store), run(call, store), run(call, store)])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(2)
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1)
  })
})

describe('grading calls (platform_only)', () => {
  const judgeCall: GatewayCall = { ...call, purpose: 'judge', billing: 'platform_only' }

  it('uses the platform key even when the learner saved their own', async () => {
    const fetchMock = mockProviderOk()
    const r = await run(judgeCall, learnerKeyStore())
    expect(r.credentialSource).toBe('platform')
    expect(sentHeaders(fetchMock)['x-api-key']).toBe('sk-ant-platform')
  })

  it('is not blocked by the learner budget, only by its own cap', async () => {
    mockProviderOk()
    const store = fakeStore({ sumPlatformCostUsd: async () => 999 })
    await expect(run(judgeCall, store)).resolves.toMatchObject({ credentialSource: 'platform' })
  })

  it('fails closed with an admin-facing message when the platform has no key', async () => {
    mockProviderOk()
    await expect(run(judgeCall, fakeStore(), testConfig({ platformKeys: {} }))).rejects.toThrow(/administrator/i)
  })
})

describe('platform budget', () => {
  it('blocks a platform-funded call once the allowance is spent', async () => {
    mockProviderOk()
    const store = fakeStore({ sumPlatformCostUsd: async () => 2.5 })
    await expect(run(call, store)).rejects.toMatchObject({ code: 'budget_reached' })
  })

  it('does not apply the budget to a learner paying with their own key', async () => {
    mockProviderOk()
    const store = learnerKeyStore({ sumPlatformCostUsd: async () => 999 })
    expect((await run(call, store)).credentialSource).toBe('byok')
  })

  it('is disabled by a budget of zero', async () => {
    mockProviderOk()
    const store = fakeStore({ sumPlatformCostUsd: async () => 999 })
    await expect(run(call, store, testConfig({ platformBudgetUsdPerUser: 0 }))).resolves.toBeTruthy()
  })
})

describe('usage logging', () => {
  it('logs one row per call with normalised tokens', async () => {
    mockProviderOk()
    const store = fakeStore()
    await run(call, store)
    expect(store.logged).toHaveLength(1)
    expect(store.logged[0]).toMatchObject({
      userId: 'u1',
      challengeId: 'chat-1',
      provider: 'anthropic',
      purpose: 'chat',
      credentialSource: 'platform',
      inputTokens: 10,
      outputTokens: 5,
    })
  })

  it('logs BYOK calls too, so cost measurement stays complete', async () => {
    mockProviderOk()
    const store = learnerKeyStore()
    await run(call, store)
    expect(store.logged[0]?.credentialSource).toBe('byok')
  })

  it('records a null cost for a model with no price rather than guessing', async () => {
    mockProviderOk()
    const store = fakeStore()
    await run({ ...call, model: 'claude-unpriced-test' }, store)
    expect(store.logged[0]?.costEstimateUsd).toBeNull()
  })

  it('does not log when the provider call failed, and hands the slot back', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('boom', { status: 500 })))
    const store = fakeStore({ used: 29 })
    await expect(run(call, store)).rejects.toThrow()
    expect(store.logged).toHaveLength(0)
    expect(store.released).toEqual(['r30'])
    // The failed call cost nothing: the learner can still make their 30th call.
    mockProviderOk()
    await expect(run(call, store)).resolves.toMatchObject({ callsRemaining: 0 })
  })

  it('records the credential source on the reservation', async () => {
    mockProviderOk()
    const store = fakeStore()
    await run(call, store)
    expect(store.reserved[0]).toMatchObject({ purpose: 'chat', cap: 30, credentialSource: 'platform' })
  })

  it('prices the call by the requested model, not the snapshot name the provider echoes', async () => {
    mockProviderOk()
    const store = fakeStore()
    await run(call, store)
    // Haiku 4.5: $1 in / $5 out per million tokens; 10 in + 5 out.
    expect(store.logged[0]?.costEstimateUsd).toBeCloseTo((10 * 1 + 5 * 5) / 1e6, 12)
  })
})

describe('development mock', () => {
  it('answers without a key or network and is marked simulated, at zero cost', async () => {
    const fetchMock = mockProviderOk()
    const store = fakeStore()
    const r = await run(call, store, testConfig({ llmMock: true, platformKeys: {} }))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(r).toMatchObject({ simulated: true, provider: 'mock' })
    expect(store.logged[0]?.costEstimateUsd).toBe(0)
  })
})

describe('error translation', () => {
  it('tells a BYOK learner their own key was rejected', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid x-api-key', { status: 401 })))
    await expect(run(call, learnerKeyStore())).rejects.toThrow(/your api key was rejected/i)
  })

  it('does not blame the learner for a platform key failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('invalid x-api-key', { status: 401 })))
    await expect(run(call, fakeStore())).rejects.toThrow(/administrator/i)
  })

  it('never leaks provider internals to the learner', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('stack trace sk-ant-secret123456', { status: 500 })))
    await expect(run(call, fakeStore())).rejects.toSatisfy(
      (e: Error) => e instanceof LlmUserFacingError && !e.message.includes('sk-ant'),
    )
  })

  it('hides a non-provider failure behind a generic message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('socket hang up'))))
    await expect(run(call, fakeStore())).rejects.toMatchObject({ code: 'provider_unavailable' })
  })
})

describe('summariseProviderError', () => {
  it('keeps just the provider message from a JSON body, on one line', () => {
    const body = JSON.stringify({ error: { code: 429, message: 'Quota exceeded.\nPlease retry in 53s.', details: [{ big: 'x' }] } })
    expect(summariseProviderError(body)).toBe('Quota exceeded. Please retry in 53s.')
  })

  it('caps a long non-JSON body', () => {
    expect(summariseProviderError('x'.repeat(1000))).toHaveLength(301)
  })
})
