/**
 * Certificates (Phase 3, Q5). When a pack awards them, a learner earns one
 * with a FINAL pass on every published challenge in the pack: results still
 * waiting for review do not count. Issuing happens in the same transaction
 * as the result that completes the pack, so it can never be missed or doubled.
 *
 * A certificate is a snapshot (name, pack title, site name, date) under a
 * random public id; the verify page shows it to anyone holding the id.
 */
import { randomBytes } from 'node:crypto'
import type { Db } from '../client'
import { toBool } from '../json'
import { NotFoundError, ValidationError, requireRole, requireSignedIn, type Scope } from '../scope'
import { recordAudit } from './audit'
import { queueNotification } from './notifications'

export interface Certificate {
  id: string
  userId: string
  packId: string
  recipientName: string
  packTitle: string
  siteName: string
  challengeCount: number
  issuedAt: Date
  revokedAt: Date | null
  revokeReason: string | null
}

/** No padding, lowercase, no look-alike characters; 20 characters ≈ 100 bits. */
const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const ID_LENGTH = 20

export function newCertificateId(): string {
  const bytes = randomBytes(ID_LENGTH)
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('')
}

const COLUMNS = [
  'id',
  'user_id as userId',
  'pack_id as packId',
  'recipient_name as recipientName',
  'pack_title as packTitle',
  'site_name as siteName',
  'challenge_count as challengeCount',
  'issued_at as issuedAt',
  'revoked_at as revokedAt',
  'revoke_reason as revokeReason',
] as const

/** Published, live challenges of a pack. */
async function packChallengeIds(db: Db, packId: string): Promise<string[]> {
  const rows = await db
    .selectFrom('challenges')
    .select('id')
    .where('pack_id', '=', packId)
    .where('published_version_id', 'is not', null)
    .where('status', '!=', 'archived')
    .execute()
  return rows.map((r) => r.id)
}

/** Challenges (of those given) the user has a final pass on. */
async function finallyPassed(db: Db, siteId: string, userId: string, challengeIds: string[]): Promise<Set<string>> {
  if (challengeIds.length === 0) return new Set()
  const rows = await db
    .selectFrom('assessments')
    .innerJoin('attempts', 'attempts.id', 'assessments.attempt_id')
    .select('attempts.challenge_id as challengeId')
    .where('attempts.site_id', '=', siteId)
    .where('attempts.user_id', '=', userId)
    .where('attempts.is_preview', '=', false)
    .where('attempts.challenge_id', 'in', challengeIds)
    .where('assessments.passed', '=', true)
    .where('assessments.status', 'in', ['auto', 'overridden'])
    // A locking read sees results other transactions committed meanwhile (a plain read would use this transaction's snapshot).
    .forUpdate()
    .execute()
  return new Set(rows.map((r) => r.challengeId))
}

/**
 * Issues the pack's certificate if the user now qualifies. Called inside the
 * transaction that recorded a result; a no-op when certificates are off,
 * the user already has one, or something is still missing.
 */
export async function issueCertificateIfEarned(trx: Db, siteId: string, userId: string, challengeId: string, now: Date = new Date()): Promise<string | null> {
  const pack = await trx
    .selectFrom('challenges')
    .innerJoin('packs', 'packs.id', 'challenges.pack_id')
    .select(['packs.id as id', 'packs.title as title', 'packs.certificates_enabled as enabled'])
    .where('challenges.id', '=', challengeId)
    .where('challenges.site_id', '=', siteId)
    .executeTakeFirst()
  if (!pack || !toBool(pack.enabled)) return null
  return issueForPack(trx, siteId, userId, pack.id, pack.title, now)
}

async function issueForPack(trx: Db, siteId: string, userId: string, packId: string, packTitle: string, now: Date): Promise<string | null> {
  // Serialise per learner: two results finishing the pack at once must not each miss the other's pass.
  await trx.selectFrom('memberships').select('user_id').where('site_id', '=', siteId).where('user_id', '=', userId).forUpdate().executeTakeFirst()
  const existing = await trx.selectFrom('certificates').select('id').where('site_id', '=', siteId).where('user_id', '=', userId).where('pack_id', '=', packId).executeTakeFirst()
  if (existing) return null
  const required = await packChallengeIds(trx, packId)
  if (required.length === 0) return null
  const passed = await finallyPassed(trx, siteId, userId, required)
  if (required.some((id) => !passed.has(id))) return null
  const [user, site] = await Promise.all([
    trx.selectFrom('user').select('name').where('id', '=', userId).executeTakeFirst(),
    trx.selectFrom('sites').select('name').where('id', '=', siteId).executeTakeFirst(),
  ])
  if (!user || !site) return null
  const id = newCertificateId()
  const result = await trx
    .insertInto('certificates')
    .values({
      id,
      site_id: siteId,
      user_id: userId,
      pack_id: packId,
      recipient_name: user.name.slice(0, 200),
      pack_title: packTitle.slice(0, 300),
      site_name: site.name.slice(0, 200),
      challenge_count: required.length,
      issued_at: now,
      revoked_at: null,
      revoke_reason: null,
    })
    // Two results finishing the pack at once: the unique key keeps exactly one.
    .ignore()
    .executeTakeFirst()
  if (Number(result.numInsertedOrUpdatedRows ?? 0) === 0) return null
  await queueNotification(trx, siteId, userId, 'certificate_issued', { certificateId: id, packTitle }, now)
  return id
}

/**
 * Turns certificates on or off for a pack. Turning them on also issues them
 * to everyone who already qualifies. Returns how many were issued.
 */
export async function setCertificatesEnabled(db: Db, scope: Scope, packId: string, enabled: boolean): Promise<number> {
  requireRole(scope, 'admin')
  return db.transaction().execute(async (trx) => {
    const pack = await trx.selectFrom('packs').select(['id', 'title']).where('id', '=', packId).where('site_id', '=', scope.siteId).executeTakeFirst()
    if (!pack) throw new NotFoundError('Pack not found.')
    await trx.updateTable('packs').set({ certificates_enabled: enabled }).where('id', '=', packId).execute()
    await recordAudit(trx, scope, { action: 'certificates.set', targetType: 'pack', targetId: packId, details: { enabled } })
    if (!enabled) return 0
    const required = await packChallengeIds(trx, packId)
    if (required.length === 0) return 0
    const candidates = await trx
      .selectFrom('progress')
      .select('user_id')
      .distinct()
      .where('site_id', '=', scope.siteId)
      .where('challenge_id', 'in', required)
      .where('passed_at', 'is not', null)
      .execute()
    let issued = 0
    for (const c of candidates) if (await issueForPack(trx, scope.siteId, c.user_id, packId, pack.title, new Date())) issued += 1
    return issued
  })
}

/** Public: anyone holding the id may see the certificate (and whether it is revoked). */
export async function verifyCertificate(db: Db, siteId: string, id: string): Promise<Certificate | null> {
  if (!/^[a-z0-9]{10,32}$/.test(id)) return null
  return (await db.selectFrom('certificates').select(COLUMNS).where('id', '=', id).where('site_id', '=', siteId).executeTakeFirst()) ?? null
}

export async function listMyCertificates(db: Db, scope: Scope): Promise<Certificate[]> {
  const p = requireSignedIn(scope)
  return db.selectFrom('certificates').select(COLUMNS).where('site_id', '=', scope.siteId).where('user_id', '=', p.userId).orderBy('issued_at', 'desc').execute()
}

export async function listCertificates(db: Db, scope: Scope): Promise<Certificate[]> {
  requireRole(scope, 'admin')
  return db.selectFrom('certificates').select(COLUMNS).where('site_id', '=', scope.siteId).orderBy('issued_at', 'desc').limit(1000).execute()
}

export async function revokeCertificate(db: Db, scope: Scope, id: string, reason: string): Promise<void> {
  requireRole(scope, 'admin')
  const clean = reason.trim()
  if (clean === '' || clean.length > 500) throw new ValidationError('Give a reason (up to 500 characters); it is shown on the verify page.')
  await db.transaction().execute(async (trx) => {
    const result = await trx
      .updateTable('certificates')
      .set({ revoked_at: new Date(), revoke_reason: clean })
      .where('id', '=', id)
      .where('site_id', '=', scope.siteId)
      .where('revoked_at', 'is', null)
      .executeTakeFirst()
    if (Number(result.numUpdatedRows) === 0) throw new NotFoundError('No valid certificate with that id.')
    await recordAudit(trx, scope, { action: 'certificate.revoked', targetType: 'certificate', targetId: id, details: { reason: clean } })
  })
}
