/**
 * Analytics from the event log (Phase 3, Q6): attempts, completion, pass
 * rate, time on task and per-criterion miss rates, computed from attempts and
 * assessments. Preview attempts never count. Volumes on one site are small,
 * so this is plain queries plus arithmetic, bounded, with no warehouse.
 *
 * Who sees what:
 *   - editors and admins: any challenge or pack;
 *   - authors: challenges they may edit;
 *   - instructors: only through a cohort they manage, limited to its
 *     learners and its assigned challenges.
 */
import type { Criterion } from '@challengeforge/engine'
import type { Db } from '../client'
import { fromJson, toBool } from '../json'
import { ForbiddenError, NotFoundError, hasRole, requireSignedIn, type Scope } from '../scope'
import { assignedChallenges } from './cohort-progress'
import { requireCohortManager } from './cohorts'
import { canEdit } from './collaborators'

export interface CriterionStats {
  id: string
  label: string
  critical: boolean
  /** Finished attempts that were assessed on this criterion. */
  assessed: number
  missed: number
  missRate: number
}

export interface ChallengeStats {
  challengeId: string
  title: string
  learners: number
  attempts: number
  finished: number
  passedAttempts: number
  learnersPassed: number
  /** Passed ÷ finished attempts; null when nothing has finished. */
  passRate: number | null
  /** Median minutes from start to finish of finished attempts. */
  medianMinutes: number | null
  pendingReview: number
  criticalFailures: number
  /** Most-missed first. */
  criteria: CriterionStats[]
}

/** Enough for any one site; beyond this the numbers come from the newest attempts. */
const MAX_ATTEMPTS = 20_000

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

interface AttemptFact {
  challengeId: string
  userId: string
  status: 'open' | 'terminal'
  startedAt: Date
  endedAt: Date | null
  passed: boolean | null
  assessmentStatus: string | null
  criticalFailure: boolean
  criteria: readonly Criterion[]
}

async function attemptFacts(db: Db, siteId: string, challengeIds: string[], userIds: string[] | null): Promise<AttemptFact[]> {
  if (challengeIds.length === 0 || (userIds !== null && userIds.length === 0)) return []
  let query = db
    .selectFrom('attempts')
    .leftJoin('assessments', 'assessments.attempt_id', 'attempts.id')
    .select([
      'attempts.challenge_id as challengeId',
      'attempts.user_id as userId',
      'attempts.status as status',
      'attempts.started_at as startedAt',
      'attempts.ended_at as endedAt',
      'assessments.passed as passed',
      'assessments.status as assessmentStatus',
      'assessments.critical_failure as criticalFailure',
      'assessments.criteria as criteria',
    ])
    .where('attempts.site_id', '=', siteId)
    .where('attempts.is_preview', '=', false)
    .where('attempts.challenge_id', 'in', challengeIds)
  if (userIds !== null) query = query.where('attempts.user_id', 'in', userIds)
  const rows = await query.orderBy('attempts.started_at', 'desc').limit(MAX_ATTEMPTS).execute()
  return rows.map((r) => ({
    challengeId: r.challengeId,
    userId: r.userId,
    status: r.status,
    startedAt: r.startedAt,
    endedAt: r.endedAt,
    passed: r.passed === null ? null : toBool(r.passed),
    assessmentStatus: r.assessmentStatus,
    criticalFailure: r.criticalFailure === null ? false : toBool(r.criticalFailure),
    criteria: r.criteria === null ? [] : fromJson<Criterion[]>(r.criteria),
  }))
}

function criterionStats(facts: readonly AttemptFact[]): CriterionStats[] {
  const byId = new Map<string, CriterionStats>()
  for (const f of facts) {
    for (const c of f.criteria) {
      const s = byId.get(c.id) ?? { id: c.id, label: c.label, critical: Boolean(c.critical), assessed: 0, missed: 0, missRate: 0 }
      s.assessed += 1
      if (!c.passed) s.missed += 1
      byId.set(c.id, s)
    }
  }
  return [...byId.values()]
    .map((s) => ({ ...s, missRate: s.assessed === 0 ? 0 : s.missed / s.assessed }))
    .sort((a, b) => b.missRate - a.missRate || b.missed - a.missed)
}

function statsFor(challengeId: string, title: string, facts: readonly AttemptFact[]): ChallengeStats {
  const finished = facts.filter((f) => f.status === 'terminal' && f.passed !== null)
  const passed = finished.filter((f) => f.passed)
  const durations = finished.flatMap((f) => (f.endedAt ? [(f.endedAt.getTime() - f.startedAt.getTime()) / 60_000] : []))
  const med = median(durations)
  return {
    challengeId,
    title,
    learners: new Set(facts.map((f) => f.userId)).size,
    attempts: facts.length,
    finished: finished.length,
    passedAttempts: passed.length,
    learnersPassed: new Set(passed.map((f) => f.userId)).size,
    passRate: finished.length === 0 ? null : passed.length / finished.length,
    medianMinutes: med === null ? null : Math.round(med * 10) / 10,
    pendingReview: finished.filter((f) => f.assessmentStatus === 'pending_review').length,
    criticalFailures: finished.filter((f) => f.criticalFailure).length,
    criteria: criterionStats(finished),
  }
}

async function summarise(db: Db, siteId: string, challenges: readonly { id: string; title: string }[], userIds: string[] | null): Promise<ChallengeStats[]> {
  const facts = await attemptFacts(db, siteId, challenges.map((c) => c.id), userIds)
  return challenges.map((c) => statsFor(c.id, c.title, facts.filter((f) => f.challengeId === c.id)))
}

/** One challenge's numbers: for its editors (authors, co-authors, editors, admins). */
export async function challengeAnalytics(db: Db, scope: Scope, challengeId: string): Promise<ChallengeStats> {
  requireSignedIn(scope)
  const row = await db.selectFrom('challenges').select(['id', 'title', 'created_by']).where('id', '=', challengeId).where('site_id', '=', scope.siteId).executeTakeFirst()
  if (!row) throw new NotFoundError('Challenge not found.')
  if (!(await canEdit(db, scope, row))) throw new ForbiddenError()
  return (await summarise(db, scope.siteId, [row], null))[0]!
}

/** Every challenge in a pack: editors and admins. */
export async function packAnalytics(db: Db, scope: Scope, packId: string): Promise<{ packTitle: string; challenges: ChallengeStats[] }> {
  requireSignedIn(scope)
  if (!hasRole(scope, 'editor')) throw new ForbiddenError()
  const pack = await db.selectFrom('packs').select('title').where('id', '=', packId).where('site_id', '=', scope.siteId).executeTakeFirst()
  if (!pack) throw new NotFoundError('Pack not found.')
  const challenges = await db
    .selectFrom('challenges')
    .leftJoin('pack_sections', 'pack_sections.id', 'challenges.section_id')
    .select(['challenges.id as id', 'challenges.title as title'])
    .where('challenges.pack_id', '=', packId)
    .where('challenges.status', '!=', 'archived')
    .orderBy('pack_sections.position')
    .orderBy('challenges.position')
    .execute()
  return { packTitle: pack.title, challenges: await summarise(db, scope.siteId, challenges, null) }
}

/** A cohort's assigned challenges, counting only its learners: for its instructors. */
export async function cohortAnalytics(db: Db, scope: Scope, cohortId: string): Promise<ChallengeStats[]> {
  await requireCohortManager(db, scope, cohortId)
  const columns = await assignedChallenges(db, cohortId)
  const learners = await db.selectFrom('cohort_members').select('user_id').where('cohort_id', '=', cohortId).where('role', '=', 'learner').execute()
  return summarise(db, scope.siteId, columns.map((c) => ({ id: c.challengeId, title: c.title })), learners.map((l) => l.user_id))
}
