/**
 * The same environment variables configure model calls in the web app and
 * the CLI (`run-jobs`). Validated once; errors name the variable, never a value.
 */
import { createHmac } from 'node:crypto'
import { z } from 'zod'
import { createProviderRegistry, parseGatewayConfig } from '@challengeforge/llm-gateway'
import type { ServicesConfig } from './index'

const EnvSchema = z.object({
  /** 'mock' answers every model call locally (development, CI); 'live' calls real providers. */
  LLM_MODE: z.enum(['mock', 'live']).default('mock'),
  LLM_BUDGET_USD_PER_USER: z.coerce.number().nonnegative().default(2),
  BETTER_AUTH_SECRET: z.string().min(32),
  CANARY_SECRET: z.string().min(16).optional(),
  BYOK_ENCRYPTION_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
})

export function servicesConfigFromEnv(env: Record<string, string | undefined>): ServicesConfig {
  const parsed = EnvSchema.safeParse(env)
  if (!parsed.success) {
    throw new Error(`Invalid model configuration - ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
  }
  const e = parsed.data
  return {
    gateway: parseGatewayConfig({
      llmMock: e.LLM_MODE === 'mock',
      platformBudgetUsdPerUser: e.LLM_BUDGET_USD_PER_USER,
      byokEnabled: Boolean(e.BYOK_ENCRYPTION_KEY),
      byokEncryptionKey: e.BYOK_ENCRYPTION_KEY ?? null,
      enabledProviders: createProviderRegistry().knownProviders(),
      platformKeys: { anthropic: e.ANTHROPIC_API_KEY, openai: e.OPENAI_API_KEY, google: e.GOOGLE_API_KEY, openrouter: e.OPENROUTER_API_KEY },
    }),
    // A separate canary secret is optional: by default one is derived from the auth secret.
    canarySecret: e.CANARY_SECRET ?? createHmac('sha256', e.BETTER_AUTH_SECRET).update('challengeforge:canary').digest('hex'),
  }
}
