/**
 * First-run setup (Phase 4, R2). A site with no admin can be claimed once,
 * in the browser, by whoever holds a setup token: the SETUP_TOKEN
 * environment variable (set in hPanel) or a one-hour token from
 * `cli setup-token`. Claiming makes the new account the site's admin and
 * spends every token; afterwards the wizard is gone for good.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import { transact } from '../tx'
import type { Db } from '../client'

const TOKEN_TTL_MS = 60 * 60_000
/** An environment token shorter than this is ignored (too guessable). */
export const MIN_SETUP_TOKEN_LENGTH = 24

const sha256 = (value: string): Buffer => createHash('sha256').update(value, 'utf8').digest()

/** True while the site has no admin. */
export async function needsSetup(db: Db, siteId: string): Promise<boolean> {
  const admin = await db.selectFrom('memberships').select('user_id').where('site_id', '=', siteId).where('role', '=', 'admin').executeTakeFirst()
  return admin === undefined
}

/** A one-hour setup token (CLI). Only its hash is stored. */
export async function createSetupToken(db: Db, siteId: string, now: Date = new Date()): Promise<string> {
  const token = randomBytes(24).toString('base64url')
  await db.insertInto('setup_tokens').values({ token_hash: sha256(token).toString('hex'), site_id: siteId, expires_at: new Date(now.getTime() + TOKEN_TTL_MS) }).execute()
  return token
}

/** Checks a presented token against the environment token and the stored ones, in constant time. */
export async function setupTokenValid(db: Db, siteId: string, presented: string, envToken: string | undefined, now: Date = new Date()): Promise<boolean> {
  if (presented.length === 0 || presented.length > 200) return false
  const hash = sha256(presented)
  if (envToken && envToken.length >= MIN_SETUP_TOKEN_LENGTH && timingSafeEqual(hash, sha256(envToken))) return true
  const row = await db
    .selectFrom('setup_tokens')
    .select('token_hash')
    .where('token_hash', '=', hash.toString('hex'))
    .where('site_id', '=', siteId)
    .where('expires_at', '>', now)
    .executeTakeFirst()
  return row !== undefined
}

/**
 * Makes `userId` the site's first admin, if it still has none (two
 * browsers finishing at once: only the first wins). Spends all tokens.
 */
export async function claimSite(db: Db, siteId: string, userId: string): Promise<boolean> {
  return transact(db, async (trx) => {
    // Serialise claims on the site row.
    await trx.selectFrom('sites').select('id').where('id', '=', siteId).forUpdate().executeTakeFirst()
    const admin = await trx.selectFrom('memberships').select('user_id').where('site_id', '=', siteId).where('role', '=', 'admin').executeTakeFirst()
    if (admin) return false
    await trx
      .insertInto('memberships')
      .values({ site_id: siteId, user_id: userId, role: 'admin', created_at: new Date() })
      .onDuplicateKeyUpdate({ role: 'admin' })
      .execute()
    await trx.deleteFrom('setup_tokens').where('site_id', '=', siteId).execute()
    return true
  })
}

/** The account id for an email, if any (setup looks up the account Better Auth just created). */
export async function userIdByEmail(db: Db, email: string): Promise<string | null> {
  const row = await db.selectFrom('user').select('id').where('email', '=', email.trim().toLowerCase()).executeTakeFirst()
  return row?.id ?? null
}

/** Removes an account created for a setup that then lost the claim (so no orphan account remains). */
export async function discardSetupAccount(db: Db, userId: string): Promise<void> {
  await transact(db, async (trx) => {
    await trx.deleteFrom('session').where('userId', '=', userId).execute()
    await trx.deleteFrom('account').where('userId', '=', userId).execute()
    await trx.deleteFrom('memberships').where('user_id', '=', userId).execute()
    await trx.deleteFrom('user').where('id', '=', userId).execute()
  })
}
