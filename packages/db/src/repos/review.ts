/**
 * The instructor review queue (PLAN.md §3.3): results a type routed to
 * `pending_review` (e.g. AI-judged goals on a high-stakes mission) wait here
 * for an editor to confirm or overturn, or an instructor for their own
 * cohorts' learners on the challenges assigned to them. The learner's progress is recomputed
 * from all their results, so an overturned pass really is undone.
 */
import type { Db } from '../client'
import { toBool } from '../json'
import { ForbiddenError, NotFoundError, hasRole, requireSignedIn, type Scope } from '../scope'
import { getAttempt, type AttemptDeps, type AttemptSnapshot } from './attempts'
import { recordAudit } from './audit'
import { issueCertificateIfEarned } from './certificates'
import { canReviewAsInstructor, reviewablePairs } from './cohort-progress'
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
  requireSignedIn(scope)
  const editor = hasRole(scope, 'editor')
  if (!editor && !(await isTeacher(db, scope))) throw new ForbiddenError()
  const scoped = editor ? null : await reviewablePairs(db, scope)
  if (scoped && scoped.pairs.size === 0) return []
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
  if (scoped) query = query.where('attempts.user_id', 'in', [...scoped.learners]).where('attempts.challenge_id', 'in', [...scoped.challenges])
  const rows = await query.select('attempts.user_id as learnerId').orderBy('assessments.created_at').limit(500).execute()
  return rows
    // Learner and challenge must come from the SAME cohort, not merely from two cohorts the caller teaches.
    .filter((r) => !scoped || scoped.pairs.has(`${r.learnerId}:${r.challengeId}`))
    .slice(0, 200)
    .map(({ learnerId: _l, ...r }) => ({ ...r, passed: toBool(r.passed) }))
}

/** Recomputes a learner's progress on a challenge from every (non-preview) result they have. */
async function recomputeProgress(db: Db, siteId: string, userId: string, challengeId: string): Promise<void> {
  const results = await db
    .selectFrom('assessments')
    .innerJoin('attempts', 'attempts.id', 'assessments.attempt_id')
    .select(['assessments.passed as passed', 'assessments.points as points', 'assessments.score as score', 'assessments.max as max', 'assessments.created_at as at'])
    .where('attempts.site_id', '=', siteId)
    .where('attempts.user_id', '=', userId)
    .where('attempts.challenge_id', '=', challengeId)
    .where('attempts.is_preview', '=', false)
    .execute()
  const passedTimes = results.filter((r) => toBool(r.passed)).map((r) => r.at.getTime())
  await db
    .updateTable('progress')
    .set({
      best_points: Math.max(0, ...results.map((r) => r.points)),
      best_score_fraction: Math.max(0, ...results.map((r) => (r.max > 0 ? r.score / r.max : 0))),
      passed_at: passedTimes.length > 0 ? new Date(Math.min(...passedTimes)) : null,
      updated_at: new Date(),
    })
    .where('site_id', '=', siteId)
    .where('user_id', '=', userId)
    .where('challenge_id', '=', challengeId)
    .execute()
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
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('assessments')
      .set({ passed: override.passed, points: override.passed ? points : 0, status: 'overridden', reviewer_id: reviewer.userId, updated_at: new Date() })
      .where('attempt_id', '=', attemptId)
      .execute()
    await recomputeProgress(trx, scope.siteId, attempt.userId, attempt.challengeId)
    if (override.passed) await issueCertificateIfEarned(trx, scope.siteId, attempt.userId, attempt.challengeId)
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
