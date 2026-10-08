/**
 * The instructor review queue (PLAN.md §3.3): results a type routed to
 * `pending_review` (e.g. AI-judged goals on a high-stakes mission) wait here
 * for an editor to confirm or overturn, or an instructor for their own
 * cohorts' learners on the challenges assigned to them. The learner's progress is recomputed
 * from all their results, so an overturned pass really is undone.
 */
import { sql } from 'kysely'
import { transact } from '../tx'
import type { Db } from '../client'
import { toBool } from '../json'
import { ForbiddenError, NotFoundError, hasRole, requireSignedIn, type Scope } from '../scope'
import { getAttempt, type AttemptDeps, type AttemptSnapshot } from './attempts'
import { recordAudit } from './audit'
import { queueNotification } from './notifications'
import { afterFinalResult, recomputeProgress } from './results'
import { canReviewAsInstructor, instructorCanReviewSql } from './cohort-progress'
import { isTeacher } from './orgs'

export interface ReviewItem {
  attemptId: string
  challengeId: string
  challengeTitle: string
  learnerName: string
  learnerEmail: string
  passed: boolean
  score: number
  max: number
  points: number
  finishedAt: Date
}

export async function listReviewQueue(db: Db, scope: Scope): Promise<ReviewItem[]> {
  const me = requireSignedIn(scope)
  const editor = hasRole(scope, 'editor')
  if (!editor && !(await isTeacher(db, scope))) throw new ForbiddenError()
  let query = db
    .selectFrom('assessments')
    .innerJoin('attempts', 'attempts.id', 'assessments.attempt_id')
    .innerJoin('challenges', 'challenges.id', 'attempts.challenge_id')
    .innerJoin('user', 'user.id', 'attempts.user_id')
    .select([
      'attempts.id as attemptId',
      'challenges.id as challengeId',
      'challenges.title as challengeTitle',
      'user.name as learnerName',
      'user.email as learnerEmail',
      'assessments.passed as passed',
      'assessments.score as score',
      'assessments.max as max',
      'assessments.points as points',
      'assessments.created_at as finishedAt',
    ])
    .where('attempts.site_id', '=', scope.siteId)
    .where('assessments.status', '=', 'pending_review')
  // Instructors: only their cohorts' learners on those cohorts' assignments, decided in SQL (never truncated in memory).
  if (!editor) query = query.where(instructorCanReviewSql(scope.siteId, me.userId, sql.ref('attempts.user_id'), sql.ref('attempts.challenge_id')), '=', 1)
  const rows = await query.orderBy('assessments.created_at').limit(200).execute()
  return rows.map((r) => ({ ...r, passed: toBool(r.passed) }))
}

export interface Override {
  passed: boolean
  points: number
}

/** A reviewer confirms or overturns a result waiting for review; it is marked overridden with the reviewer recorded. */
export async function overrideAssessment(db: Db, scope: Scope, attemptId: string, override: Override): Promise<void> {
  const reviewer = requireSignedIn(scope)
  const attempt = await db
    .selectFrom('attempts')
    .innerJoin('assessments', 'assessments.attempt_id', 'attempts.id')
    .select(['attempts.user_id as userId', 'attempts.challenge_id as challengeId'])
    .where('attempts.id', '=', attemptId)
    .where('attempts.site_id', '=', scope.siteId)
    // Only results waiting for review: a final result cannot be silently rewritten.
    .where('assessments.status', '=', 'pending_review')
    .executeTakeFirst()
  if (!attempt) throw new NotFoundError('No result is waiting for review here.')
  if (!hasRole(scope, 'editor') && !(await canReviewAsInstructor(db, scope, attempt.userId, attempt.challengeId))) {
    throw new NotFoundError('No result is waiting for review here.')
  }
  const points = Math.max(0, Math.round(override.points))
  await transact(db, async (trx) => {
    const now = new Date()
    const decided = await trx
      .updateTable('assessments')
      .set({ passed: override.passed, points: override.passed ? points : 0, status: 'overridden', reviewer_id: reviewer.userId, updated_at: now })
      .where('attempt_id', '=', attemptId)
      // Two reviewers at once: only the first decision stands; the second finds nothing waiting.
      .where('status', '=', 'pending_review')
      .executeTakeFirst()
    if (Number(decided.numUpdatedRows) !== 1) throw new NotFoundError('No result is waiting for review here.')
    await recomputeProgress(trx, scope.siteId, attempt.userId, attempt.challengeId)
    await afterFinalResult(trx, scope.siteId, attempt.userId, attempt.challengeId, override.passed, now)
    const title = await trx.selectFrom('challenges').select('title').where('id', '=', attempt.challengeId).executeTakeFirst()
    await queueNotification(trx, scope.siteId, attempt.userId, 'review_decided', { challengeId: attempt.challengeId, challengeTitle: title?.title ?? '', passed: override.passed }, now)
    await recordAudit(trx, scope, { action: 'assessment.overridden', targetType: 'attempt', targetId: attemptId, details: { passed: override.passed, points: override.passed ? points : 0 } })
  })
}

/**
 * An attempt opened FOR REVIEW: editors, or an instructor of a cohort it
 * belongs to. Unlike getAttempt, the learner's own access does not count,
 * so a learner never sees the reviewer's controls on their own result.
 */
export async function getAttemptForReview(db: Db, scope: Scope, deps: AttemptDeps, attemptId: string): Promise<AttemptSnapshot> {
  requireSignedIn(scope)
  const row = await db.selectFrom('attempts').select(['user_id', 'challenge_id']).where('id', '=', attemptId).where('site_id', '=', scope.siteId).executeTakeFirst()
  const allowed = row !== undefined && (hasRole(scope, 'editor') || (await canReviewAsInstructor(db, scope, row.user_id, row.challenge_id)))
  if (!allowed) throw new NotFoundError('Attempt not found.')
  return getAttempt(db, scope, deps, attemptId)
}
