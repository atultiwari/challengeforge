/**
 * WordPress connector (Phase 5, S4). One WordPress site per ChallengeForge
 * site may send its signed-in users here. Users are linked by their
 * WordPress user id on that connection, never by email (an email match
 * would let a WordPress account take over an existing account).
 */
import { createHash } from 'node:crypto'
import type { Db } from '../client'
import { newId } from '../ids'
import { toBool } from '../json'
import { NotFoundError, ValidationError, requireRole, type Scope } from '../scope'
import { transact } from '../tx'
import { recordAudit } from './audit'
import { isAllowedOutboundUrl } from './lti-platforms'

export interface WpConnection {
  wpUrl: string
  enabled: boolean
  createdAt: Date
}

/** Connects (or re-keys) the WordPress site. The caller seals the new secret; the old one stops working at once. */
export async function saveWpConnection(db: Db, scope: Scope, wpUrl: string, secretSealed: string): Promise<void> {
  requireRole(scope, 'admin')
  const url = wpUrl.trim().replace(/\/+$/, '')
  if (!isAllowedOutboundUrl(url)) throw new ValidationError('Enter the WordPress site address, e.g. https://blog.example.org.')
  const now = new Date()
  await transact(db, async (trx) => {
    const previous = await trx.selectFrom('wp_connections').select('wp_url').where('site_id', '=', scope.siteId).forUpdate().executeTakeFirst()
    // A different WordPress site has different users: its user 1 is not the old site's user 1.
    if (previous && previous.wp_url !== url) await trx.deleteFrom('wp_users').where('site_id', '=', scope.siteId).execute()
    await trx
      .insertInto('wp_connections')
      .values({ site_id: scope.siteId, wp_url: url, secret_sealed: secretSealed, enabled: true, created_at: now, updated_at: now })
      .onDuplicateKeyUpdate({ wp_url: url, secret_sealed: secretSealed, enabled: true, updated_at: now })
      .execute()
    await recordAudit(trx, scope, { action: 'site.settings_saved', targetType: 'site', targetId: scope.siteId, details: { changed: ['wordpress'], wpUrl: url } })
  })
}

export async function getWpConnection(db: Db, scope: Scope): Promise<WpConnection | null> {
  requireRole(scope, 'admin')
  const row = await db.selectFrom('wp_connections').select(['wp_url', 'enabled', 'created_at']).where('site_id', '=', scope.siteId).executeTakeFirst()
  return row ? { wpUrl: row.wp_url, enabled: toBool(row.enabled), createdAt: row.created_at } : null
}

export async function setWpEnabled(db: Db, scope: Scope, enabled: boolean): Promise<void> {
  requireRole(scope, 'admin')
  const result = await db.updateTable('wp_connections').set({ enabled, updated_at: new Date() }).where('site_id', '=', scope.siteId).executeTakeFirst()
  if (Number(result.numUpdatedRows) === 0) throw new NotFoundError('No WordPress site is connected.')
}

/** @internal: the live connection for sign-in (with its sealed secret). */
export async function wpConnectionForSso(db: Db, siteId: string): Promise<{ wpUrl: string; secretSealed: string } | null> {
  const row = await db.selectFrom('wp_connections').select(['wp_url', 'secret_sealed', 'enabled']).where('site_id', '=', siteId).executeTakeFirst()
  return row && toBool(row.enabled) ? { wpUrl: row.wp_url, secretSealed: row.secret_sealed } : null
}

/** Spends a sign-on token id: true the first time, false ever after (replay). */
export async function spendSsoJti(db: Db, jti: string, expiresAt: Date): Promise<boolean> {
  if (jti.length < 8 || jti.length > 64) return false
  const result = await db.insertInto('sso_jtis').values({ jti, expires_at: expiresAt }).ignore().executeTakeFirst()
  return Number(result.numInsertedOrUpdatedRows ?? 0) === 1
}

/** The local account for a WordPress user on this site, created on first sign-on. */
export async function linkWpUser(db: Db, siteId: string, wpUserId: string, name: string, now: Date = new Date()): Promise<string> {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(wpUserId)) throw new ValidationError('The WordPress sign-on has no usable user id.')
  const find = () => db.selectFrom('wp_users').select('user_id').where('site_id', '=', siteId).where('wp_user_id', '=', wpUserId).executeTakeFirst()
  const existing = await find()
  // Linked before: their membership is whatever an admin made it (removing them is not undone by signing in again).
  if (existing) return existing.user_id
  const userId = newId()
  const handle = createHash('sha256').update(`${siteId}:${wpUserId}`).digest('hex').slice(0, 24)
  try {
    await transact(db, async (trx) => {
      await trx
        .insertInto('user')
        .values({ id: userId, name: (name.trim() || 'WordPress member').slice(0, 100), email: `wp-${handle}@wp.invalid`, emailVerified: false, image: null, createdAt: now, updatedAt: now })
        .execute()
      await trx.insertInto('memberships').values({ site_id: siteId, user_id: userId, role: 'learner', created_at: now }).execute()
      await trx.insertInto('wp_users').values({ site_id: siteId, wp_user_id: wpUserId, user_id: userId, created_at: now }).execute()
    })
    return userId
  } catch (err) {
    const winner = await find()
    if (winner) return winner.user_id
    throw err
  }
}

/** Spent ids are kept well past expiry (the verifier allows a minute of clock skew), so purging can never reopen a replay. */
const JTI_KEEP_MS = 10 * 60_000

/** Removes spent sign-on token ids once they could no longer be used anyway. */
export async function purgeSsoJtis(db: Db, now: Date = new Date()): Promise<number> {
  const result = await db.deleteFrom('sso_jtis').where('expires_at', '<', new Date(now.getTime() - JTI_KEEP_MS)).executeTakeFirst()
  return Number(result.numDeletedRows)
}
