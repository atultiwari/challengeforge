import 'server-only'
import { z } from 'zod'

/** Fails fast at startup with a clear message when configuration is missing. */
const EnvSchema = z.object({
  DATABASE_URL: z.string().regex(/^(mysql|mariadb):\/\//, 'DATABASE_URL must be a mysql:// URL'),
  BETTER_AUTH_SECRET: z.string().min(32, 'BETTER_AUTH_SECRET must be at least 32 characters'),
  APP_URL: z.url().transform((u) => u.replace(/\/$/, '')),
  SITE_SLUG: z.string().min(1).default('main'),
  SITE_NAME: z.string().min(1).default('ChallengeForge'),
  DB_CONNECTION_LIMIT: z.coerce.number().int().positive().max(50).default(5),
  /** 'mock' answers every model call locally (development, CI); 'live' calls real providers. */
  LLM_MODE: z.enum(['mock', 'live']).default('mock'),
  LLM_BUDGET_USD_PER_USER: z.coerce.number().nonnegative().default(2),
  /** Secret for per-learner canaries; falls back to one derived from BETTER_AUTH_SECRET. */
  CANARY_SECRET: z.string().min(16).optional(),
  /** 32 bytes, base64, to encrypt learners' own API keys. BYOK is off without it. */
  BYOK_ENCRYPTION_KEY: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  GOOGLE_API_KEY: z.string().optional(),
  OPENROUTER_API_KEY: z.string().optional(),
})
export type Env = z.infer<typeof EnvSchema>

let cached: Env | null = null

export function env(): Env {
  if (cached) return cached
  const parsed = EnvSchema.safeParse(process.env)
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    throw new Error(`Invalid configuration - ${problems}`)
  }
  if (parsed.data.LLM_MODE === 'mock' && process.env.NODE_ENV === 'production' && process.env['ALLOW_MOCK_LLM_IN_PRODUCTION'] !== 'true') {
    // A live site must never answer AI missions with canned replies by accident.
    console.warn('[env] LLM_MODE is mock in production: AI missions will use canned replies. Set LLM_MODE=live with provider keys.')
  }
  cached = parsed.data
  return cached
}
