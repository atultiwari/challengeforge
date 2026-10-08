/**
 * Creates an account through Better Auth itself, so the password is hashed
 * exactly as the website will verify it. The password comes from the
 * environment, never from the command line (shell history, process list).
 */
import { betterAuth } from 'better-auth'
import type { Db } from '@challengeforge/db'

const MIN_PASSWORD = 10

export async function createUserWithPassword(db: Db, email: string, name: string, password: string | undefined): Promise<string> {
  if (!password || password.length < MIN_PASSWORD) {
    throw new Error(`Set ADMIN_PASSWORD (at least ${MIN_PASSWORD} characters) in the environment for this command.`)
  }
  const secret = process.env['BETTER_AUTH_SECRET']
  if (!secret || secret.length < 32) throw new Error('Set BETTER_AUTH_SECRET (the same value the website uses).')
  const auth = betterAuth({
    secret,
    baseURL: process.env['APP_URL'] ?? 'http://localhost',
    database: { db, type: 'mysql' },
    emailAndPassword: { enabled: true, minPasswordLength: MIN_PASSWORD, maxPasswordLength: 128 },
  })
  const result = await auth.api.signUpEmail({ body: { email, password, name } })
  return result.user.id
}
