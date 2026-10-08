import { DEFAULT_PROVIDERS_CONFIG } from '../providers-config'
import { anthropicProvider } from './anthropic'
import { googleProvider } from './google'
import { openaiProvider, openrouterProvider } from './openai-compatible'
import type { LlmProvider, ProviderConfig, ProvidersConfig } from './types'

const ADAPTERS: Readonly<Record<string, LlmProvider>> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  google: googleProvider,
  openrouter: openrouterProvider,
}

const PLATFORM_KEY_ENV_VARS: Readonly<Record<string, string>> = {
  anthropic: 'ANTHROPIC_API_KEY',
  openai: 'OPENAI_API_KEY',
  google: 'GOOGLE_API_KEY',
  openrouter: 'OPENROUTER_API_KEY',
}

export interface ModelPricing {
  readonly inputUsdPerMTok: number | null
  readonly outputUsdPerMTok: number | null
}

export interface ProviderRegistry {
  /** The provider's config. Throws for a provider missing from config. */
  config(name: string): ProviderConfig
  /** The adapter that speaks the provider's API. Throws if none exists. */
  adapter(name: string): LlmProvider
  /** Provider names that exist in config, for an AI settings page. */
  knownProviders(): string[]
  /** Per-million-token prices, or null when not filled in. */
  modelPricing(provider: string, model: string): ModelPricing
  /** USD estimate for a call, or null when the model has no price. */
  estimateCostUsd(provider: string, model: string, inputTokens: number, outputTokens: number): number | null
  /** Conventional env var name for a provider's platform key (for the host app). */
  platformKeyEnvVar(name: string): string
}

/**
 * Builds a registry over a providers config. Pure: no filesystem reads, so a
 * host app can load its own config however it likes and pass it in.
 */
export function createProviderRegistry(providers: ProvidersConfig = DEFAULT_PROVIDERS_CONFIG): ProviderRegistry {
  const config = (name: string): ProviderConfig => {
    const found = providers.providers[name]
    if (!found) throw new Error(`Unknown LLM provider "${name}". Add it to the providers config.`)
    return found
  }

  /*
   * Prices are never invented here: a model with no configured price returns
   * null and is bounded only by its call cap.
   */
  const modelPricing = (provider: string, model: string): ModelPricing => {
    const entry = config(provider).models.find((m) => m.id === model)
    return {
      inputUsdPerMTok: entry?.input_usd_per_mtok ?? null,
      outputUsdPerMTok: entry?.output_usd_per_mtok ?? null,
    }
  }

  return {
    config,
    adapter(name) {
      const adapter = ADAPTERS[name]
      if (!adapter) throw new Error(`No adapter implemented for LLM provider "${name}".`)
      return adapter
    },
    knownProviders: () => Object.keys(providers.providers),
    modelPricing,
    estimateCostUsd(provider, model, inputTokens, outputTokens) {
      const { inputUsdPerMTok, outputUsdPerMTok } = modelPricing(provider, model)
      if (inputUsdPerMTok === null || outputUsdPerMTok === null) return null
      return (inputTokens / 1e6) * inputUsdPerMTok + (outputTokens / 1e6) * outputUsdPerMTok
    },
    platformKeyEnvVar: (name) => PLATFORM_KEY_ENV_VARS[name] ?? `${name.toUpperCase()}_API_KEY`,
  }
}
