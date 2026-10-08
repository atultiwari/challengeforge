/**
 * The audit log: append-only, one row per consequential change. Written in
 * the same transaction as the change where possible, so the log never claims
 * a change that rolled back.
 */
import type { Db } from '../client'
import { newId } from '../ids'
import { fromJson, toJson } from '../json'
import { requireRole, type Scope } from '../scope'

export type AuditAction =
  | 'role.changed'
  | 'challenge.published'
  | 'challenge.archived'
  | 'assessment.overridden'
  | 'pack.imported'
  | 'account.password_reset'

export interface AuditEntry {
  action: AuditAction
  targetType: string
  targetId: string
  details?: Record<string, unknown>
}

export interface AuditRecord extends Required<AuditEntry> {
  id: string
  actorId: string
  actorName: string | null
  at: Date
}

const PAGE_LIMIT = 100

/** Who did it: the signed-in user, or the system source (CLI, webhook) when there is none. */
const actorOf = (scope: Scope, system: string): string => scope.principal?.userId ?? `system:${system}`

export async function recordAudit(db: Db, scope: Scope, entry: AuditEntry, system = 'unknown'): Promise<void> {
  await db
    .insertInto('audit_log')
    .values({
      id: newId(),
      site_id: scope.siteId,
      actor_id: actorOf(scope, system).slice(0, 64),
      action: entry.action,
      target_type: entry.targetType.slice(0, 32),
      target_id: entry.targetId.slice(0, 64),
      details: entry.details === undefined ? null : toJson(entry.details),
      created_at: new Date(),
    })
    .execute()
}

/** Newest first, a page at a time. Admins only. */
export async function listAudit(db: Db, scope: Scope, options: { before?: Date; limit?: number } = {}): Promise<AuditRecord[]> {
  requireRole(scope, 'admin')
  const limit = Math.min(Math.max(1, options.limit ?? PAGE_LIMIT), PAGE_LIMIT)
  let query = db
    .selectFrom('audit_log')
    .leftJoin('user', 'user.id', 'audit_log.actor_id')
    .select([
      'audit_log.id as id',
      'audit_log.actor_id as actorId',
      'user.name as actorName',
      'audit_log.action as action',
      'audit_log.target_type as targetType',
      'audit_log.target_id as targetId',
      'audit_log.details as details',
      'audit_log.created_at as at',
    ])
    .where('audit_log.site_id', '=', scope.siteId)
  if (options.before) query = query.where('audit_log.created_at', '<', options.before)
  const rows = await query.orderBy('audit_log.created_at', 'desc').orderBy('audit_log.id', 'desc').limit(limit).execute()
  return rows.map((r) => ({
    ...r,
    action: r.action as AuditAction,
    actorName: r.actorName ?? null,
    details: r.details === null ? {} : fromJson<Record<string, unknown>>(r.details),
  }))
}
