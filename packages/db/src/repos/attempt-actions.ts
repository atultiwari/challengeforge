/**
 * Applying learner actions (PLAN.md §6.3).
 *
 * Most actions run in ONE transaction: lock the attempt → engine.act →
 * insert event → update state → (at the end) assess.
 *
 * An action whose type asks for a service runs in three steps, so no lock is
 * ever held across a model call:
 *   1. lock, park the action under a fresh random TOKEN, commit;
 *   2. run the service with no lock held (or queue a background job);
 *   3. lock again and apply the result ONLY if the attempt is still parked
 *      under that token.
 * The token is never the client's idempotency key, so a stale call (one that
 * outlived its window while a newer action was parked) can neither apply its
 * result to, nor clear, the newer action.
 */
import { act, applyServiceResult, parseAction, type AnyChallengeType, type ServiceRequest } from '@challengeforge/engine'
import type { Db } from '../client'
import { newId } from '../ids'
import { fromJson, toJson } from '../json'
import { NotFoundError, requireSignedIn, type Scope } from '../scope'
import { withDeadlockRetry } from '../tx'
import {
  ATTEMPT_COLUMNS,
  JOB_KEY_PREFIX,
  JOB_TIMEOUT_MS,
  PENDING_TIMEOUT_MS,
  definitionFor,
  recordAssessment,
  servicesFor,
  snapshotOf,
  toAttempt,
  typeFor,
  type ActionOutcome,
  type AttemptDeps,
  type AttemptRow,
  type AttemptSnapshot,
} from './attempts'

interface Locked {
  row: AttemptRow & { pending_key: string | null; pending_since: Date | null }
  type: AnyChallengeType
  def: unknown
}

const CALL_TOKEN_PREFIX = 'call:'
const BUSY = { code: 'busy' as const, message: 'Still waiting for the last reply. Try again in a moment.' }

/** Locks the caller's own attempt row; someone else's attempt is "not found". */
async function lockAttempt(trx: Db, scope: Scope, deps: AttemptDeps, userId: string, attemptId: string): Promise<Locked> {
  const row = await trx
    .selectFrom('attempts')
    .select([...ATTEMPT_COLUMNS, 'pending_key', 'pending_since'])
    .where('id', '=', attemptId)
    .where('site_id', '=', scope.siteId)
    .where('user_id', '=', userId)
    .forUpdate()
    .executeTakeFirst()
  if (!row) throw new NotFoundError('Attempt not found.')
  return { row, type: typeFor(deps.registry, row.type_id, row.type_version), def: await definitionFor(trx, row.challenge_version_id) }
}

const isJobToken = (token: string | null): token is string => token !== null && token.startsWith(JOB_KEY_PREFIX)

function isPending(row: Locked['row'], now: Date): boolean {
  if (row.pending_since === null) return false
  const limit = isJobToken(row.pending_key) ? JOB_TIMEOUT_MS : PENDING_TIMEOUT_MS
  return now.getTime() - row.pending_since.getTime() < limit
}

/** A parked action that outlived its window is abandoned; an abandoned JOB is failed so nothing keeps running it. */
async function abandonExpired(trx: Db, row: Locked['row'], now: Date): Promise<void> {
  if (row.pending_since === null || !isJobToken(row.pending_key)) return
  await trx
    .updateTable('jobs')
    .set({ status: 'failed', error: 'Expired: the attempt moved on.', lease_until: null, lease_token: null, updated_at: now })
    .where('id', '=', row.pending_key.slice(JOB_KEY_PREFIX.length))
    .where('status', 'in', ['queued', 'running'])
    .execute()
}

/** Clears a parked action, but only if it is still parked under `token`. */
export async function clearPending(db: Db, attemptId: string, token: string): Promise<void> {
  await db
    .updateTable('attempts')
    .set({ pending_action: null, pending_key: null, pending_since: null })
    .where('id', '=', attemptId)
    .where('pending_key', '=', token)
    .execute()
}

/** Writes an applied action: the event, the new state and, at the end, the assessment and progress. */
async function commitResult(
  trx: Db,
  scope: Scope,
  deps: AttemptDeps,
  locked: Locked,
  result: Extract<Awaited<ReturnType<typeof act>>, { ok: true }>,
  idempotencyKey: string | undefined,
  now: Date,
): Promise<AttemptSnapshot> {
  const { row, type, def } = locked
  const next = result.attempt
  await trx
    .insertInto('attempt_events')
    .values({
      attempt_id: row.id,
      seq: result.event.seq,
      action: toJson(result.event.action),
      effects: result.event.effects === undefined ? null : toJson(result.event.effects),
      at: now,
      idempotency_key: idempotencyKey ?? null,
    })
    .execute()
  await trx
    .updateTable('attempts')
    .set({
      state: toJson(next.state),
      seq: next.seq,
      status: next.status,
      updated_at: now,
      pending_action: null,
      pending_key: null,
      pending_since: null,
      ...(next.status === 'terminal' ? { ended_at: now } : {}),
    })
    .where('id', '=', row.id)
    .execute()
  const updated: AttemptRow = { ...row, seq: next.seq, status: next.status, state: next.state }
  if (next.status === 'terminal') await recordAssessment(trx, scope, deps, type, def, updated, next, now)
  return snapshotOf(trx, deps, updated)
}

type Phase1 = { done: ActionOutcome } | { park: { request: ServiceRequest; parsed: unknown; token: string } }

async function queueJob(trx: Db, scope: Scope, userId: string, attemptId: string, request: ServiceRequest, parsed: unknown, key: string | undefined, now: Date): Promise<void> {
  const jobId = newId()
  await trx
    .insertInto('jobs')
    .values({
      id: jobId,
      site_id: scope.siteId,
      user_id: userId,
      attempt_id: attemptId,
      kind: request.kind,
      status: 'queued',
      request: toJson(request),
      action: toJson(parsed),
      idempotency_key: key ?? null,
      progress: null,
      error: null,
      failures: 0,
      lease_until: null,
      lease_token: null,
      created_at: now,
      updated_at: now,
    })
    .execute()
  await trx
    .updateTable('attempts')
    .set({ pending_action: toJson(parsed), pending_key: `${JOB_KEY_PREFIX}${jobId}`, pending_since: now })
    .where('id', '=', attemptId)
    .execute()
}

/** Step 1: lock; apply directly, or park the action for a service call or a background job. */
async function phase1(db: Db, scope: Scope, deps: AttemptDeps, userId: string, attemptId: string, rawAction: unknown, key: string | undefined): Promise<Phase1> {
  return withDeadlockRetry(() =>
    db.transaction().execute(async (trx): Promise<Phase1> => {
      const locked = await lockAttempt(trx, scope, deps, userId, attemptId)
      const { row, type, def } = locked
      if (key) {
        const seen = await trx.selectFrom('attempt_events').select('seq').where('attempt_id', '=', attemptId).where('idempotency_key', '=', key).executeTakeFirst()
        if (seen) return { done: { ok: true, duplicate: true, snapshot: await snapshotOf(trx, deps, row) } }
      }
      const now = (deps.now ?? (() => new Date()))()
      if (isPending(row, now)) return { done: { ok: false, error: BUSY } }
      await abandonExpired(trx, row, now)

      const parsed = parseAction(type, rawAction)
      const request = parsed === null || row.status === 'terminal' ? null : (type.prepare?.(def, fromJson(row.state), parsed, toAttempt(row).ctx) ?? null)
      if (request?.mode === 'job') {
        await queueJob(trx, scope, userId, attemptId, request, parsed, key, now)
        return { done: { ok: true, duplicate: false, snapshot: await snapshotOf(trx, deps, row) } }
      }
      if (request) {
        const token = `${CALL_TOKEN_PREFIX}${newId()}`
        await trx.updateTable('attempts').set({ pending_action: toJson(parsed), pending_key: token, pending_since: now }).where('id', '=', attemptId).execute()
        return { park: { request, parsed, token } }
      }

      const services = servicesFor(trx, deps, row.challenge_id)
      const result = await act(type, def, toAttempt(row), rawAction, { services, at: now.toISOString(), ...(deps.onError ? { onError: deps.onError } : {}) })
      if (!result.ok) return { done: { ok: false, error: result.error } }
      return { done: { ok: true, duplicate: false, snapshot: await commitResult(trx, scope, { ...deps, services }, locked, result, key, now) } }
    }),
  )
}

/** Applies one learner action. Only the attempt's owner may act. */
export async function performAction(
  db: Db,
  scope: Scope,
  deps: AttemptDeps,
  attemptId: string,
  rawAction: unknown,
  options: { idempotencyKey?: string } = {},
): Promise<ActionOutcome> {
  const p = requireSignedIn(scope)
  const key = options.idempotencyKey?.slice(0, 64)
  const first = await phase1(db, scope, deps, p.userId, attemptId, rawAction, key)
  if ('done' in first) return first.done
  return runParkedService(db, scope, deps, p.userId, attemptId, first.park, key)
}

/** Step 2: call the service with no lock held, then step 3. */
async function runParkedService(
  db: Db,
  scope: Scope,
  deps: AttemptDeps,
  userId: string,
  attemptId: string,
  parked: { request: ServiceRequest; parsed: unknown; token: string },
  key: string | undefined,
): Promise<ActionOutcome> {
  if (!deps.runService) {
    await clearPending(db, attemptId, parked.token)
    return { ok: false, error: { code: 'service_unavailable', message: 'This challenge needs an AI service that is not set up on this site.' } }
  }
  const head = await db.selectFrom('attempts').select('challenge_id').where('id', '=', attemptId).executeTakeFirstOrThrow()
  let serviceResult: unknown
  try {
    serviceResult = await deps.runService(parked.request, { siteId: scope.siteId, userId, attemptId, challengeId: head.challenge_id })
  } catch (cause) {
    deps.onError?.(cause)
    await clearPending(db, attemptId, parked.token)
    const message = (cause as { userMessage?: unknown }).userMessage
    return { ok: false, error: { code: 'service_failed', message: typeof message === 'string' ? message : 'The AI service could not be reached. Please try again.' } }
  }
  return applyParkedResult(db, scope, deps, userId, attemptId, parked.parsed, serviceResult, parked.token, key)
}

/**
 * Step 3, shared by inline service calls and finished background jobs: lock
 * the attempt, check it is still parked under `token`, apply the result.
 * `onApplied` runs in the SAME transaction (a job marks itself done there),
 * so applying and recording completion can never be split by a crash.
 */
export async function applyParkedResult(
  db: Db,
  scope: Scope,
  deps: AttemptDeps,
  userId: string,
  attemptId: string,
  parsed: unknown,
  serviceResult: unknown,
  token: string,
  idempotencyKey: string | undefined,
  onApplied?: (trx: Db) => Promise<void>,
): Promise<ActionOutcome> {
  return withDeadlockRetry(() =>
    db.transaction().execute(async (trx): Promise<ActionOutcome> => {
      const locked = await lockAttempt(trx, scope, deps, userId, attemptId)
      if (locked.row.pending_key !== token) return { ok: false, error: { code: 'busy', message: 'This attempt changed while waiting. Please try again.' } }
      const now = (deps.now ?? (() => new Date()))()
      const services = servicesFor(trx, deps, locked.row.challenge_id)
      const env = { services, at: now.toISOString(), ...(deps.onError ? { onError: deps.onError } : {}) }
      const result = await applyServiceResult(locked.type, locked.def, toAttempt(locked.row), parsed, env, serviceResult)
      if (!result.ok) {
        await clearPending(trx, attemptId, token)
        return { ok: false, error: result.error }
      }
      const snapshot = await commitResult(trx, scope, { ...deps, services }, locked, result, idempotencyKey, now)
      await onApplied?.(trx)
      return { ok: true, duplicate: false, snapshot }
    }),
  )
}
