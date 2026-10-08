/** Shared E2E settings. TEST_DB_URL is a server URL (no database), as for the DB integration tests. */
export const SERVER_URL = process.env['TEST_DB_URL'] ?? 'mysql://root:devroot@127.0.0.1:33061'
export const E2E_DB = 'cf_e2e'
export const PORT = 3200
export const BASE_URL = `http://localhost:${PORT}`
/** Outgoing mail lands here as JSON files during E2E (MAIL_MODE=file is refused in production). */
export const MAIL_OUTBOX = `${process.cwd()}/.e2e-mail`

/** A test-only administrator, created by prepare-db through the real CLI. */
export const E2E_ADMIN = { email: 'e2e-admin@example.test', password: 'e2e-admin-password-123' }

export const E2E_ENV: Record<string, string> = {
  DATABASE_URL: `${SERVER_URL}/${E2E_DB}`,
  APP_URL: BASE_URL,
  // Test-only secret; real installs generate their own (docs/DEPLOY-HOSTINGER.md).
  BETTER_AUTH_SECRET: 'e2e-only-secret-not-for-production-0123456789',
  SITE_SLUG: 'e2e',
  SITE_NAME: 'ChallengeForge E2E',
  NEXT_DIST_DIR: '.next-e2e',
  // Many sign-ups in seconds; ignored by the app whenever NODE_ENV is production.
  DISABLE_RATE_LIMITS_FOR_TESTS: 'true',
  MAIL_MODE: 'file',
  MAIL_OUTBOX_DIR: MAIL_OUTBOX,
  // The development payment provider: a test checkout page on our own site (refused in production).
  PAYMENTS_PROVIDER: 'mock',
}
