/**
 * Grade passback (LTI Advantage AGS) as an outbox: a final result on a
 * challenge queues the learner's best score for every LMS placement they
 * launched it from; `run-jobs` sends due rows (packages/services). One row
 * per (placement, learner): a newer score replaces a pending one.
 */
import type { Db } from '../client'
import { newId } from '../ids'

const MAX_FAILURES = 8
/** Backoff: 1, 2, 4 … minutes, at most an hour. */
const backoffMs = (failures: number): number => Math.min(60, 2 ** (failures - 1)) * 60_000
export const SCORE_MAXIMUM = 100

/**
 * Queues the learner's BEST score on this challenge (from progress) for each
 * LMS placement with a grade column that they launched. Called inside the
 * transaction that recorded a final result.
 */
export async function queueLtiScores(trx: Db, siteId: string, userId: string, challengeId: string, now: Date = new Date()): Promise<number> {
  const placements = await trx
    .selectFrom('lti_links')
    .innerJoin('lti_link_users', 'lti_link_users.link_id', 'lti_links.id')
    .select(['lti_links.id as linkId', 'lti_link_users.sub as sub'])
    .where('lti_links.site_id', '=', siteId)
    .where('lti_links.challenge_id', '=', challengeId)
    .where('lti_links.lineitem_url', 'is not', null)
    .where('lti_link_users.user_id', '=', userId)
    .execute()
  if (placements.length === 0) return 0
  const progress = await trx
    .selectFrom('progress')
    .select('best_score_fraction')
    .where('site_id', '=', siteId)
    .where('user_id', '=', userId)
    .where('challenge_id', '=', challengeId)
    .executeTakeFirst()
  const score = Math.round(Math.max(0, Math.min(1, Number(progress?.best_score_fraction ?? 0))) * SCORE_MAXIMUM * 100) / 100
  for (const p of placements) {
    await trx
      .insertInto('lti_score_outbox')
      .values({
        id: newId(),
        site_id: siteId,
        link_id: p.linkId,
        user_id: userId,
        sub: p.sub,
        score_given: score,
        score_maximum: SCORE_MAXIMUM,
        grading_progress: 'FullyGraded',
        status: 'pending',
        failures: 0,
        next_attempt_at: now,
        last_error: null,
        created_at: now,
        updated_at: now,
      })
      .onDuplicateKeyUpdate({ score_given: score, status: 'pending', failures: 0, next_attempt_at: now, last_error: null, updated_at: now })
      .execute()
  }
  return placements.length
}

export interface DueScore {
  id: string
  siteId: string
  platformId: string
  lineitemUrl: string
  sub: string
  scoreGiven: number
  scoreMaximum: number
  gradingProgress: string
  /** Sent only if the row is unchanged since it was read (a newer score wins). */
  version: Date
}

export async function dueLtiScores(db: Db, limit: number, now: Date = new Date()): Promise<DueScore[]> {
  const rows = await db
    .selectFrom('lti_score_outbox')
    .innerJoin('lti_links', 'lti_links.id', 'lti_score_outbox.link_id')
    .innerJoin('lti_platforms', 'lti_platforms.id', 'lti_links.platform_id')
    .select([
      'lti_score_outbox.id as id',
      'lti_links.site_id as siteId',
      'lti_links.platform_id as platformId',
      'lti_links.lineitem_url as lineitemUrl',
      'lti_score_outbox.sub as sub',
      'lti_score_outbox.score_given as scoreGiven',
      'lti_score_outbox.score_maximum as scoreMaximum',
      'lti_score_outbox.grading_progress as gradingProgress',
      'lti_score_outbox.updated_at as version',
    ])
    .where('lti_score_outbox.status', '=', 'pending')
    .where('lti_score_outbox.next_attempt_at', '<=', now)
    .where('lti_platforms.active', '=', true)
    .orderBy('lti_score_outbox.next_attempt_at')
    .limit(limit)
    .execute()
  return rows.flatMap((r) =>
    r.lineitemUrl ? [{ ...r, lineitemUrl: r.lineitemUrl, scoreGiven: Number(r.scoreGiven), scoreMaximum: Number(r.scoreMaximum) }] : [],
  )
}

/** How long a claimed score is hidden from other runs while it is being sent. */
const CLAIM_MS = 10 * 60_000

/**
 * Claims a due score for this run (two overlapping cron runs must not both
 * send it). Returns false when another run got there first.
 */
export async function claimLtiScore(db: Db, score: DueScore, now: Date = new Date()): Promise<boolean> {
  const result = await db
    .updateTable('lti_score_outbox')
    .set({ next_attempt_at: new Date(now.getTime() + CLAIM_MS) })
    .where('id', '=', score.id)
    .where('status', '=', 'pending')
    .where('next_attempt_at', '<=', now)
    .where('updated_at', '=', score.version)
    .executeTakeFirst()
  return Number(result.numUpdatedRows) === 1
}

export async function markLtiScoreSent(db: Db, score: DueScore): Promise<void> {
  await db.updateTable('lti_score_outbox').set({ status: 'sent', last_error: null }).where('id', '=', score.id).where('updated_at', '=', score.version).execute()
}

export async function markLtiScoreFailed(db: Db, score: DueScore, error: string, now: Date = new Date()): Promise<void> {
  const row = await db.selectFrom('lti_score_outbox').select('failures').where('id', '=', score.id).where('updated_at', '=', score.version).executeTakeFirst()
  if (!row) return
  const failures = row.failures + 1
  await db
    .updateTable('lti_score_outbox')
    .set({
      failures,
      last_error: error.slice(0, 500),
      ...(failures >= MAX_FAILURES ? { status: 'failed' as const } : { next_attempt_at: new Date(now.getTime() + backoffMs(failures)) }),
    })
    .where('id', '=', score.id)
    .where('updated_at', '=', score.version)
    .execute()
}
