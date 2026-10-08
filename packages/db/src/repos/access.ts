/**
 * Who may play what (Phase 3, Q4). Everything outside a restricted pack is
 * open. A restricted pack is playable by:
 *   - editors and admins, and anyone who may edit the challenge;
 *   - a holder of a live grant (admin, payment or LTI; not revoked, not expired);
 *   - a member of a live cohort that is assigned the pack or the challenge.
 * Cohort access is derived, not stored, so it ends when someone leaves the
 * cohort, the cohort is archived, or the assignment is removed.
 */
import type { Db } from '../client'
import { newId } from '../ids'
import { NotFoundError, ValidationError, hasRole, requireRole, type Scope } from '../scope'
import type { GrantSource, PackAccess } from '../schema'
import { recordAudit } from './audit'
import { normaliseEmail, type EmailLookup } from './people'
import { canEdit } from './collaborators'

export interface Grant {
  id: string
  userId: string
  name: string
  email: string
  source: GrantSource
  expiresAt: Date | null
  revokedAt: Date | null
  createdAt: Date
}

export const LOCKED_MESSAGE = 'This challenge is part of a pack you do not have access to yet.'

/** Packs (of those given) the user holds a live grant for. */
async function grantedPacks(db: Db, siteId: string, userId: string, packIds: string[], now: Date): Promise<Set<string>> {
  if (packIds.length === 0) return new Set()
  const rows = await db
    .selectFrom('access_grants')
    .select('pack_id')
    .where('site_id', '=', siteId)
    .where('user_id', '=', userId)
    .where('pack_id', 'in', packIds)
    .where('revoked_at', 'is', null)
    .where((eb) => eb.or([eb('expires_at', 'is', null), eb('expires_at', '>', now)]))
    .execute()
  return new Set(rows.map((r) => r.pack_id))
}

/** Packs and single challenges the user's live cohorts are assigned. */
async function cohortAssigned(db: Db, siteId: string, userId: string): Promise<{ packs: Set<string>; challenges: Set<string> }> {
  const rows = await db
    .selectFrom('cohort_members')
    .innerJoin('cohorts', 'cohorts.id', 'cohort_members.cohort_id')
    .innerJoin('cohort_assignments', 'cohort_assignments.cohort_id', 'cohorts.id')
    .select(['cohort_assignments.pack_id as packId', 'cohort_assignments.challenge_id as challengeId'])
    .where('cohort_members.site_id', '=', siteId)
    .where('cohort_members.user_id', '=', userId)
    .where('cohorts.archived', '=', false)
    .execute()
  return {
    packs: new Set(rows.flatMap((r) => (r.packId ? [r.packId] : []))),
    challenges: new Set(rows.flatMap((r) => (r.challengeId ? [r.challengeId] : []))),
  }
}

/** True when the caller may start (and play) this challenge. */
export async function canPlay(db: Db, scope: Scope, challengeId: string, now: Date = new Date()): Promise<boolean> {
  const row = await db
    .selectFrom('challenges')
    .leftJoin('packs', 'packs.id', 'challenges.pack_id')
    .select(['challenges.id as id', 'challenges.created_by as created_by', 'challenges.pack_id as packId', 'packs.access as access'])
    .where('challenges.id', '=', challengeId)
    .where('challenges.site_id', '=', scope.siteId)
    .executeTakeFirst()
  if (!row) return false
  if (row.packId === null || row.access !== 'restricted') return true
  if (!scope.principal) return false
  if (hasRole(scope, 'editor') || (await canEdit(db, scope, row))) return true
  if ((await grantedPacks(db, scope.siteId, scope.principal.userId, [row.packId], now)).has(row.packId)) return true
  const assigned = await cohortAssigned(db, scope.siteId, scope.principal.userId)
  return assigned.packs.has(row.packId) || assigned.challenges.has(challengeId)
}

/** @internal: a pack's access mode, or null if it is not on this site. */
export async function packAccessMode(db: Db, siteId: string, packId: string): Promise<PackAccess | null> {
  const row = await db.selectFrom('packs').select('access').where('id', '=', packId).where('site_id', '=', siteId).executeTakeFirst()
  return row?.access ?? null
}

/** True when the caller can play the whole pack (open, editor, a live grant, or a cohort assigned the pack). */
export async function canPlayPack(db: Db, scope: Scope, packId: string, now: Date = new Date()): Promise<boolean> {
  const pack = await db.selectFrom('packs').select('access').where('id', '=', packId).where('site_id', '=', scope.siteId).executeTakeFirst()
  if (!pack) return false
  if (pack.access !== 'restricted') return true
  if (!scope.principal) return false
  if (hasRole(scope, 'editor')) return true
  if ((await grantedPacks(db, scope.siteId, scope.principal.userId, [packId], now)).has(packId)) return true
  return (await cohortAssigned(db, scope.siteId, scope.principal.userId)).packs.has(packId)
}

/**
 * For the catalogue: which of these challenges the caller cannot play yet.
 * One pass, not one query per challenge.
 */
export async function lockedChallengeIds(db: Db, scope: Scope, items: readonly { id: string; packId: string | null }[], now: Date = new Date()): Promise<Set<string>> {
  const packIds = [...new Set(items.flatMap((i) => (i.packId ? [i.packId] : [])))]
  if (packIds.length === 0) return new Set()
  const restricted = new Set(
    (await db.selectFrom('packs').select('id').where('site_id', '=', scope.siteId).where('id', 'in', packIds).where('access', '=', 'restricted').execute()).map((r) => r.id),
  )
  const candidates = items.filter((i) => i.packId !== null && restricted.has(i.packId))
  if (candidates.length === 0) return new Set()
  if (!scope.principal) return new Set(candidates.map((i) => i.id))
  if (hasRole(scope, 'editor')) return new Set()
  const granted = await grantedPacks(db, scope.siteId, scope.principal.userId, [...restricted], now)
  const assigned = await cohortAssigned(db, scope.siteId, scope.principal.userId)
  const locked = new Set<string>()
  for (const i of candidates) {
    if (granted.has(i.packId!) || assigned.packs.has(i.packId!) || assigned.challenges.has(i.id)) continue
    // Authors keep access to what they edit (rare in a locked pack; checked one by one).
    if (hasRole(scope, 'author')) {
      const row = await db.selectFrom('challenges').select(['id', 'created_by']).where('id', '=', i.id).executeTakeFirstOrThrow()
      if (await canEdit(db, scope, row)) continue
    }
    locked.add(i.id)
  }
  return locked
}

export async function setPackAccess(db: Db, scope: Scope, packId: string, access: PackAccess): Promise<void> {
  requireRole(scope, 'admin')
  await db.transaction().execute(async (trx) => {
    const result = await trx.updateTable('packs').set({ access }).where('id', '=', packId).where('site_id', '=', scope.siteId).executeTakeFirst()
    if (Number(result.numUpdatedRows) === 0) {
      const exists = await trx.selectFrom('packs').select('id').where('id', '=', packId).where('site_id', '=', scope.siteId).executeTakeFirst()
      if (!exists) throw new NotFoundError('Pack not found.')
      return
    }
    await recordAudit(trx, scope, { action: 'pack.access_set', targetType: 'pack', targetId: packId, details: { access } })
  })
}

/**
 * Records a grant from a payment or an LTI launch (no permission check: the
 * caller has already verified the payment or the launch). A payment that is
 * applied again re-activates its grant; with `revive: false` (LTI launches)
 * a grant an admin revoked STAYS revoked, and only a live one is extended.
 */
export async function grantFromSource(
  trx: Db,
  siteId: string,
  userId: string,
  packId: string,
  source: GrantSource,
  sourceRef: string,
  expiresAt: Date | null = null,
  options: { revive?: boolean } = {},
): Promise<void> {
  const ref = sourceRef.slice(0, 64)
  const values = { id: newId(), site_id: siteId, user_id: userId, pack_id: packId, source, source_ref: ref, expires_at: expiresAt, revoked_at: null, created_at: new Date() }
  if (options.revive !== false) {
    await trx.insertInto('access_grants').values(values).onDuplicateKeyUpdate({ revoked_at: null, expires_at: expiresAt }).execute()
    return
  }
  const inserted = await trx.insertInto('access_grants').values(values).ignore().executeTakeFirst()
  if (Number(inserted.numInsertedOrUpdatedRows ?? 0) > 0) return
  await trx
    .updateTable('access_grants')
    .set({ expires_at: expiresAt })
    .where('site_id', '=', siteId)
    .where('user_id', '=', userId)
    .where('pack_id', '=', packId)
    .where('source', '=', source)
    .where('source_ref', '=', ref)
    .where('revoked_at', 'is', null)
    .execute()
}

export async function revokeFromSource(trx: Db, siteId: string, packId: string, source: GrantSource, sourceRef: string): Promise<void> {
  await trx
    .updateTable('access_grants')
    .set({ revoked_at: new Date() })
    .where('site_id', '=', siteId)
    .where('pack_id', '=', packId)
    .where('source', '=', source)
    .where('source_ref', '=', sourceRef.slice(0, 64))
    .where('revoked_at', 'is', null)
    .execute()
}

/** An admin gives someone access to a pack, by email, optionally until a date. */
export async function grantAccess(db: Db, scope: Scope, packId: string, email: string, expiresAt: Date | null = null, lookup: EmailLookup = {}): Promise<void> {
  requireRole(scope, 'admin')
  const pack = await db.selectFrom('packs').select('id').where('id', '=', packId).where('site_id', '=', scope.siteId).executeTakeFirst()
  if (!pack) throw new NotFoundError('Pack not found.')
  if (expiresAt && expiresAt <= new Date()) throw new ValidationError('The end date must be in the future.')
  const person = await db
    .selectFrom('user')
    .innerJoin('memberships', 'memberships.user_id', 'user.id')
    .select('user.id as userId')
    .where('memberships.site_id', '=', scope.siteId)
    .where('user.email', '=', normaliseEmail(email))
    .$if(lookup.verifiedOnly === true, (q) => q.where('user.emailVerified', '=', true))
    .executeTakeFirst()
  if (!person) throw new ValidationError('Nobody on this site has that email.')
  await db.transaction().execute(async (trx) => {
    await grantFromSource(trx, scope.siteId, person.userId, packId, 'admin', 'admin', expiresAt)
    await recordAudit(trx, scope, { action: 'access.granted', targetType: 'pack', targetId: packId, details: { userId: person.userId, expiresAt: expiresAt?.toISOString() ?? null } })
  })
}

export async function revokeGrant(db: Db, scope: Scope, grantId: string): Promise<void> {
  requireRole(scope, 'admin')
  await db.transaction().execute(async (trx) => {
    const grant = await trx.selectFrom('access_grants').select(['pack_id', 'user_id', 'source']).where('id', '=', grantId).where('site_id', '=', scope.siteId).executeTakeFirst()
    if (!grant) throw new NotFoundError('Grant not found.')
    await trx.updateTable('access_grants').set({ revoked_at: new Date() }).where('id', '=', grantId).where('revoked_at', 'is', null).execute()
    await recordAudit(trx, scope, { action: 'access.revoked', targetType: 'pack', targetId: grant.pack_id, details: { userId: grant.user_id, source: grant.source } })
  })
}

export async function listGrants(db: Db, scope: Scope, packId: string): Promise<Grant[]> {
  requireRole(scope, 'admin')
  return db
    .selectFrom('access_grants')
    .innerJoin('user', 'user.id', 'access_grants.user_id')
    .select([
      'access_grants.id as id',
      'user.id as userId',
      'user.name as name',
      'user.email as email',
      'access_grants.source as source',
      'access_grants.expires_at as expiresAt',
      'access_grants.revoked_at as revokedAt',
      'access_grants.created_at as createdAt',
    ])
    .where('access_grants.site_id', '=', scope.siteId)
    .where('access_grants.pack_id', '=', packId)
    .orderBy('access_grants.created_at', 'desc')
    .limit(2000)
    .execute()
}
