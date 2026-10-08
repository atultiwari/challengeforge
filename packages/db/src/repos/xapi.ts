/**
 * The facts behind xAPI statements (Phase 5, S2): attempts started and
 * results recorded, with what they are about. packages/services turns them
 * into statements. Preview attempts never count; results waiting for review
 * are left out until decided.
 */
import { sql } from 'kysely'
import type { Db } from '../client'
import { toBool } from '../json'
import { NotFoundError, ValidationError, requireRole, type Scope } from '../scope'
import { recordAudit } from './audit'
import { assignedChallenges } from './cohort-progress'
import { requireCohortManager } from './cohorts'
import { isAllowedOutboundUrl } from './lti-platforms'
import { transact } from '../tx'

export interface LearningFact {
  kind: 'attempted' | 'result'
  attemptId: string
  userId: string
  challengeId: string
  challengeTitle: string
  packSlug: string | null
  at: Date
  /** For results. */
  passed?: boolean
  score?: number
  max?: number
}

export interface FactFilter {
  userIds?: readonly string[]
  challengeIds?: readonly string[]
  /** Composite cursors: only facts strictly after (at, id). */
  attemptsAfter?: { at: Date; id: string } | null
  resultsAfter?: { at: Date; id: string } | null
  /** Only facts strictly before this time (a lag, so rows committed a little late are not skipped). */
  before?: Date
  limit: number
}

const MAX_EXPORT = 50_000

/** Attempts started and final results on a site, oldest first, each stream up to `limit`. */
export async function learningFacts(db: Db, siteId: string, filter: FactFilter): Promise<{ attempts: LearningFact[]; results: LearningFact[] }> {
  const limit = Math.min(filter.limit, MAX_EXPORT)
  const base = () => {
    let q = db
      .selectFrom('attempts')
      .innerJoin('challenges', 'challenges.id', 'attempts.challenge_id')
      .leftJoin('packs', 'packs.id', 'challenges.pack_id')
      .where('attempts.site_id', '=', siteId)
      .where('attempts.is_preview', '=', false)
    if (filter.userIds) q = q.where('attempts.user_id', 'in', filter.userIds.length > 0 ? [...filter.userIds] : [''])
    if (filter.challengeIds) q = q.where('attempts.challenge_id', 'in', filter.challengeIds.length > 0 ? [...filter.challengeIds] : [''])
    return q
  }
  const after = (cursor: { at: Date; id: string } | null | undefined, atCol: string) =>
    cursor ? sql<boolean>`(${sql.ref(atCol)} > ${cursor.at} OR (${sql.ref(atCol)} = ${cursor.at} AND attempts.id > ${cursor.id}))` : sql<boolean>`TRUE`
  const attempts = await base()
    .select(['attempts.id as attemptId', 'attempts.user_id as userId', 'challenges.id as challengeId', 'challenges.title as challengeTitle', 'packs.slug as packSlug', 'attempts.started_at as at'])
    .where(after(filter.attemptsAfter, 'attempts.started_at'))
    .$if(filter.before !== undefined, (q) => q.where('attempts.started_at', '<', filter.before!))
    .orderBy('attempts.started_at')
    .orderBy('attempts.id')
    .limit(limit)
    .execute()
  const results = await base()
    .innerJoin('assessments', 'assessments.attempt_id', 'attempts.id')
    .select([
      'attempts.id as attemptId',
      'attempts.user_id as userId',
      'challenges.id as challengeId',
      'challenges.title as challengeTitle',
      'packs.slug as packSlug',
      'assessments.updated_at as at',
      'assessments.passed as passed',
      'assessments.score as score',
      'assessments.max as max',
    ])
    .where('assessments.status', 'in', ['auto', 'overridden'])
    .where(after(filter.resultsAfter, 'assessments.updated_at'))
    .$if(filter.before !== undefined, (q) => q.where('assessments.updated_at', '<', filter.before!))
    .orderBy('assessments.updated_at')
    .orderBy('attempts.id')
    .limit(limit)
    .execute()
  return {
    attempts: attempts.map((a) => ({ ...a, kind: 'attempted' as const })),
    results: results.map((r) => ({ ...r, kind: 'result' as const, passed: toBool(r.passed) })),
  }
}

/** Every learning fact on the site, for an admin's export. */
export async function siteLearningFacts(db: Db, scope: Scope): Promise<LearningFact[]> {
  requireRole(scope, 'admin')
  const { attempts, results } = await learningFacts(db, scope.siteId, { limit: MAX_EXPORT })
  return [...attempts, ...results].sort((a, b) => a.at.getTime() - b.at.getTime())
}

/** A cohort's learners on its assigned challenges, for its instructors. */
export async function cohortLearningFacts(db: Db, scope: Scope, cohortId: string): Promise<LearningFact[]> {
  await requireCohortManager(db, scope, cohortId)
  const learners = await db.selectFrom('cohort_members').select('user_id').where('cohort_id', '=', cohortId).where('role', '=', 'learner').execute()
  const challengeIds = (await assignedChallenges(db, cohortId)).map((c) => c.challengeId)
  const { attempts, results } = await learningFacts(db, scope.siteId, { userIds: learners.map((l) => l.user_id), challengeIds, limit: MAX_EXPORT })
  return [...attempts, ...results].sort((a, b) => a.at.getTime() - b.at.getTime())
}

export interface LrsEndpoint {
  siteId: string
  endpoint: string
  username: string
  secretSealed: string
  enabled: boolean
  attemptsAfter: { at: Date; id: string } | null
  resultsAfter: { at: Date; id: string } | null
  lastError: string | null
  lastSentAt: Date | null
}

type LrsRow = {
  site_id: string
  endpoint: string
  username: string
  secret_sealed: string
  enabled: number | boolean
  attempts_cursor_at: Date | null
  attempts_cursor_id: string | null
  results_cursor_at: Date | null
  results_cursor_id: string | null
  last_error: string | null
  last_sent_at: Date | null
}

const toEndpoint = (r: LrsRow): LrsEndpoint => ({
  siteId: r.site_id,
  endpoint: r.endpoint,
  username: r.username,
  secretSealed: r.secret_sealed,
  enabled: toBool(r.enabled),
  attemptsAfter: r.attempts_cursor_at && r.attempts_cursor_id ? { at: r.attempts_cursor_at, id: r.attempts_cursor_id } : null,
  resultsAfter: r.results_cursor_at && r.results_cursor_id ? { at: r.results_cursor_at, id: r.results_cursor_id } : null,
  lastError: r.last_error,
  lastSentAt: r.last_sent_at,
})

export async function getLrsEndpoint(db: Db, scope: Scope): Promise<Omit<LrsEndpoint, 'secretSealed'> | null> {
  requireRole(scope, 'admin')
  const row = await db.selectFrom('lrs_endpoints').selectAll().where('site_id', '=', scope.siteId).executeTakeFirst()
  if (!row) return null
  const { secretSealed: _secret, ...rest } = toEndpoint(row)
  return rest
}

/** Connects (or reconnects) the site's LRS. The secret arrives already sealed by the caller. Sending starts from the beginning. */
export async function saveLrsEndpoint(db: Db, scope: Scope, input: { endpoint: string; username: string; secretSealed: string }): Promise<void> {
  requireRole(scope, 'admin')
  const endpoint = input.endpoint.trim().replace(/\/?$/, '/')
  if (!isAllowedOutboundUrl(endpoint)) throw new ValidationError('The LRS address must be https on the public internet.')
  if (input.username.trim() === '' || input.username.length > 200) throw new ValidationError('Enter the LRS key (username).')
  const now = new Date()
  const values = {
    endpoint,
    username: input.username.trim(),
    secret_sealed: input.secretSealed,
    enabled: true,
    attempts_cursor_at: null,
    attempts_cursor_id: null,
    results_cursor_at: null,
    results_cursor_id: null,
    last_error: null,
    updated_at: now,
  }
  await transact(db, async (trx) => {
    await trx.insertInto('lrs_endpoints').values({ site_id: scope.siteId, ...values, last_sent_at: null }).onDuplicateKeyUpdate(values).execute()
    await recordAudit(trx, scope, { action: 'site.settings_saved', targetType: 'site', targetId: scope.siteId, details: { changed: ['lrs'], endpoint } })
  })
}

export async function setLrsEnabled(db: Db, scope: Scope, enabled: boolean): Promise<void> {
  requireRole(scope, 'admin')
  const result = await db.updateTable('lrs_endpoints').set({ enabled, updated_at: new Date() }).where('site_id', '=', scope.siteId).executeTakeFirst()
  if (Number(result.numUpdatedRows) === 0) throw new NotFoundError('No LRS is connected.')
}

/** @internal (cron): every enabled LRS connection. */
export async function enabledLrsEndpoints(db: Db): Promise<LrsEndpoint[]> {
  return (await db.selectFrom('lrs_endpoints').selectAll().where('enabled', '=', true).execute()).map(toEndpoint)
}

/** @internal (cron): records progress after a successful send, or the error after a failed one. */
export async function recordLrsProgress(
  db: Db,
  siteId: string,
  update: { attemptsAfter?: { at: Date; id: string } | null; resultsAfter?: { at: Date; id: string } | null; error?: string | null },
  now: Date = new Date(),
): Promise<void> {
  await db
    .updateTable('lrs_endpoints')
    .set({
      ...(update.attemptsAfter ? { attempts_cursor_at: update.attemptsAfter.at, attempts_cursor_id: update.attemptsAfter.id } : {}),
      ...(update.resultsAfter ? { results_cursor_at: update.resultsAfter.at, results_cursor_id: update.resultsAfter.id } : {}),
      ...(update.error === undefined ? {} : { last_error: update.error?.slice(0, 500) ?? null }),
      ...(update.error ? {} : { last_sent_at: now }),
      updated_at: now,
    })
    .where('site_id', '=', siteId)
    .execute()
}
