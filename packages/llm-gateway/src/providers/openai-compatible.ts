import { checkKeyWith, modelSpec, providerError, temperatureFor } from './types'
import type { LlmProvider, ModelSpec, ProviderConfig } from './types'

/**
 * OpenAI Chat Completions shape. Used for OpenAI itself and for OpenRouter,
 * which speaks the same protocol - one adapter, two providers. They differ in
 * how reasoning effort is requested and which endpoint proves a key works.
 *
 * Attribution headers (OpenRouter's HTTP-Referer / X-Title) come from the
 * provider config's `extra_headers`, so each deployment names itself.
 */
interface Dialect {
  readonly name: string
  readonly reasoningParam: (spec: ModelSpec) => Record<string, unknown>
  /** Path under api_base that needs a valid key and costs nothing. */
  readonly keyCheckPath: string
}

interface ChatCompletionBody {
  id?: string
  model?: string
  choices?: { message?: { content?: string | null }; finish_reason?: string | null }[]
  // completion_tokens already includes reasoning tokens on both APIs.
  usage?: { prompt_tokens?: number; completion_tokens?: number }
}

function headersFor(apiKey: string, config: ProviderConfig): Record<string, string> {
  return { authorization: `Bearer ${apiKey}`, ...config.extra_headers }
}

function makeProvider(dialect: Dialect): LlmProvider {
  return {
    name: dialect.name,

    async chat(req, apiKey, config) {
      const spec = modelSpec(config, req.model)
      const temperature = temperatureFor(spec, req.temperature)
      const res = await fetch(`${config.api_base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headersFor(apiKey, config) },
        body: JSON.stringify({
          model: req.model,
          max_completion_tokens: req.maxTokens,
          messages: [{ role: 'system', content: req.system }, ...req.messages],
          ...(temperature === undefined ? {} : { temperature }),
          ...dialect.reasoningParam(spec),
        }),
      })

      if (!res.ok) {
        throw await providerError(res)
      }

      const body = (await res.json()) as ChatCompletionBody
      const choice = body.choices?.[0]
      return {
        text: choice?.message?.content ?? '',
        inputTokens: body.usage?.prompt_tokens ?? 0,
        outputTokens: body.usage?.completion_tokens ?? 0,
        model: body.model ?? req.model,
        stopReason: choice?.finish_reason ?? null,
        requestId: body.id ?? null,
      }
    },

    validateKey(apiKey, config) {
      return checkKeyWith(`${config.api_base}${dialect.keyCheckPath}`, headersFor(apiKey, config))
    },
  }
}

export const openaiProvider = makeProvider({
  name: 'openai',
  reasoningParam: (spec) => (spec.reasoning ? { reasoning_effort: spec.reasoning } : {}),
  keyCheckPath: '/models',
})

export const openrouterProvider = makeProvider({
  name: 'openrouter',
  reasoningParam: (spec) => (spec.reasoning ? { reasoning: { effort: spec.reasoning } } : {}),
  // /models is public on OpenRouter; /key needs a valid key.
  keyCheckPath: '/key',
})
