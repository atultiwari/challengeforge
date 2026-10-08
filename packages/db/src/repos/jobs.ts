/**
 * Resumable background jobs (PLAN.md §7). A job is advanced one bounded slice
 * at a time by whoever calls `advanceJob`: the learner's page polling, or the
 * cron command. Each claim takes a lease with a TOKEN; every write a worker
 * makes is conditional on still holding that token, so a worker whose lease
 * expired (and was taken over) can never write stale progress or apply a
 * stale result. No persistent worker process is needed (Hostinger has none).
 */
import type { ServiceRequest } from '@challengeforge/engine'
import type { Db } from '../client'
import { newId } from '../ids'
import { fromJson, toJson } from '../json'
import { NotFoundError, requireSignedIn, type Scope } from '../scope'
import { applyParkedResult, clearPending } from './attempt-actions'
import { getAttempt, JOB_KEY_PREFIX, JOB_TIMEOUT_MS, type AttemptDeps, type AttemptSnapshot } from './attempts'

/** Longer than the slowest slice (a few model calls with rate-limit retries). */
const LEASE_MS = 5 * 60_000
const MAX_FAILURES = 3
/** After a failure, wait before retrying, growing with each failure. */
const BACKOFF_MS = 30_000

export type JobStatus = 'queued' | 'running' | 'done' | 'failed'

export interface JobState {
  id: string
  status: JobStatus
  progress: unknown
  error: string | null
}

type JobRow = NonNullable<Awaited<ReturnType<typeof loadJob>>>

async function loadJob(db: Db, jobId: string) {
  return db.selectFrom('jobs').selectAll().where('id', '=', jobId).executeTakeFirst()
}

const stateOf = (job: JobRow): JobState => ({
  id: job.id,
  status: job.status,
  progress: job.progress === null ? null : fromJson(job.progress),
  error: job.error,
})

async function currentState(db: Db, jobId: string): Promise<JobState> {
  const job = await loadJob(db, jobId)
  if (!job) throw new NotFoundError('Job not found.')
  return stateOf(job)
}

/** Takes the lease if nobody holds a live one; returns the lease token, or null. */
async function claim(db: Db, jobId: string, now: Date): Promise<string | null> {
  const token = newId()
  const result = await db
    .updateTable('jobs')
    .set({ status: 'running', lease_until: new Date(now.getTime() + LEASE_MS), lease_token: token, updated_at: now })
    .where('id', '=', jobId)
    .where('status', 'in', ['queued', 'running'])
    .where((eb) => eb.or([eb('lease_until', 'is', null), eb('lease_until', '<', now)]))
    .executeTakeFirst()
  return Number(result.numUpdatedRows) === 1 ? token : null
}

const holding = (db: Db, jobId: string, token: string) =>
  db.updateTable('jobs').where('id', '=', jobId).where('lease_token', '=', token)

async function fail(db: Db, job: JobRow, token: string, message: string, now: Date, final = false): Promise<void> {
  const failures = job.failures + 1
  const giveUp = final || failures >= MAX_FAILURES
  const result = await holding(db, job.id, token)
    .set({
      failures,
      error: message.slice(0, 500),
      updated_at: now,
      lease_token: null,
      // Back off before the next try, so cron does not burn every retry within seconds.
      lease_until: giveUp ? null : new Date(now.getTime() + BACKOFF_MS * failures),
      ...(giveUp ? { status: 'failed' as const } : {}),
    })
    .executeTakeFirst()
  // A job that gives up frees its attempt (only if the attempt is still waiting on THIS job).
  if (giveUp && Number(result.numUpdatedRows) === 1) await clearPending(db, job.attempt_id, `${JOB_KEY_PREFIX}${job.id}`)
}

/** Runs one slice of a job, if it is not already being worked on, and returns its state. */
export async function advanceJob(db: Db, deps: AttemptDeps, jobId: string): Promise<JobState> {
  const now = (deps.now ?? (() => new Date()))()
  const token = await claim(db, jobId, now)
  if (!token) return currentState(db, jobId)
  const job = (await loadJob(db, jobId))!
  if (now.getTime() - job.created_at.getTime() > JOB_TIMEOUT_MS) {
    await fail(db, job, token, 'Expired before it finished.', now, true)
    return currentState(db, jobId)
  }
  if (!deps.runJobSlice) {
    await fail(db, job, token, 'Background jobs are not set up on this site.', now, true)
    return currentState(db, jobId)
  }
  const attempt = await db.selectFrom('attempts').select('challenge_id').where('id', '=', job.attempt_id).executeTakeFirstOrThrow()
  const context = { siteId: job.site_id, userId: job.user_id, attemptId: job.attempt_id, challengeId: attempt.challenge_id }

  let slice: Awaited<ReturnType<NonNullable<AttemptDeps['runJobSlice']>>>
  try {
    slice = await deps.runJobSlice(fromJson<ServiceRequest>(job.request), job.progress === null ? null : fromJson(job.progress), context)
  } catch (cause) {
    deps.onError?.(cause)
    const message = (cause as { userMessage?: unknown }).userMessage
    await fail(db, job, token, typeof message === 'string' ? message : 'The evaluation hit a problem; it will be retried.', now)
    return currentState(db, jobId)
  }

  if (!slice.done) {
    // Only the lease holder may save progress; a worker that lost its lease writes nothing.
    await holding(db, jobId, token).set({ progress: toJson(slice.progress), lease_until: null, lease_token: null, updated_at: now }).execute()
    return currentState(db, jobId)
  }
  return finish(db, deps, job, token, slice.result, now)
}

/** Applies the job's result to its attempt and marks the job done, in ONE transaction. */
async function finish(db: Db, deps: AttemptDeps, job: JobRow, token: string, result: unknown, now: Date): Promise<JobState> {
  const scope: Scope = { siteId: job.site_id, principal: { userId: job.user_id, role: 'learner' } }
  const markDone = async (trx: Db) => {
    const done = await holding(trx, job.id, token).set({ status: 'done', lease_until: null, lease_token: null, progress: null, updated_at: now }).executeTakeFirst()
    // Lost the lease meanwhile: roll the whole apply back.
    if (Number(done.numUpdatedRows) !== 1) throw new Error('Job lease lost before completion.')
  }
  try {
    const applied = await applyParkedResult(db, scope, deps, job.user_id, job.attempt_id, fromJson(job.action), result, `${JOB_KEY_PREFIX}${job.id}`, job.idempotency_key ?? undefined, markDone)
    if (!applied.ok) await fail(db, job, token, applied.error.message, now, true)
  } catch (cause) {
    deps.onError?.(cause)
    await fail(db, job, token, 'The result could not be recorded; it will be retried.', now)
  }
  return currentState(db, job.id)
}

/** A job and its attempt, for the learner who owns it (anyone else: not found). */
export async function getJob(db: Db, scope: Scope, jobId: string, deps?: AttemptDeps): Promise<JobState & { snapshot?: AttemptSnapshot }> {
  const p = requireSignedIn(scope)
  const job = await db.selectFrom('jobs').selectAll().where('id', '=', jobId).where('site_id', '=', scope.siteId).where('user_id', '=', p.userId).executeTakeFirst()
  if (!job) throw new NotFoundError('Job not found.')
  const state = stateOf(job)
  if (!deps) return state
  return { ...state, snapshot: await getAttempt(db, scope, deps, job.attempt_id) }
}

/** Jobs waiting for work (and not backing off), oldest first, for the cron command. */
export async function listRunnableJobIds(db: Db, limit: number): Promise<string[]> {
  const now = new Date()
  const rows = await db
    .selectFrom('jobs')
    .select('id')
    .where('status', 'in', ['queued', 'running'])
    .where((eb) => eb.or([eb('lease_until', 'is', null), eb('lease_until', '<', now)]))
    .orderBy('created_at')
    .limit(limit)
    .execute()
  return rows.map((r) => r.id)
}
