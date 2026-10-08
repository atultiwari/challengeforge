/**
 * The attempt service: the pure engine runner, made durable and atomic.
 *
 * Each learner action runs in ONE transaction (PLAN.md §6.3):
 *   SELECT attempt ... FOR UPDATE → engine.act → INSERT event (seq + 1)
 *   → UPDATE state → on terminal, assess + record progress.
 * Parallel requests on one attempt serialise on the row lock; client retries
 * are made idempotent by an optional idempotency key per action.
 *
 * Phase 2 note: types whose step calls a model must not hold this lock across
 * the call. They will reserve, commit, call, then record (an
 * `awaiting_service` status). Phase 1 types make no service calls.
 */
import {
  DEFAULT_BASE_POINTS,
  act,
  applyServiceResult,
  parseAction,
  assess,
  pointsFor,
  startAttempt,
  type ActError,
  type AnyChallengeType,
  type Assessment,
  type Attempt,
  type AttemptEvent,
  type ServiceRequest,
  type Services,
  type TypeRegistry,
} from '@challengeforge/engine'
import type { Db } from '../client'
import { newId, newSeed } from '../ids'
import { fromJson, toBool, toJson } from '../json'
import { NotFoundError, hasRole, requireSignedIn, type Scope } from '../scope'
import { datasetLoaderFor } from './assets'
import { getForAuthoring, getPlayable, loadVersionDefinition } from './content'
import { withDeadlockRetry } from '../tx'

/** Performs a service a type asked for (e.g. a model reply); the server adds secrets such as API keys. */
export type ServiceRunner = (
  request: ServiceRequest,
  context: { siteId: string; userId: string; attemptId: string; challengeId: string },
) => Promise<unknown>

export interface AttemptDeps {
  registry: TypeRegistry
  services?: Services
  /** Needed only by types whose actions ask for a service (chat missions, judged grading). */
  runService?: ServiceRunner
  /** Injected for tests; defaults to the wall clock. */
  now?: () => Date
  /** Receives step failures for server-side logging. */
  onError?: (cause: unknown) => void
}

export interface PublicAssessment {
  criteria: Assessment['criteria']
  score: number
  max: number
  passed: boolean
  criticalFailure: boolean
  status: Assessment['status']
  points: number
}

export interface AttemptSnapshot {
  attemptId: string
  challengeId: string
  typeId: string
  status: 'open' | 'terminal'
  seq: number
  isPreview: boolean
  view: unknown
  assessment: PublicAssessment | null
}

export type ActionOutcome =
  | { ok: true; snapshot: AttemptSnapshot; duplicate: boolean }
  | { ok: false; error: ActError | { code: 'busy' | 'service_failed' | 'service_unavailable'; message: string; typeCode?: string } }

// ---- definition cache: versions are immutable, so caching by id is safe ----
const DEF_CACHE_LIMIT = 256
const defCache = new Map<string, unknown>()

async function definitionFor(db: Db, versionId: string): Promise<unknown> {
  const hit = defCache.get(versionId)
  if (hit !== undefined) {
    defCache.delete(versionId)
    defCache.set(versionId, hit)
    return hit
  }
  const def = await loadVersionDefinition(db, versionId)
  defCache.set(versionId, def)
  if (defCache.size > DEF_CACHE_LIMIT) defCache.delete(defCache.keys().next().value as string)
  return def
}

function typeFor(registry: TypeRegistry, typeId: string, typeVersion: number): AnyChallengeType {
  const type = registry.get(typeId, typeVersion)
  if (!type) throw new Error(`Challenge type ${typeId}@${typeVersion} is not installed.`)
  return type
}

interface AttemptRow {
  id: string
  user_id: string
  challenge_id: string
  challenge_version_id: string
  type_id: string
  type_version: number
  is_preview: number | boolean
  seed: number
  seq: number
  status: 'open' | 'terminal'
  state: unknown
}

const ATTEMPT_COLUMNS = [
  'id', 'user_id', 'challenge_id', 'challenge_version_id', 'type_id', 'type_version', 'is_preview', 'seed', 'seq', 'status', 'state',
] as const

function toAttempt(row: AttemptRow): Attempt<unknown> {
  return {
    ctx: { attemptId: row.id, userId: row.user_id, challengeId: row.challenge_id, seed: row.seed },
    state: fromJson(row.state),
    seq: row.seq,
    status: row.status,
  }
}

async function loadAssessment(db: Db, attemptId: string): Promise<PublicAssessment | null> {
  const row = await db.selectFrom('assessments').selectAll().where('attempt_id', '=', attemptId).executeTakeFirst()
  if (!row) return null
  return {
    criteria: fromJson(row.criteria),
    score: row.score,
    max: row.max,
    passed: toBool(row.passed),
    criticalFailure: toBool(row.critical_failure),
    status: row.status,
    points: row.points,
  }
}

async function snapshotOf(db: Db, deps: AttemptDeps, row: AttemptRow): Promise<AttemptSnapshot> {
  const type = typeFor(deps.registry, row.type_id, row.type_version)
  const def = await definitionFor(db, row.challenge_version_id)
  return {
    attemptId: row.id,
    challengeId: row.challenge_id,
    typeId: row.type_id,
    status: row.status,
    seq: row.seq,
    isPreview: toBool(row.is_preview),
    view: type.view(def, fromJson(row.state)),
    assessment: row.status === 'terminal' ? await loadAssessment(db, row.id) : null,
  }
}

type Target = Awaited<ReturnType<typeof getPlayable>>

/** What a learner may play (published) or an author may preview (latest draft); throws if neither. */
async function resolveTarget(db: Db, scope: Scope, challengeId: string, preview: boolean): Promise<Target> {
  return preview ? getForAuthoring(db, scope, challengeId) : getPlayable(db, scope, challengeId)
}

async function openAttemptRow(db: Db, scope: Scope, userId: string, challengeId: string, preview: boolean, target: Target) {
  const open = await db
    .selectFrom('attempts')
    .select(ATTEMPT_COLUMNS)
    .where('site_id', '=', scope.siteId)
    .where('user_id', '=', userId)
    .where('challenge_id', '=', challengeId)
    .where('is_preview', '=', preview)
    .where('status', '=', 'open')
    .orderBy('started_at', 'desc')
    .limit(1)
    .executeTakeFirst()
  // A preview resumes only if it is still on the latest draft.
  return open && (!preview || open.challenge_version_id === target.versionId) ? open : null
}

/**
 * The learner's open attempt on a challenge, or null. Never creates one, so
 * it is safe on a page GET (a cross-site link cannot start attempts).
 */
export async function findOpenAttempt(
  db: Db,
  scope: Scope,
  deps: AttemptDeps,
  challengeId: string,
  options: { preview?: boolean } = {},
): Promise<AttemptSnapshot | null> {
  const p = requireSignedIn(scope)
  const preview = options.preview === true
  const target = await resolveTarget(db, scope, challengeId, preview)
  const row = await openAttemptRow(db, scope, p.userId, challengeId, preview, target)
  return row ? snapshotOf(db, deps, row) : null
}

/**
 * Returns the learner's open attempt on a challenge, or starts one pinned to
 * the published version. `preview` lets an author play the latest draft;
 * preview attempts never count towards progress.
 *
 * Starts are serialised per person (their membership row is locked), so two
 * tabs or a double click can never create two open attempts.
 */
export async function startOrResume(
  db: Db,
  scope: Scope,
  deps: AttemptDeps,
  challengeId: string,
  options: { preview?: boolean } = {},
): Promise<AttemptSnapshot> {
  const p = requireSignedIn(scope)
  const preview = options.preview === true
  const target = await resolveTarget(db, scope, challengeId, preview)
  const type = typeFor(deps.registry, target.typeId, target.typeVersion)

  return withDeadlockRetry(() =>
    db.transaction().execute(async (trx) => {
      await trx
        .selectFrom('memberships')
        .select('user_id')
        .where('site_id', '=', scope.siteId)
        .where('user_id', '=', p.userId)
        .forUpdate()
        .executeTakeFirst()
      const open = await openAttemptRow(trx, scope, p.userId, challengeId, preview, target)
      if (open) return snapshotOf(trx, deps, open)

      const id = newId()
      const seed = newSeed()
      const { attempt } = startAttempt(type, target.definition, { attemptId: id, userId: p.userId, challengeId, seed })
      const now = (deps.now ?? (() => new Date()))()
      const row: AttemptRow = {
        id,
        user_id: p.userId,
        challenge_id: challengeId,
        challenge_version_id: target.versionId,
        type_id: target.typeId,
        type_version: target.typeVersion,
        is_preview: preview,
        seed,
        seq: 0,
        status: attempt.status,
        state: attempt.state,
      }
      await trx
        .insertInto('attempts')
        .values({
          ...row,
          is_preview: preview,
          site_id: scope.siteId,
          state: toJson(attempt.state),
          started_at: now,
          updated_at: now,
          ended_at: attempt.status === 'terminal' ? now : null,
        })
        .execute()
      // A type whose attempt is over before any action still gets graded.
      if (attempt.status === 'terminal') await recordAssessment(trx, scope, deps, type, target.definition, row, attempt, now)
      return snapshotOf(trx, deps, row)
    }),
  )
}

/** Services for one challenge's attempt: injected ones, plus its own datasets. */
function servicesFor(db: Db, deps: AttemptDeps, challengeId: string): Services {
  return { loadDataset: datasetLoaderFor(db, challengeId), ...(deps.services ?? {}) }
}

/** Reads an attempt: its owner, or an admin reviewing it. */
export async function getAttempt(db: Db, scope: Scope, deps: AttemptDeps, attemptId: string): Promise<AttemptSnapshot> {
  const p = requireSignedIn(scope)
  let query = db.selectFrom('attempts').select(ATTEMPT_COLUMNS).where('id', '=', attemptId).where('site_id', '=', scope.siteId)
  if (!hasRole(scope, 'admin')) query = query.where('user_id', '=', p.userId)
  const row = await query.executeTakeFirst()
  // Someone else's attempt is "not found", so ids cannot be probed.
  if (!row) throw new NotFoundError('Attempt not found.')
  return snapshotOf(db, deps, row)
}

/** How long a parked service action may block its attempt before it is treated as lost. */
export const PENDING_TIMEOUT_MS = 2 * 60_000

interface Locked {
  row: AttemptRow & { pending_key: string | null; pending_since: Date | null }
  type: AnyChallengeType
  def: unknown
}

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

const isPending = (row: Locked['row'], now: Date): boolean =>
  row.pending_since !== null && now.getTime() - row.pending_since.getTime() < PENDING_TIMEOUT_MS

/** Writes an applied action: the event, the new state and, at the end, the assessment and progress. */
async function commitResult(
  trx: Db,
  scope: Scope,
  deps: AttemptDeps,
  locked: Locked,
  result: Extract<Awaited<ReturnType<typeof act>>, { ok: true }>,
  key: string | undefined,
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
      idempotency_key: key ?? null,
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

type Phase1 =
  | { done: ActionOutcome }
  | { park: { request: ServiceRequest; parsed: unknown } }

/**
 * Applies one learner action atomically. Only the attempt's owner may act.
 *
 * Most actions run in one transaction. An action whose type asks for a
 * service (a model reply, a judged grade) runs in three steps so that no
 * lock is ever held across the call (PLAN.md §6.3):
 *   1. lock, park the action on the attempt (pending), commit;
 *   2. run the service with no lock held;
 *   3. lock again, apply the result, clear the pending action.
 */
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
  const clock = deps.now ?? (() => new Date())

  const phase1: Phase1 = await withDeadlockRetry(() =>
    db.transaction().execute(async (trx): Promise<Phase1> => {
      const locked = await lockAttempt(trx, scope, deps, p.userId, attemptId)
      const { row, type, def } = locked
      if (key) {
        const seen = await trx.selectFrom('attempt_events').select('seq').where('attempt_id', '=', attemptId).where('idempotency_key', '=', key).executeTakeFirst()
        if (seen) return { done: { ok: true, duplicate: true, snapshot: await snapshotOf(trx, deps, row) } }
      }
      const now = clock()
      if (isPending(row, now)) return { done: { ok: false, error: { code: 'busy', message: 'Still waiting for the last reply. Try again in a moment.' } } }

      const parsed = parseAction(type, rawAction)
      const request = parsed === null || row.status === 'terminal' ? null : (type.prepare?.(def, fromJson(row.state), parsed, toAttempt(row).ctx) ?? null)
      if (request) {
        await trx
          .updateTable('attempts')
          .set({ pending_action: toJson(parsed), pending_key: key ?? 'pending', pending_since: now })
          .where('id', '=', attemptId)
          .execute()
        return { park: { request, parsed } }
      }

      const services = servicesFor(trx, deps, row.challenge_id)
      const result = await act(type, def, toAttempt(row), rawAction, { services, at: now.toISOString(), ...(deps.onError ? { onError: deps.onError } : {}) })
      if (!result.ok) return { done: { ok: false, error: result.error } }
      return { done: { ok: true, duplicate: false, snapshot: await commitResult(trx, scope, { ...deps, services }, locked, result, key, now) } }
    }),
  )
  if ('done' in phase1) return phase1.done
  return runParkedService(db, scope, deps, p.userId, attemptId, phase1.park, key)
}

async function clearPending(db: Db, attemptId: string): Promise<void> {
  await db.updateTable('attempts').set({ pending_action: null, pending_key: null, pending_since: null }).where('id', '=', attemptId).execute()
}

/** Steps 2 and 3: call the service with no lock held, then apply its result. */
async function runParkedService(
  db: Db,
  scope: Scope,
  deps: AttemptDeps,
  userId: string,
  attemptId: string,
  parked: { request: ServiceRequest; parsed: unknown },
  key: string | undefined,
): Promise<ActionOutcome> {
  if (!deps.runService) {
    await clearPending(db, attemptId)
    return { ok: false, error: { code: 'service_unavailable', message: 'This challenge needs an AI service that is not set up on this site.' } }
  }
  const head = await db.selectFrom('attempts').select(['challenge_id', 'seed']).where('id', '=', attemptId).executeTakeFirstOrThrow()
  let serviceResult: unknown
  try {
    serviceResult = await deps.runService(parked.request, { siteId: scope.siteId, userId, attemptId, challengeId: head.challenge_id })
  } catch (cause) {
    deps.onError?.(cause)
    await clearPending(db, attemptId)
    const message = (cause as { userMessage?: unknown }).userMessage
    return { ok: false, error: { code: 'service_failed', message: typeof message === 'string' ? message : 'The AI service could not be reached. Please try again.' } }
  }

  return withDeadlockRetry(() =>
    db.transaction().execute(async (trx): Promise<ActionOutcome> => {
      const locked = await lockAttempt(trx, scope, deps, userId, attemptId)
      if (locked.row.pending_key !== (key ?? 'pending')) {
        return { ok: false, error: { code: 'busy', message: 'This attempt changed while waiting. Please try again.' } }
      }
      const now = (deps.now ?? (() => new Date()))()
      const services = servicesFor(trx, deps, locked.row.challenge_id)
      const result = await applyServiceResult(locked.type, locked.def, toAttempt(locked.row), parked.parsed, { services, at: now.toISOString(), ...(deps.onError ? { onError: deps.onError } : {}) }, serviceResult)
      if (!result.ok) {
        await trx.updateTable('attempts').set({ pending_action: null, pending_key: null, pending_since: null }).where('id', '=', attemptId).execute()
        return { ok: false, error: result.error }
      }
      return { ok: true, duplicate: false, snapshot: await commitResult(trx, scope, { ...deps, services }, locked, result, key, now) }
    }),
  )
}

async function recordAssessment(
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
  const points = pointsFor(
    assessment,
    type.pointsInput?.(def, attempt.state) ?? { basePoints: DEFAULT_BASE_POINTS, hintCosts: [], hintIndicesUsed: [] },
  )
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

  const fraction = assessment.max > 0 ? assessment.score / assessment.max : 0
  await trx
    .insertInto('progress')
    .values({
      site_id: scope.siteId,
      user_id: row.user_id,
      challenge_id: row.challenge_id,
      attempts: 1,
      best_points: points,
      best_score_fraction: fraction,
      passed_at: assessment.passed ? now : null,
      updated_at: now,
    })
    .onDuplicateKeyUpdate((eb) => ({
      attempts: eb('attempts', '+', 1),
      best_points: eb.fn('GREATEST', [eb.ref('best_points'), eb.val(points)]),
      best_score_fraction: eb.fn('GREATEST', [eb.ref('best_score_fraction'), eb.val(fraction)]),
      passed_at: assessment.passed ? eb.fn.coalesce('passed_at', eb.val(now)) : eb.ref('passed_at'),
      updated_at: now,
    }))
    .execute()
}

export interface ProgressRow {
  challengeId: string
  attempts: number
  bestPoints: number
  passed: boolean
}

export async function listMyProgress(db: Db, scope: Scope): Promise<ProgressRow[]> {
  const p = requireSignedIn(scope)
  const rows = await db
    .selectFrom('progress')
    .select(['challenge_id', 'attempts', 'best_points', 'passed_at'])
    .where('site_id', '=', scope.siteId)
    .where('user_id', '=', p.userId)
    .limit(1000)
    .execute()
  return rows.map((r) => ({ challengeId: r.challenge_id, attempts: r.attempts, bestPoints: r.best_points, passed: r.passed_at !== null }))
}
