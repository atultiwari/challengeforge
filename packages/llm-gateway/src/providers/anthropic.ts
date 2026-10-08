import { checkKeyWith, modelSpec, providerError, temperatureFor } from './types'
import type { LlmProvider } from './types'

const VERSION = '2023-06-01'

interface AnthropicBody {
  id?: string
  model?: string
  stop_reason?: string | null
  content?: { type: string; text?: string }[]
  usage?: { input_tokens?: number; output_tokens?: number }
}

/** Anthropic Messages API. */
export const anthropicProvider: LlmProvider = {
  name: 'anthropic',

  async chat(req, apiKey, config) {
    const temperature = temperatureFor(modelSpec(config, req.model), req.temperature)
    const res = await fetch(`${config.api_base}/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': VERSION,
        ...config.extra_headers,
      },
      body: JSON.stringify({
        model: req.model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: req.messages,
        ...(temperature === undefined ? {} : { temperature }),
      }),
    })

    if (!res.ok) {
      throw await providerError(res)
    }

    const body = (await res.json()) as AnthropicBody

    return {
      // Only text blocks: thinking blocks are the model's working, not its reply.
      text: (body.content ?? []).filter((b) => b.type === 'text').map((b) => b.text ?? '').join(''),
      inputTokens: body.usage?.input_tokens ?? 0,
      outputTokens: body.usage?.output_tokens ?? 0,
      model: body.model ?? req.model,
      stopReason: body.stop_reason ?? null,
      requestId: body.id ?? null,
    }
  },

  validateKey(apiKey, config) {
    return checkKeyWith(`${config.api_base}/models?limit=1`, { 'x-api-key': apiKey, 'anthropic-version': VERSION })
  },
}
