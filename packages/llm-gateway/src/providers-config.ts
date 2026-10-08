import type { ProvidersConfig } from './providers/types'

/*
 * ============================================================================
 * LLM providers and models.
 *
 * Model IDs change often. They live here, as data, so adding a model is a
 * config edit (or a different config passed to createProviderRegistry).
 * Verify IDs and prices against each provider's own pages before a release.
 *
 * Last checked: 23 September 2026, from
 *   Anthropic   platform.claude.com/docs/en/about-claude/models/overview
 *   OpenAI      developers.openai.com/api/docs/models
 *   Google      ai.google.dev/gemini-api/docs/models  and  .../pricing
 *   OpenRouter  openrouter.ai/api/v1/models
 *
 * Prices are USD per million tokens, standard (non-batch) tier. A model with
 * null prices logs a null cost and is bounded only by call caps.
 *
 * Per-model options:
 *   supports_temperature  false for models that reject a non-default
 *                         temperature (Claude Sonnet 5, GPT-6 reasoning
 *                         models). The gateway then omits it.
 *   reasoning             how hard the model thinks before replying. Mapped per
 *                         provider: OpenAI reasoning_effort, OpenRouter
 *                         reasoning.effort, Gemini thinkingConfig.thinkingLevel.
 *                         Kept low: challenge chatbots should answer fast and
 *                         cheap.
 * ============================================================================
 */
export const DEFAULT_PROVIDERS_CONFIG: ProvidersConfig = {
  default_provider: 'anthropic',
  providers: {
    anthropic: {
      label: 'Anthropic (Claude)',
      api_base: 'https://api.anthropic.com/v1',
      auth: 'x-api-key',
      key_prefix: 'sk-ant-',
      default_model: 'claude-haiku-4-5-20251001',
      models: [
        {
          id: 'claude-haiku-4-5-20251001',
          label: 'Claude Haiku 4.5',
          input_usd_per_mtok: 1,
          output_usd_per_mtok: 5,
          supports_temperature: true,
        },
        {
          id: 'claude-sonnet-5',
          label: 'Claude Sonnet 5',
          input_usd_per_mtok: 2,
          output_usd_per_mtok: 10,
          supports_temperature: false,
        },
      ],
    },

    openai: {
      label: 'OpenAI (GPT)',
      api_base: 'https://api.openai.com/v1',
      auth: 'bearer',
      key_prefix: 'sk-',
      default_model: 'gpt-6-luna',
      models: [
        {
          id: 'gpt-6-luna',
          label: 'GPT-6 Luna',
          input_usd_per_mtok: 0.1,
          output_usd_per_mtok: 0.5,
          supports_temperature: false,
          reasoning: 'low',
        },
        {
          id: 'gpt-6-sol',
          label: 'GPT-6 Sol',
          input_usd_per_mtok: 2,
          output_usd_per_mtok: 10,
          supports_temperature: false,
          reasoning: 'low',
        },
      ],
    },

    google: {
      label: 'Google (Gemini)',
      api_base: 'https://generativelanguage.googleapis.com/v1beta',
      auth: 'x-goog-api-key',
      key_prefix: '',
      default_model: 'gemini-3.1-flash-lite',
      models: [
        // The cheapest current Gemini. At thinkingLevel "minimal" it spends no
        // thinking tokens (at "low" it spent ~125 billed thinking tokens per
        // judge call) and gave identical verdicts on repeat runs. Measured
        // 23 Sep 2026.
        {
          id: 'gemini-3.1-flash-lite',
          label: 'Gemini 3.1 Flash-Lite',
          input_usd_per_mtok: 0.25,
          output_usd_per_mtok: 1.5,
          supports_temperature: true,
          reasoning: 'minimal',
        },
        // $0.75 / $3.75 until 31 Dec 2026, then $1.50 / $7.50. Update in January.
        {
          id: 'gemini-3.8-flash',
          label: 'Gemini 3.8 Flash',
          input_usd_per_mtok: 0.75,
          output_usd_per_mtok: 3.75,
          supports_temperature: true,
          reasoning: 'low',
        },
        {
          id: 'gemini-3.5-flash-lite',
          label: 'Gemini 3.5 Flash-Lite',
          input_usd_per_mtok: 0.3,
          output_usd_per_mtok: 2.5,
          supports_temperature: true,
          reasoning: 'minimal',
        },
      ],
    },

    openrouter: {
      label: 'OpenRouter (many models, one key)',
      api_base: 'https://openrouter.ai/api/v1',
      auth: 'bearer',
      key_prefix: 'sk-or-',
      default_model: 'anthropic/claude-haiku-4.5',
      // OpenRouter attribution. A deployment can add 'HTTP-Referer' with its own URL.
      extra_headers: { 'X-Title': 'ChallengeForge' },
      models: [
        {
          id: 'anthropic/claude-haiku-4.5',
          label: 'Claude Haiku 4.5 via OpenRouter',
          input_usd_per_mtok: 1,
          output_usd_per_mtok: 5,
          supports_temperature: true,
        },
        {
          id: 'anthropic/claude-sonnet-5',
          label: 'Claude Sonnet 5 via OpenRouter',
          input_usd_per_mtok: 2,
          output_usd_per_mtok: 10,
          supports_temperature: false,
        },
        {
          id: 'openai/gpt-6-luna',
          label: 'GPT-6 Luna via OpenRouter',
          input_usd_per_mtok: 0.1,
          output_usd_per_mtok: 0.5,
          supports_temperature: false,
          reasoning: 'low',
        },
        {
          id: 'google/gemini-3.8-flash',
          label: 'Gemini 3.8 Flash via OpenRouter',
          input_usd_per_mtok: 0.75,
          output_usd_per_mtok: 3.75,
          supports_temperature: true,
          reasoning: 'low',
        },
      ],
    },
  },
}
