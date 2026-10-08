import { LlmUserFacingError } from './errors'
import { LlmProviderError } from './providers/types'
import type { CredentialSource } from './store'

const UNREACHABLE = 'The AI service could not be reached. Please try again.'
const MAX_SUMMARY_CHARS = 300

/** The provider's own message if the body is JSON, else the start of the body. */
export function summariseProviderError(body: string): string {
  let message = body
  try {
    const parsed = JSON.parse(body) as { error?: { message?: unknown } } | null
    if (typeof parsed?.error?.message === 'string') message = parsed.error.message
  } catch {
    // Not JSON: use the raw text.
  }
  const oneLine = message.replace(/\s+/g, ' ').trim()
  return oneLine.length > MAX_SUMMARY_CHARS ? `${oneLine.slice(0, MAX_SUMMARY_CHARS)}…` : oneLine
}

/** Translates a provider failure into something safe to show a learner. */
export function toUserFacing(err: unknown, source: CredentialSource): Error {
  if (!(err instanceof LlmProviderError)) {
    console.error('[llm-gateway] unexpected provider failure', err)
    return new LlmUserFacingError(UNREACHABLE, 'provider_unavailable')
  }
  // Provider error bodies are already key-redacted by the adapters. One line,
  // capped: a Gemini 429 body alone is ~40 lines of JSON.
  console.error(`[llm-gateway] provider error (${err.kind}, ${err.status}): ${summariseProviderError(err.message)}`)

  if (err.kind === 'auth') {
    return new LlmUserFacingError(
      source === 'byok'
        ? 'Your API key was rejected by the provider. Check it in AI Settings.'
        : 'The site could not authenticate with the AI service. Please tell the site administrator.',
      'invalid_key',
    )
  }
  if (err.kind === 'rate_limit') {
    return new LlmUserFacingError(
      source === 'byok'
        ? "Your API key has reached its provider's rate limit (free keys allow only a few requests a minute). Wait a minute and try again."
        : 'The AI service is busy. Wait a moment and try again.',
      'provider_unavailable',
    )
  }
  return new LlmUserFacingError(UNREACHABLE, 'provider_unavailable')
}
