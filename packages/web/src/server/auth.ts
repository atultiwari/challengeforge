import 'server-only'
import { betterAuth } from 'better-auth'
import { nextCookies } from 'better-auth/next-js'
import { db } from './db'
import { env } from './env'

/**
 * Accounts (PLAN.md §6.4): Better Auth on the same database and pool.
 * Email + password for Phase 1; email verification arrives with outgoing
 * mail in Phase 3. Roles are NOT here: they live in `memberships`, per site.
 */
function createAuth() {
  const config = env()
  return betterAuth({
    appName: config.SITE_NAME,
    baseURL: config.APP_URL,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.APP_URL],
    database: { db: db(), type: 'mysql' },
    emailAndPassword: { enabled: true, minPasswordLength: 10, maxPasswordLength: 128 },
    session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
    // In-memory limits reset when the host idles the process; they still blunt bursts.
    rateLimit: { enabled: true, window: 60, max: 30 },
    advanced: { useSecureCookies: config.APP_URL.startsWith('https://') },
    plugins: [nextCookies()],
  })
}

type Auth = ReturnType<typeof createAuth>
const globalForAuth = globalThis as unknown as { cfAuth?: Auth }

export function auth(): Auth {
  globalForAuth.cfAuth ??= createAuth()
  return globalForAuth.cfAuth
}
