import 'server-only'
import { betterAuth } from 'better-auth'
import { nextCookies } from 'better-auth/next-js'
import { recordAudit, redeemLtiTicket } from '@challengeforge/db'
import { db } from './db'
import { env } from './env'
import { ltiSessionPlugin } from './lti-session-plugin'
import { mailer, passwordResetMessage, sendInBackground, verificationMessage } from './mail'
import { currentSiteContext, siteContextForRequest, type SiteContext } from './site'
import { rateLimitsDisabledForTests } from './test-switches'

/**
 * Accounts (PLAN.md §6.4): Better Auth on the same database and pool.
 * Email + password; password reset and (optionally) email verification by
 * mail. Roles are NOT here: they live in `memberships`, per site.
 *
 * One instance per SITE (Phase 4, R4): each has its own base URL (mail links
 * point at the right domain) and trusted origin; accounts are shared by the
 * whole install, and session cookies belong to each domain.
 */
function createAuth(ctx: SiteContext) {
  const config = env()
  const mail = mailer()
  if (config.REQUIRE_EMAIL_VERIFICATION && !mail.enabled) {
    throw new Error('Invalid configuration - REQUIRE_EMAIL_VERIFICATION needs outgoing mail (MAIL_MODE=smtp).')
  }
  const siteName = ctx.site.name
  return betterAuth({
    appName: siteName,
    baseURL: ctx.baseUrl,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [ctx.baseUrl],
    database: { db: db(), type: 'mysql' },
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 10,
      maxPasswordLength: 128,
      requireEmailVerification: config.REQUIRE_EMAIL_VERIFICATION,
      resetPasswordTokenExpiresIn: 60 * 60,
      // A reset signs the account out everywhere, so a stolen session dies with the old password.
      revokeSessionsOnPasswordReset: true,
      ...(mail.enabled
        ? { sendResetPassword: async ({ user, url }) => sendInBackground(passwordResetMessage(user.email, user.name, url, siteName), 'a password reset') }
        : {}),
      // The password has already changed: a failed audit write is logged, never turned into an error for the user.
      onPasswordReset: async ({ user }) => {
        try {
          await recordAudit(db(), { siteId: ctx.site.id, principal: { userId: user.id, role: 'learner' } }, { action: 'account.password_reset', targetType: 'user', targetId: user.id })
        } catch (cause) {
          console.error('[auth] could not audit a password reset', cause)
        }
      },
    },
    ...(mail.enabled
      ? {
          emailVerification: {
            sendOnSignUp: config.REQUIRE_EMAIL_VERIFICATION,
            autoSignInAfterVerification: true,
            expiresIn: 60 * 60 * 24,
            sendVerificationEmail: async ({ user, url }) => sendInBackground(verificationMessage(user.email, user.name, url, siteName), 'an email confirmation'),
          },
        }
      : {}),
    session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
    // In-memory limits reset when the host idles the process; they still blunt bursts.
    rateLimit: { enabled: !rateLimitsDisabledForTests(), window: 60, max: 30 },
    advanced: { useSecureCookies: ctx.baseUrl.startsWith('https://') },
    plugins: [nextCookies(), ltiSessionPlugin((ticket) => redeemLtiTicket(db(), ticket))],
  })
}

type Auth = ReturnType<typeof createAuth>
const globalForAuth = globalThis as unknown as { cfAuth?: Map<string, Auth> }

/** The auth instance for a site (created once per site and base URL). */
export function authFor(ctx: SiteContext): Auth {
  globalForAuth.cfAuth ??= new Map()
  const key = `${ctx.site.id}|${ctx.baseUrl}|${ctx.site.name}`
  let instance = globalForAuth.cfAuth.get(key)
  if (!instance) {
    instance = createAuth(ctx)
    globalForAuth.cfAuth.set(key, instance)
  }
  return instance
}

/** Auth for the site of the current request. */
export async function siteAuth(): Promise<Auth> {
  return authFor(await currentSiteContext())
}

export async function authForRequest(request: Request): Promise<Auth> {
  return authFor(await siteContextForRequest(request))
}
