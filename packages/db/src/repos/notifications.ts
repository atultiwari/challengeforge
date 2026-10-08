/**
 * Notifications (Phase 4, R3). Events queue a row here inside their own
 * transaction; `run-jobs` sends due rows (packages/services). A person may
 * turn these update emails off; account emails (password reset,
 * confirmation) are separate and always sent.
 */
import type { Db } from '../client'
import { newId } from '../ids'
import { fromJson, toBool, toJson } from '../json'
import { requireSignedIn, type Scope } from '../scope'

export type NotificationKind = 'certificate_issued' | 'review_decided' | 'cohort_joined'

export interface DueNotification {
  id: string
  siteId: string
  userId: string
  kind: NotificationKind
  payload: Record<string, unknown>
  email: string
  name: string
  /** False when the person turned update emails off. */
  wantsUpdates: boolean
}

const MAX_FAILURES = 6
const backoffMs = (failures: number): number => Math.min(60, 2 ** failures) * 60_000
const CLAIM_MS = 10 * 60_000

/** Queues a notification (call inside the transaction that caused it). */
export async function queueNotification(trx: Db, siteId: string, userId: string, kind: NotificationKind, payload: Record<string, unknown>, now: Date = new Date()): Promise<void> {
  await trx
    .insertInto('notifications')
    .values({ id: newId(), site_id: siteId, user_id: userId, kind, payload: toJson(payload), status: 'pending', failures: 0, next_attempt_at: now, last_error: null, created_at: now, updated_at: now })
    .execute()
}

/** Due notifications, oldest first, each claimed for this run (overlapping cron runs never double-send). */
export async function claimDueNotifications(db: Db, limit: number, now: Date = new Date()): Promise<DueNotification[]> {
  const rows = await db
    .selectFrom('notifications')
    .innerJoin('user', 'user.id', 'notifications.user_id')
    .leftJoin('mail_preferences', (j) => j.onRef('mail_preferences.site_id', '=', 'notifications.site_id').onRef('mail_preferences.user_id', '=', 'notifications.user_id'))
    .select([
      'notifications.id as id',
      'notifications.site_id as siteId',
      'notifications.user_id as userId',
      'notifications.kind as kind',
      'notifications.payload as payload',
      'user.email as email',
      'user.name as name',
      'mail_preferences.updates as updates',
    ])
    .where('notifications.status', '=', 'pending')
    .where('notifications.next_attempt_at', '<=', now)
    .orderBy('notifications.next_attempt_at')
    .limit(limit)
    .execute()
  const claimed: DueNotification[] = []
  for (const r of rows) {
    const result = await db
      .updateTable('notifications')
      .set({ next_attempt_at: new Date(now.getTime() + CLAIM_MS) })
      .where('id', '=', r.id)
      .where('status', '=', 'pending')
      .where('next_attempt_at', '<=', now)
      .executeTakeFirst()
    if (Number(result.numUpdatedRows) !== 1) continue
    claimed.push({
      id: r.id,
      siteId: r.siteId,
      userId: r.userId,
      kind: r.kind as NotificationKind,
      payload: fromJson<Record<string, unknown>>(r.payload),
      email: r.email,
      name: r.name,
      wantsUpdates: r.updates === null ? true : toBool(r.updates),
    })
  }
  return claimed
}

export async function finishNotification(db: Db, id: string, outcome: 'sent' | 'skipped', now: Date = new Date()): Promise<void> {
  await db.updateTable('notifications').set({ status: outcome, last_error: null, updated_at: now }).where('id', '=', id).execute()
}

export async function failNotification(db: Db, id: string, error: string, now: Date = new Date()): Promise<void> {
  const row = await db.selectFrom('notifications').select('failures').where('id', '=', id).executeTakeFirst()
  if (!row) return
  const failures = row.failures + 1
  await db
    .updateTable('notifications')
    .set({
      failures,
      last_error: error.slice(0, 500),
      updated_at: now,
      ...(failures >= MAX_FAILURES ? { status: 'failed' as const } : { next_attempt_at: new Date(now.getTime() + backoffMs(failures)) }),
    })
    .where('id', '=', id)
    .execute()
}

export async function getMailPreferences(db: Db, scope: Scope): Promise<{ updates: boolean }> {
  const p = requireSignedIn(scope)
  const row = await db.selectFrom('mail_preferences').select('updates').where('site_id', '=', scope.siteId).where('user_id', '=', p.userId).executeTakeFirst()
  return { updates: row ? toBool(row.updates) : true }
}

export async function setMailPreferences(db: Db, scope: Scope, prefs: { updates: boolean }): Promise<void> {
  const p = requireSignedIn(scope)
  const now = new Date()
  await db
    .insertInto('mail_preferences')
    .values({ site_id: scope.siteId, user_id: p.userId, updates: prefs.updates, updated_at: now })
    .onDuplicateKeyUpdate({ updates: prefs.updates, updated_at: now })
    .execute()
}
