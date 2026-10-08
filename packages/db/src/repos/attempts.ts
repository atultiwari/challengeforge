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
  assess,
  pointsFor,
  startAttempt,
  type ActError,
  type AnyChallengeType,
  type Assessment,
  type Attempt,
  type AttemptEvent,
  type Services,
  type TypeRegistry,
} from '@challengeforge/engine'
import type { Db } from '../client'
import { newId, newSeed } from '../ids'
import { fromJson, toBool, toJson } from '../json'
import { NotFoundError, hasRole, requireSignedIn, type Scope } from '../scope'
import { getForAuthoring, getPlayable, loadVersionDefinition } from './content'

export interface AttemptDeps {
  registry: TypeRegistry
  services?: Services
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
  | { ok: false; error: ActError }

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

/**
 * Returns the learner's open attempt on a challenge, or starts one pinned to
 * the published version. `preview` lets an author play the latest draft;
 * preview attempts never count towards progress.
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
  const target = preview ? await getForAuthoring(db, scope, challengeId) : await getPlayable(db, scope, challengeId)

  const open = await db
    .selectFrom('attempts')
    .select(ATTEMPT_COLUMNS)
    .where('site_id', '=', scope.siteId)
    .where('user_id', '=', p.userId)
    .where('challenge_id', '=', challengeId)
    .where('is_preview', '=', preview)
    .where('status', '=', 'open')
    .orderBy('started_at', 'desc')
    .limit(1)
    .executeTakeFirst()
  // A preview resumes only if it is still on the latest draft.
  if (open && (!preview || open.challenge_version_id === target.versionId)) return snapshotOf(db, deps, open)

  const type = typeFor(deps.registry, target.typeId, target.typeVersion)
  const id = newId()
  const seed = newSeed()
  const ctx = { attemptId: id, userId: p.userId, challengeId, seed }
  const { attempt } = startAttempt(type, target.definition, ctx)
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
  await db
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
  return snapshotOf(db, deps, row)
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

const RETRYABLE_ERRNOS = new Set([1213 /* deadlock */, 1205 /* lock wait timeout */])
const MAX_TX_ATTEMPTS = 3

async function withDeadlockRetry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work()
    } catch (err) {
      const errno = (err as { errno?: number }).errno
      if (attempt >= MAX_TX_ATTEMPTS || errno === undefined || !RETRYABLE_ERRNOS.has(errno)) throw err
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt))
    }
  }
}

/** Applies one learner action atomically. Only the attempt's owner may act. */
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
  return withDeadlockRetry(() =>
    db.transaction().execute(async (trx) => {
      const row = await trx
        .selectFrom('attempts')
        .select(ATTEMPT_COLUMNS)
        .where('id', '=', attemptId)
        .where('site_id', '=', scope.siteId)
        .where('user_id', '=', p.userId)
        .forUpdate()
        .executeTakeFirst()
      if (!row) throw new NotFoundError('Attempt not found.')

      if (key) {
        const seen = await trx.selectFrom('attempt_events').select('seq').where('attempt_id', '=', attemptId).where('idempotency_key', '=', key).executeTakeFirst()
        if (seen) return { ok: true as const, duplicate: true, snapshot: await snapshotOf(trx, deps, row) }
      }

      const type = typeFor(deps.registry, row.type_id, row.type_version)
      const def = await definitionFor(trx, row.challenge_version_id)
      const now = (deps.now ?? (() => new Date()))()
      const result = await act(type, def, toAttempt(row), rawAction, {
        services: deps.services ?? {},
        at: now.toISOString(),
        ...(deps.onError ? { onError: deps.onError } : {}),
      })
      if (!result.ok) return { ok: false as const, error: result.error }

      const next = result.attempt
      await trx
        .insertInto('attempt_events')
        .values({
          attempt_id: attemptId,
          seq: result.event.seq,
          action: toJson(result.event.action),
          effects: result.event.effects === undefined ? null : toJson(result.event.effects),
          at: now,
          idempotency_key: key ?? null,
        })
        .execute()
      await trx
        .updateTable('attempts')
        .set({ state: toJson(next.state), seq: next.seq, status: next.status, updated_at: now, ...(next.status === 'terminal' ? { ended_at: now } : {}) })
        .where('id', '=', attemptId)
        .execute()

      const updated: AttemptRow = { ...row, seq: next.seq, status: next.status, state: next.state }
      if (next.status === 'terminal') await recordAssessment(trx, scope, deps, type, def, updated, next, now)
      return { ok: true as const, duplicate: false, snapshot: await snapshotOf(trx, deps, updated) }
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
