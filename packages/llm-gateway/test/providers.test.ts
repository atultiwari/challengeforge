import { describe, it, expect, afterEach, vi } from 'vitest'
import { anthropicProvider } from '../src/providers/anthropic'
import { openaiProvider, openrouterProvider } from '../src/providers/openai-compatible'
import { googleProvider } from '../src/providers/google'
import { LlmProviderError, redact, classify, parseRetryAfter } from '../src/providers/types'
import type { LlmRequest } from '../src/providers/types'
import { createProviderRegistry } from '../src/providers/registry'
import { DEFAULT_PROVIDERS_CONFIG } from '../src/providers-config'
import { fetchCall, sentBody, sentHeaders, stubFetch as mockFetch } from './helpers'

const registry = createProviderRegistry()
const providerConfig = (name: string) => registry.config(name)

const req: LlmRequest = {
  model: 'test-model',
  system: 'You are a test bot.',
  messages: [{ role: 'user', content: 'Hello' }],
  maxTokens: 64,
}

afterEach(() => vi.unstubAllGlobals())

describe('anthropic adapter', () => {
  const config = providerConfig('anthropic')

  it('normalises a successful response', async () => {
    mockFetch(200, {
      id: 'msg_1',
      model: 'claude-haiku-4-5-20251001',
      stop_reason: 'end_turn',
      content: [{ type: 'text', text: 'Hi there' }],
      usage: { input_tokens: 11, output_tokens: 3 },
    })
    const r = await anthropicProvider.chat(req, 'sk-ant-test', config)
    expect(r).toMatchObject({ text: 'Hi there', inputTokens: 11, outputTokens: 3, requestId: 'msg_1' })
  })

  it('sends the key in the x-api-key header, not the body', async () => {
    const fetchMock = mockFetch(200, { content: [], usage: {} })
    await anthropicProvider.chat(req, 'sk-ant-secret', config)
    expect(sentHeaders(fetchMock)['x-api-key']).toBe('sk-ant-secret')
    expect(fetchCall(fetchMock)[1].body).not.toContain('sk-ant-secret')
  })

  it('reports a bad key as a non-retryable auth error', async () => {
    mockFetch(401, { error: 'invalid x-api-key' })
    await expect(anthropicProvider.chat(req, 'bad', config)).rejects.toMatchObject({ kind: 'auth', retryable: false })
  })

  it('reports a rate limit as retryable', async () => {
    mockFetch(429, 'slow down')
    await expect(anthropicProvider.chat(req, 'k', config)).rejects.toMatchObject({ retryable: true })
  })

  it('validateKey returns false on auth failure rather than throwing', async () => {
    mockFetch(401, 'nope')
    expect(await anthropicProvider.validateKey('bad', config)).toBe(false)
  })

  it('validateKey rethrows a server error, which is not the key being wrong', async () => {
    mockFetch(503, 'down')
    await expect(anthropicProvider.validateKey('k', config)).rejects.toBeInstanceOf(LlmProviderError)
  })

  it('tolerates a response with no usage block', async () => {
    mockFetch(200, { content: [{ type: 'text', text: 'x' }] })
    const r = await anthropicProvider.chat(req, 'k', config)
    expect(r.inputTokens).toBe(0)
    expect(r.outputTokens).toBe(0)
  })
})

describe('openai-compatible adapter', () => {
  const config = providerConfig('openai')

  it('normalises prompt_tokens/completion_tokens into the shared shape', async () => {
    mockFetch(200, {
      id: 'chatcmpl_1',
      model: 'gpt-6-luna',
      choices: [{ message: { content: 'Hello' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 9, completion_tokens: 2 },
    })
    const r = await openaiProvider.chat(req, 'sk-test', config)
    expect(r).toMatchObject({ text: 'Hello', inputTokens: 9, outputTokens: 2, stopReason: 'stop' })
  })

  it('puts the system prompt in the messages array', async () => {
    const fetchMock = mockFetch(200, { choices: [], usage: {} })
    await openaiProvider.chat(req, 'k', config)
    const messages = sentBody(fetchMock).messages as unknown[]
    expect(messages[0]).toEqual({ role: 'system', content: 'You are a test bot.' })
  })

  it('handles a null content field without crashing', async () => {
    mockFetch(200, { choices: [{ message: { content: null } }], usage: {} })
    expect((await openaiProvider.chat(req, 'k', config)).text).toBe('')
  })
})

describe('google adapter', () => {
  const config = providerConfig('google')

  it('normalises promptTokenCount/candidatesTokenCount', async () => {
    mockFetch(200, {
      responseId: 'resp_1',
      modelVersion: 'gemini-3.8-flash',
      candidates: [{ content: { parts: [{ text: 'Namaste' }] }, finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 4 },
    })
    const r = await googleProvider.chat(req, 'AIza-test', config)
    expect(r).toMatchObject({ text: 'Namaste', inputTokens: 7, outputTokens: 4 })
  })

  it('maps assistant turns to Gemini "model" turns', async () => {
    const fetchMock = mockFetch(200, { candidates: [], usageMetadata: {} })
    await googleProvider.chat(
      { ...req, messages: [{ role: 'user', content: 'a' }, { role: 'assistant', content: 'b' }] },
      'k',
      config,
    )
    const contents = sentBody(fetchMock).contents as { role: string }[]
    expect(contents.map((c) => c.role)).toEqual(['user', 'model'])
  })
})

describe('error hygiene', () => {
  it('redacts API keys out of provider error text', () => {
    expect(redact('bad key sk-ant-api03-abcdefghijk rejected')).toBe('bad key [redacted] rejected')
    expect(redact('AIzaSyAbcdefghijklmn is invalid')).toBe('[redacted] is invalid')
    expect(redact('key AQ.Ab8RN6Lx-y_z.123456 rejected')).toBe('key [redacted] rejected')
  })

  it('classifies statuses the way the UI needs', () => {
    expect(classify(401)).toEqual({ retryable: false, kind: 'auth' })
    expect(classify(429)).toEqual({ retryable: true, kind: 'rate_limit' })
    expect(classify(500)).toEqual({ retryable: true, kind: 'server' })
    expect(classify(400)).toEqual({ retryable: false, kind: 'request' })
  })
})

describe('parseRetryAfter', () => {
  it('reads a Retry-After header in seconds', () => {
    expect(parseRetryAfter('30', '')).toBe(30)
  })

  it("reads Google's RetryInfo and message forms, rounding up", () => {
    expect(parseRetryAfter(null, '{"@type":"RetryInfo","retryDelay": "55s"}')).toBe(55)
    expect(parseRetryAfter(null, 'Quota exceeded. Please retry in 53.78s.')).toBe(54)
  })

  it('returns null when the provider gave no hint', () => {
    expect(parseRetryAfter(null, 'slow down')).toBeNull()
    expect(parseRetryAfter('Wed, 21 Oct 2026 07:28:00 GMT', '')).toBeNull()
  })

  it('attaches the hint to the error the adapter throws', async () => {
    mockFetch(429, { error: { message: 'Please retry in 12.2s' } })
    await expect(googleProvider.chat(req, 'k', providerConfig('google'))).rejects.toMatchObject({
      kind: 'rate_limit',
      retryAfterSeconds: 13,
    })
  })
})

describe('provider registry', () => {
  it('knows the four configured providers', () => {
    expect(registry.knownProviders().sort()).toEqual(['anthropic', 'google', 'openai', 'openrouter'])
  })

  it('pins Claude Haiku 4.5 as the Anthropic default', () => {
    expect(providerConfig('anthropic').default_model).toBe('claude-haiku-4-5-20251001')
  })

  it('throws a helpful error for an unknown provider', () => {
    expect(() => providerConfig('nope')).toThrow(/providers config/)
  })

  it('throws for a provider with no adapter', () => {
    expect(() => registry.adapter('nope')).toThrow(/No adapter/)
  })

  it('prices a configured model from the per-million-token rates', () => {
    // Haiku 4.5: $1 in, $5 out per million tokens.
    expect(registry.estimateCostUsd('anthropic', 'claude-haiku-4-5-20251001', 1_000_000, 200_000)).toBeCloseTo(2, 10)
  })

  it('returns null cost for a model with no configured price, rather than inventing one', () => {
    expect(registry.estimateCostUsd('anthropic', 'claude-not-in-config', 1000, 500)).toBeNull()
  })

  it('has a price for every configured model, so the budget cap can work', () => {
    for (const name of registry.knownProviders()) {
      for (const m of providerConfig(name).models) {
        expect(m.input_usd_per_mtok, `${name}/${m.id}`).not.toBeNull()
        expect(m.output_usd_per_mtok, `${name}/${m.id}`).not.toBeNull()
      }
    }
  })

  it('lists each provider default model among its models', () => {
    for (const name of registry.knownProviders()) {
      const c = providerConfig(name)
      expect(c.models.map((m) => m.id), name).toContain(c.default_model)
    }
  })

  it('names the conventional platform-key env var', () => {
    expect(registry.platformKeyEnvVar('anthropic')).toBe('ANTHROPIC_API_KEY')
    expect(registry.platformKeyEnvVar('mistral')).toBe('MISTRAL_API_KEY')
  })

  it('accepts a custom config instead of the default', () => {
    const custom = createProviderRegistry({
      default_provider: 'anthropic',
      providers: { anthropic: { ...DEFAULT_PROVIDERS_CONFIG.providers.anthropic!, default_model: 'x', models: [] } },
    })
    expect(custom.knownProviders()).toEqual(['anthropic'])
    expect(custom.estimateCostUsd('anthropic', 'claude-haiku-4-5-20251001', 1, 1)).toBeNull()
  })
})

describe('per-model request options', () => {
  it('sends temperature to a model that accepts it', async () => {
    const f = mockFetch(200, { content: [], usage: {} })
    await anthropicProvider.chat({ ...req, model: 'claude-haiku-4-5-20251001', temperature: 0 }, 'k', providerConfig('anthropic'))
    expect(sentBody(f).temperature).toBe(0)
  })

  it('omits temperature for Claude Sonnet 5, which rejects it with a 400', async () => {
    const f = mockFetch(200, { content: [], usage: {} })
    await anthropicProvider.chat({ ...req, model: 'claude-sonnet-5', temperature: 0 }, 'k', providerConfig('anthropic'))
    expect(sentBody(f)).not.toHaveProperty('temperature')
  })

  it('sends reasoning_effort, not temperature, to GPT-6 models', async () => {
    const f = mockFetch(200, { choices: [], usage: {} })
    await openaiProvider.chat({ ...req, model: 'gpt-6-luna', temperature: 0 }, 'k', providerConfig('openai'))
    expect(sentBody(f)).not.toHaveProperty('temperature')
    expect(sentBody(f).reasoning_effort).toBe('low')
  })

  it('uses the OpenRouter reasoning shape', async () => {
    const f = mockFetch(200, { choices: [], usage: {} })
    await openrouterProvider.chat({ ...req, model: 'openai/gpt-6-luna' }, 'k', providerConfig('openrouter'))
    expect(sentBody(f).reasoning).toEqual({ effort: 'low' })
  })

  it('sets a Gemini thinking level and counts thinking tokens as output', async () => {
    const f = mockFetch(200, {
      candidates: [{ content: { parts: [{ text: 'plan', thought: true }, { text: 'Answer' }] } }],
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, thoughtsTokenCount: 20 },
    })
    const r = await googleProvider.chat({ ...req, model: 'gemini-3.8-flash' }, 'k', providerConfig('google'))
    expect((sentBody(f).generationConfig as Record<string, unknown>).thinkingConfig).toEqual({ thinkingLevel: 'low' })
    expect(r.text).toBe('Answer')
    expect(r.outputTokens).toBe(23)
  })

  it('sends no extra options for a model missing from config', async () => {
    const f = mockFetch(200, { choices: [], usage: {} })
    await openaiProvider.chat({ ...req, temperature: 0.2 }, 'k', providerConfig('openai'))
    expect(sentBody(f).temperature).toBe(0.2)
    expect(sentBody(f)).not.toHaveProperty('reasoning_effort')
  })
})

describe('key validation costs no tokens', () => {
  const cases = [
    ['anthropic', anthropicProvider, 'api.anthropic.com/v1/models', 'x-api-key'],
    ['openai', openaiProvider, 'api.openai.com/v1/models', 'authorization'],
    ['google', googleProvider, 'generativelanguage.googleapis.com/v1beta/models', 'x-goog-api-key'],
    ['openrouter', openrouterProvider, 'openrouter.ai/api/v1/key', 'authorization'],
  ] as const

  for (const [name, provider, urlPart, header] of cases) {
    it(`${name} checks the key with a GET to a free endpoint`, async () => {
      const f = mockFetch(200, {})
      expect(await provider.validateKey('k', providerConfig(name))).toBe(true)
      const [url, init] = fetchCall(f)
      expect(url).toContain(urlPart)
      expect(init.method).toBe('GET')
      expect(Object.keys(init.headers as Record<string, string>)).toContain(header)
    })
  }
})

describe('provider error paths (each adapter must fail the same way)', () => {
  it('google surfaces an auth failure', async () => {
    mockFetch(401, 'bad key')
    await expect(googleProvider.chat(req, 'k', providerConfig('google'))).rejects.toMatchObject({ kind: 'auth' })
  })

  it('google validateKey returns false on auth failure', async () => {
    mockFetch(403, 'forbidden')
    expect(await googleProvider.validateKey('k', providerConfig('google'))).toBe(false)
  })

  it('google validateKey rethrows a server error', async () => {
    mockFetch(500, 'down')
    await expect(googleProvider.validateKey('k', providerConfig('google'))).rejects.toBeInstanceOf(LlmProviderError)
  })

  it('google tolerates a response with no candidates', async () => {
    mockFetch(200, {})
    expect((await googleProvider.chat(req, 'k', providerConfig('google'))).text).toBe('')
  })

  it('openai surfaces an auth failure', async () => {
    mockFetch(401, 'bad key')
    await expect(openaiProvider.chat(req, 'k', providerConfig('openai'))).rejects.toMatchObject({ kind: 'auth' })
  })

  it('openai validateKey returns false on auth failure', async () => {
    mockFetch(401, 'nope')
    expect(await openaiProvider.validateKey('k', providerConfig('openai'))).toBe(false)
  })

  it('openai validateKey rethrows a rate limit, which is not a bad key', async () => {
    mockFetch(429, 'slow down')
    await expect(openaiProvider.validateKey('k', providerConfig('openai'))).rejects.toBeInstanceOf(LlmProviderError)
  })

  it('openrouter sends attribution headers and its own key', async () => {
    const fetchMock = mockFetch(200, { choices: [], usage: {} })
    await openrouterProvider.chat(req, 'sk-or-test', providerConfig('openrouter'))
    expect(fetchCall(fetchMock)[0]).toContain('openrouter.ai')
    const headers = sentHeaders(fetchMock)
    expect(headers.authorization).toBe('Bearer sk-or-test')
    expect(headers['X-Title']).toBe('ChallengeForge')
  })
})
