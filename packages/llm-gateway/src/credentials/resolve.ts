import type { GatewayConfig } from '../config'
import { LlmUserFacingError } from '../errors'
import type { CredentialSource, LlmStore, StoredCredential } from '../store'
import { decryptSecret } from './crypto'

export interface ResolvedCredential {
  readonly apiKey: string
  readonly source: CredentialSource
}

function openStoredKey(stored: StoredCredential, encryptionKey: string | null): ResolvedCredential {
  try {
    if (encryptionKey === null) throw new Error('BYOK is enabled but no encryption key is configured.')
    return { apiKey: decryptSecret(stored, encryptionKey), source: 'byok' }
  } catch {
    // Wrong master key or a tampered row. Never fall through to the
    // platform key silently - the learner must know their key is unusable.
    throw new LlmUserFacingError(
      'Your saved API key could not be read. Please remove it and add it again in AI Settings.',
      'invalid_key',
    )
  }
}

/**
 * Decides whose key pays for a call.
 *
 * Order: the learner's own key, then the platform key (OAuth is a dormant
 * slot, see below). Anything else is a clear, actionable error - never a
 * silent fallback to a key the learner did not expect to be charged for.
 */
export async function resolveCredential(
  store: LlmStore,
  userId: string,
  provider: string,
  config: GatewayConfig,
  options: { platformOnly?: boolean } = {},
): Promise<ResolvedCredential> {
  if (!config.enabledProviders.includes(provider)) {
    throw new LlmUserFacingError('That AI provider is not enabled on this site.', 'provider_disabled')
  }

  // Grading (judges, evaluation runs) always runs on the platform key, so a
  // learner's expired or revoked key can never make their grade fail.
  if (config.byokEnabled && !options.platformOnly) {
    const stored = await store.getCredential(userId, provider)
    if (stored) return openStoredKey(stored, config.byokEncryptionKey)
  }

  const platformKey = config.platformKeys[provider]
  if (platformKey) return { apiKey: platformKey, source: 'platform' }

  throw new LlmUserFacingError(
    options.platformOnly
      ? 'Grading is not available right now. Please tell the site administrator.'
      : 'No API key is available for this challenge. Add your own key in AI Settings to continue.',
    'no_credential',
  )
}

/**
 * "Sign in with ChatGPT". As of September 2026 this grants identity and a fixed
 * allocation of API credits; it does NOT let a third-party app bill inference
 * to a user's ChatGPT Plus subscription. The slot exists so that becomes a
 * config change rather than a rewrite.
 */
export function assertOauthInferenceAvailable(): never {
  throw new LlmUserFacingError(
    'Signing in with ChatGPT cannot yet pay for calls from other apps. Use your own API key, or the site key.',
    'oauth_unavailable',
  )
}
