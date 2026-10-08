/** One turn sent to a model. */
export interface LlmMessage {
  readonly role: 'user' | 'assistant'
  readonly content: string
}

/** Normalised request. Built server-side only - never from client input. */
export interface LlmRequest {
  readonly model: string
  readonly system: string
  readonly messages: readonly LlmMessage[]
  readonly maxTokens: number
  readonly temperature?: number
}

/**
 * Normalised response. Every provider reports tokens under a different name
 * (input_tokens / prompt_tokens / promptTokenCount); they all land here so
 * usage logging has one shape and cost measurement works across providers.
 */
export interface LlmResponse {
  readonly text: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly model: string
  readonly stopReason: string | null
  readonly requestId: string | null
}

export interface ModelSpec {
  readonly id: string
  readonly label: string
  readonly input_usd_per_mtok: number | null
  readonly output_usd_per_mtok: number | null
  /** False for models that reject a non-default temperature. Default true. */
  readonly supports_temperature?: boolean
  /** Reasoning effort, mapped to each provider's own parameter. */
  readonly reasoning?: string | null
}

export interface ProviderConfig {
  readonly label: string
  readonly api_base: string
  readonly auth: 'x-api-key' | 'bearer' | 'x-goog-api-key'
  readonly key_prefix: string
  readonly default_model: string
  readonly models: readonly ModelSpec[]
  /** Extra headers sent on every request, e.g. OpenRouter attribution. */
  readonly extra_headers?: Readonly<Record<string, string>>
}

export interface ProvidersConfig {
  readonly default_provider: string
  readonly providers: Readonly<Record<string, ProviderConfig>>
}

/** The settings for one model, or safe defaults for a model not in config. */
export function modelSpec(config: ProviderConfig, modelId: string): ModelSpec {
  return (
    config.models.find((m) => m.id === modelId) ?? {
      id: modelId,
      label: modelId,
      input_usd_per_mtok: null,
      output_usd_per_mtok: null,
    }
  )
}

/** Temperature to send, or undefined when the model would reject it. */
export function temperatureFor(spec: ModelSpec, requested: number | undefined): number | undefined {
  if (requested === undefined || spec.supports_temperature === false) return undefined
  return requested
}

export interface LlmProvider {
  readonly name: string
  chat(req: LlmRequest, apiKey: string, config: ProviderConfig): Promise<LlmResponse>
  /** Verifies a learner's key before saving it, without spending tokens. */
  validateKey(apiKey: string, config: ProviderConfig): Promise<boolean>
}

export type ProviderErrorKind = 'auth' | 'rate_limit' | 'server' | 'request'

/**
 * Errors from a provider. `retryable` distinguishes a rate limit from a bad
 * key, so the UI can tell a learner which one happened without exposing detail.
 */
export class LlmProviderError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly retryable: boolean,
    readonly kind: ProviderErrorKind = 'server',
    /** How long the provider asked us to wait before retrying, if it said. */
    readonly retryAfterSeconds: number | null = null,
  ) {
    super(message)
    this.name = 'LlmProviderError'
  }
}

export function classify(status: number): { retryable: boolean; kind: ProviderErrorKind } {
  if (status === 401 || status === 403) return { retryable: false, kind: 'auth' }
  if (status === 429) return { retryable: true, kind: 'rate_limit' }
  if (status >= 500) return { retryable: true, kind: 'server' }
  return { retryable: false, kind: 'request' }
}

/** Never let a provider's error body carry a key back into our logs. */
export function redact(text: string): string {
  // sk-... (Anthropic, OpenAI, OpenRouter), AIza... (older Google keys) and
  // AQ.... (Google's newer key format).
  return text.replace(/\b(sk-[A-Za-z0-9_-]{8,}|AIza[A-Za-z0-9_-]{8,}|AQ\.[A-Za-z0-9_.-]{8,})/g, '[redacted]')
}

/**
 * Reads a provider's "wait N seconds" hint: the standard Retry-After header,
 * or Google's RetryInfo ("retryDelay": "55s" / "Please retry in 55.7s").
 */
export function parseRetryAfter(header: string | null, body: string): number | null {
  if (header && /^\d+(\.\d+)?$/.test(header.trim())) return Math.ceil(Number(header.trim()))
  const match = body.match(/"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/) ?? body.match(/retry in (\d+(?:\.\d+)?)\s*s/i)
  return match?.[1] ? Math.ceil(Number(match[1])) : null
}

/** Builds the error for a failed provider response, keys redacted. */
export async function providerError(res: Response): Promise<LlmProviderError> {
  const body = await res.text()
  const { retryable, kind } = classify(res.status)
  return new LlmProviderError(redact(body), res.status, retryable, kind, parseRetryAfter(res.headers.get('retry-after'), body))
}

/**
 * Key validation uses each provider's free "list models" (or key info)
 * endpoint, so checking a learner's key costs no tokens and cannot trip over
 * a reasoning model's minimum output length.
 */
export async function checkKeyWith(url: string, headers: Readonly<Record<string, string>>): Promise<boolean> {
  const res = await fetch(url, { method: 'GET', headers: { ...headers } })
  if (res.ok) return true
  const { kind } = classify(res.status)
  if (kind === 'auth') return false
  throw new LlmProviderError(redact(await res.text()), res.status, kind !== 'request', kind)
}
