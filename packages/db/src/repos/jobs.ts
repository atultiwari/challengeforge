/**
 * Resumable background jobs (PLAN.md §7). A job is advanced one bounded slice
 * at a time by whoever calls `advanceJob`: the learner's page polling, or the
 * cron command. A lease makes sure only one caller works on a job at once, so
 * there is no need for a persistent worker process (Hostinger has none).
 */
import type { ServiceRequest } from '@challengeforge/engine'
import type { Db } from '../client'
import { fromJson, toJson } from '../json'
import { NotFoundError, requireSignedIn, type Scope } from '../scope'
import { applyParkedResult, clearPending, getAttempt, JOB_KEY_PREFIX, type AttemptDeps, type AttemptSnapshot } from './attempts'

/** A slice should finish well within any proxy timeout; the lease covers a slow one. */
const LEASE_MS = 90_000
const MAX_FAILURES = 3

export type JobStatus = 'queued' | 'running' | 'done' | 'failed'

export interface JobState {
  id: string
  status: JobStatus
  progress: unknown
  error: string | null
}

async function loadJob(db: Db, jobId: string) {
  return db.selectFrom('jobs').selectAll().where('id', '=', jobId).executeTakeFirst()
}

const stateOf = (job: NonNullable<Awaited<ReturnType<typeof loadJob>>>): JobState => ({
  id: job.id,
  status: job.status,
  progress: job.progress === null ? null : fromJson(job.progress),
  error: job.error,
})

/** Takes the lease if nobody holds it; false when another caller is already working on the job. */
async function claim(db: Db, jobId: string, now: Date): Promise<boolean> {
  const result = await db
    .updateTable('jobs')
    .set({ status: 'running', lease_until: new Date(now.getTime() + LEASE_MS), updated_at: now })
    .where('id', '=', jobId)
    .where('status', 'in', ['queued', 'running'])
    .where((eb) => eb.or([eb('lease_until', 'is', null), eb('lease_until', '<', now)]))
    .executeTakeFirst()
  return Number(result.numUpdatedRows) === 1
}

async function fail(db: Db, job: { id: string; attempt_id: string; failures: number }, message: string, now: Date): Promise<void> {
  const failures = job.failures + 1
  const final = failures >= MAX_FAILURES
  await db
    .updateTable('jobs')
    .set({ failures, lease_until: null, updated_at: now, error: message.slice(0, 500), ...(final ? { status: 'failed' as const } : {}) })
    .where('id', '=', job.id)
    .execute()
  // A job that gives up frees its attempt, so the learner can change their work and run again.
  if (final) await clearPending(db, job.attempt_id)
}

/** Runs one slice of a job, if it is not already being worked on, and returns its state. */
export async function advanceJob(db: Db, deps: AttemptDeps, jobId: string): Promise<JobState> {
  const now = (deps.now ?? (() => new Date()))()
  if (!(await claim(db, jobId, now))) {
    const current = await loadJob(db, jobId)
    if (!current) throw new NotFoundError('Job not found.')
    return stateOf(current)
  }
  const job = await loadJob(db, jobId)
  if (!job) throw new NotFoundError('Job not found.')
  if (!deps.runJobSlice) {
    await fail(db, { ...job, failures: MAX_FAILURES - 1 }, 'Background jobs are not set up on this site.', now)
    return stateOf((await loadJob(db, jobId))!)
  }
  const attempt = await db.selectFrom('attempts').select('challenge_id').where('id', '=', job.attempt_id).executeTakeFirstOrThrow()
  const context = { siteId: job.site_id, userId: job.user_id, attemptId: job.attempt_id, challengeId: attempt.challenge_id }

  let slice: Awaited<ReturnType<NonNullable<AttemptDeps['runJobSlice']>>>
  try {
    slice = await deps.runJobSlice(fromJson<ServiceRequest>(job.request), job.progress === null ? null : fromJson(job.progress), context)
  } catch (cause) {
    deps.onError?.(cause)
    const message = (cause as { userMessage?: unknown }).userMessage
    await fail(db, job, typeof message === 'string' ? message : 'The evaluation hit a problem; it will be retried.', now)
    return stateOf((await loadJob(db, jobId))!)
  }

  if (!slice.done) {
    await db.updateTable('jobs').set({ progress: toJson(slice.progress), lease_until: null, updated_at: now }).where('id', '=', jobId).execute()
    return stateOf((await loadJob(db, jobId))!)
  }

  const scope: Scope = { siteId: job.site_id, principal: { userId: job.user_id, role: 'learner' } }
  const applied = await applyParkedResult(db, scope, deps, job.user_id, job.attempt_id, fromJson(job.action), slice.result, `${JOB_KEY_PREFIX}${job.id}`, job.idempotency_key ?? undefined)
  if (!applied.ok) {
    await fail(db, { ...job, failures: MAX_FAILURES - 1 }, applied.error.message, now)
    return stateOf((await loadJob(db, jobId))!)
  }
  await db.updateTable('jobs').set({ status: 'done', lease_until: null, updated_at: now, progress: null }).where('id', '=', jobId).execute()
  return stateOf((await loadJob(db, jobId))!)
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

/** Jobs waiting for work, oldest first, for the cron command. */
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
