/**
 * The instructor review queue (PLAN.md §3.3): results a type routed to
 * `pending_review` (e.g. AI-judged goals on a high-stakes mission) wait here
 * for an admin to confirm or overturn. The learner's progress is recomputed
 * from all their results, so an overturned pass really is undone.
 */
import type { Db } from '../client'
import { toBool } from '../json'
import { NotFoundError, requireRole, type Scope } from '../scope'
import { recordAudit } from './audit'

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
  requireRole(scope, 'admin')
  const rows = await db
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
    .orderBy('assessments.created_at')
    .limit(200)
    .execute()
  return rows.map((r) => ({ ...r, passed: toBool(r.passed) }))
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

/** An admin confirms or overturns a result waiting for review; it is marked overridden with the reviewer recorded. */
export async function overrideAssessment(db: Db, scope: Scope, attemptId: string, override: Override): Promise<void> {
  const admin = requireRole(scope, 'admin')
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
  const points = Math.max(0, Math.round(override.points))
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('assessments')
      .set({ passed: override.passed, points: override.passed ? points : 0, status: 'overridden', reviewer_id: admin.userId, updated_at: new Date() })
      .where('attempt_id', '=', attemptId)
      .execute()
    await recomputeProgress(trx, scope.siteId, attempt.userId, attempt.challengeId)
    await recordAudit(trx, scope, { action: 'assessment.overridden', targetType: 'attempt', targetId: attemptId, details: { passed: override.passed, points: override.passed ? points : 0 } })
  })
}
