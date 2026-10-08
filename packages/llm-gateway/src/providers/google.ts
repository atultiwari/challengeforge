import { checkKeyWith, modelSpec, providerError, temperatureFor } from './types'
import type { LlmProvider, LlmRequest, ModelSpec } from './types'

interface GeminiBody {
  responseId?: string
  modelVersion?: string
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string | null }[]
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number }
}

function requestBody(req: LlmRequest, spec: ModelSpec): string {
  const temperature = temperatureFor(spec, req.temperature)
  return JSON.stringify({
    systemInstruction: { parts: [{ text: req.system }] },
    contents: req.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    })),
    generationConfig: {
      maxOutputTokens: req.maxTokens,
      ...(temperature === undefined ? {} : { temperature }),
      ...(spec.reasoning ? { thinkingConfig: { thinkingLevel: spec.reasoning } } : {}),
    },
  })
}

/** Google Gemini generateContent. Note "model", not "assistant", for its turns. */
export const googleProvider: LlmProvider = {
  name: 'google',

  async chat(req, apiKey, config) {
    const spec = modelSpec(config, req.model)
    const res = await fetch(`${config.api_base}/models/${encodeURIComponent(req.model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey, ...config.extra_headers },
      body: requestBody(req, spec),
    })

    if (!res.ok) {
      throw await providerError(res)
    }

    const body = (await res.json()) as GeminiBody
    const candidate = body.candidates?.[0]
    const usage = body.usageMetadata
    return {
      text: (candidate?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join(''),
      inputTokens: usage?.promptTokenCount ?? 0,
      // Thinking tokens are billed as output, so they count towards cost.
      outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
      model: body.modelVersion ?? req.model,
      stopReason: candidate?.finishReason ?? null,
      requestId: body.responseId ?? null,
    }
  },

  validateKey(apiKey, config) {
    return checkKeyWith(`${config.api_base}/models?pageSize=1`, { 'x-goog-api-key': apiKey })
  },
}
