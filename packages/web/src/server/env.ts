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
  // Model settings (LLM_MODE, provider keys, BYOK, CANARY_SECRET) are validated by packages/services.
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
  cached = parsed.data
  return cached
}
