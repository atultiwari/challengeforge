import 'server-only'
import { betterAuth } from 'better-auth'
import { nextCookies } from 'better-auth/next-js'
import { findSiteBySlug, recordAudit, redeemLtiTicket } from '@challengeforge/db'
import { db } from './db'
import { env } from './env'
import { ltiSessionPlugin } from './lti-session-plugin'
import { mailer, passwordResetMessage, sendInBackground, verificationMessage } from './mail'
import { rateLimitsDisabledForTests } from './test-switches'

/**
 * Accounts (PLAN.md §6.4): Better Auth on the same database and pool.
 * Email + password; password reset and (optionally) email verification by
 * mail. Roles are NOT here: they live in `memberships`, per site.
 */
function createAuth() {
  const config = env()
  const mail = mailer()
  if (config.REQUIRE_EMAIL_VERIFICATION && !mail.enabled) {
    throw new Error('Invalid configuration - REQUIRE_EMAIL_VERIFICATION needs outgoing mail (MAIL_MODE=smtp).')
  }
  return betterAuth({
    appName: config.SITE_NAME,
    baseURL: config.APP_URL,
    secret: config.BETTER_AUTH_SECRET,
    trustedOrigins: [config.APP_URL],
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
        ? { sendResetPassword: async ({ user, url }) => sendInBackground(passwordResetMessage(user.email, user.name, url), 'a password reset') }
        : {}),
      // The password has already changed: a failed audit write is logged, never turned into an error for the user.
      onPasswordReset: async ({ user }) => {
        try {
          const site = await findSiteBySlug(db(), config.SITE_SLUG)
          if (site) await recordAudit(db(), { siteId: site.id, principal: { userId: user.id, role: 'learner' } }, { action: 'account.password_reset', targetType: 'user', targetId: user.id })
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
            sendVerificationEmail: async ({ user, url }) => sendInBackground(verificationMessage(user.email, user.name, url), 'an email confirmation'),
          },
        }
      : {}),
    session: { expiresIn: 60 * 60 * 24 * 14, updateAge: 60 * 60 * 24 },
    // In-memory limits reset when the host idles the process; they still blunt bursts.
    rateLimit: { enabled: !rateLimitsDisabledForTests(), window: 60, max: 30 },
    advanced: { useSecureCookies: config.APP_URL.startsWith('https://') },
    plugins: [nextCookies(), ltiSessionPlugin((ticket) => redeemLtiTicket(db(), ticket))],
  })
}

type Auth = ReturnType<typeof createAuth>
const globalForAuth = globalThis as unknown as { cfAuth?: Auth }

export function auth(): Auth {
  globalForAuth.cfAuth ??= createAuth()
  return globalForAuth.cfAuth
}
