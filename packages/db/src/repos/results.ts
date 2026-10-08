/**
 * Recording a finished attempt's result (PLAN.md §3.3): the assessment, the
 * learner's progress, and what a FINAL result sets off (a certificate, an
 * LMS grade). Split out of attempts.ts.
 *
 * Rules (Phase 3 review):
 *   - a result waiting for review is not a pass yet: it counts as an attempt,
 *     but sets no pass and no best score until a reviewer decides;
 *   - certificates and LMS grades are secondary: if either fails, the learner's
 *     result is still recorded (a deadlock is the exception: the database has
 *     already rolled back, so the whole action is retried).
 */
import { DEFAULT_BASE_POINTS, assess, pointsFor, type AnyChallengeType, type Attempt, type AttemptEvent } from '@challengeforge/engine'
import type { Db } from '../client'
import { fromJson, toBool, toJson } from '../json'
import type { Scope } from '../scope'
import type { AttemptDeps, AttemptRow } from './attempts'
import { issueCertificateIfEarned } from './certificates'
import { queueLtiScores } from './lti-scores'

const DEADLOCK = 1213

const reportToStderr = (what: string, cause: unknown) => process.stderr.write(`[results] ${what} failed: ${String(cause)}\n`)

/** Runs a secondary step; its failure is reported, never allowed to undo the result (except a deadlock). */
async function secondary(what: string, step: () => Promise<unknown>, onError?: (cause: unknown) => void): Promise<void> {
  try {
    await step()
  } catch (cause) {
    if ((cause as { errno?: number }).errno === DEADLOCK) throw cause
    if (onError) onError(cause)
    else reportToStderr(what, cause)
  }
}

/** After a FINAL result (auto or reviewed): maybe a certificate, and the best score back to any LMS. */
export async function afterFinalResult(trx: Db, siteId: string, userId: string, challengeId: string, passed: boolean, now: Date, onError?: (cause: unknown) => void): Promise<void> {
  if (passed) await secondary('certificate', () => issueCertificateIfEarned(trx, siteId, userId, challengeId, now), onError)
  await secondary('LMS score', () => queueLtiScores(trx, siteId, userId, challengeId, now), onError)
}

interface Result {
  points: number
  fraction: number
  passed: boolean
  /** False while waiting for review. */
  final: boolean
}

async function upsertProgress(trx: Db, siteId: string, userId: string, challengeId: string, r: Result, now: Date): Promise<void> {
  const counts = r.final
  await trx
    .insertInto('progress')
    .values({
      site_id: siteId,
      user_id: userId,
      challenge_id: challengeId,
      attempts: 1,
      best_points: counts ? r.points : 0,
      best_score_fraction: counts ? r.fraction : 0,
      passed_at: counts && r.passed ? now : null,
      updated_at: now,
    })
    .onDuplicateKeyUpdate((eb) => ({
      attempts: eb('attempts', '+', 1),
      best_points: counts ? eb.fn('GREATEST', [eb.ref('best_points'), eb.val(r.points)]) : eb.ref('best_points'),
      best_score_fraction: counts ? eb.fn('GREATEST', [eb.ref('best_score_fraction'), eb.val(r.fraction)]) : eb.ref('best_score_fraction'),
      passed_at: counts && r.passed ? eb.fn.coalesce('passed_at', eb.val(now)) : eb.ref('passed_at'),
      updated_at: now,
    }))
    .execute()
}

/** @internal: assesses a finished attempt and records the result, its progress, and what follows from it. */
export async function recordAssessment(
  trx: Db,
  scope: Scope,
  deps: AttemptDeps,
  type: AnyChallengeType,
  def: unknown,
  row: AttemptRow,
  attempt: Attempt<unknown>,
  now: Date,
): Promise<void> {
  const eventRows = await trx.selectFrom('attempt_events').selectAll().where('attempt_id', '=', row.id).orderBy('seq').execute()
  const events: AttemptEvent[] = eventRows.map((e) => ({
    seq: e.seq,
    action: fromJson(e.action),
    at: e.at.toISOString(),
    ...(e.effects === null ? {} : { effects: fromJson(e.effects) }),
  }))
  const assessment = await assess(type, def, attempt, events, deps.services ?? {})
  const points = pointsFor(assessment, type.pointsInput?.(def, attempt.state) ?? { basePoints: DEFAULT_BASE_POINTS, hintCosts: [], hintIndicesUsed: [] })
  await trx
    .insertInto('assessments')
    .values({
      attempt_id: row.id,
      criteria: toJson(assessment.criteria),
      score: assessment.score,
      max: assessment.max,
      passed: assessment.passed,
      critical_failure: assessment.criticalFailure,
      status: assessment.status,
      points,
      reviewer_id: null,
      created_at: now,
      updated_at: now,
    })
    .execute()
  if (toBool(row.is_preview)) return
  const final = assessment.status !== 'pending_review'
  const fraction = assessment.max > 0 ? assessment.score / assessment.max : 0
  await upsertProgress(trx, scope.siteId, row.user_id, row.challenge_id, { points, fraction, passed: assessment.passed, final }, now)
  if (final) await afterFinalResult(trx, scope.siteId, row.user_id, row.challenge_id, assessment.passed, now, deps.onError)
}

/**
 * Recomputes a learner's progress on a challenge from their FINAL results.
 * A reviewed result counts as full or no credit: the reviewer decided pass or
 * fail, so its raw automatic score no longer stands.
 */
export async function recomputeProgress(trx: Db, siteId: string, userId: string, challengeId: string): Promise<void> {
  const results = await trx
    .selectFrom('assessments')
    .innerJoin('attempts', 'attempts.id', 'assessments.attempt_id')
    .select(['assessments.passed as passed', 'assessments.status as status', 'assessments.points as points', 'assessments.score as score', 'assessments.max as max', 'assessments.created_at as at'])
    .where('attempts.site_id', '=', siteId)
    .where('attempts.user_id', '=', userId)
    .where('attempts.challenge_id', '=', challengeId)
    .where('attempts.is_preview', '=', false)
    .where('assessments.status', 'in', ['auto', 'overridden'])
    .execute()
  const fractionOf = (r: (typeof results)[number]) => (r.status === 'overridden' ? (toBool(r.passed) ? 1 : 0) : r.max > 0 ? r.score / r.max : 0)
  const passedTimes = results.filter((r) => toBool(r.passed)).map((r) => r.at.getTime())
  await trx
    .updateTable('progress')
    .set({
      best_points: Math.max(0, ...results.map((r) => r.points)),
      best_score_fraction: Math.max(0, ...results.map(fractionOf)),
      passed_at: passedTimes.length > 0 ? new Date(Math.min(...passedTimes)) : null,
      updated_at: new Date(),
    })
    .where('site_id', '=', siteId)
    .where('user_id', '=', userId)
    .where('challenge_id', '=', challengeId)
    .execute()
}
