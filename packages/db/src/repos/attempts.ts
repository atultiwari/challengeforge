/**
 * The attempt service: the pure engine runner, made durable and atomic.
 *
 * Each learner action runs in ONE transaction (PLAN.md §6.3):
 *   SELECT attempt ... FOR UPDATE → engine.act → INSERT event (seq + 1)
 *   → UPDATE state → on terminal, assess + record progress.
 * Parallel requests on one attempt serialise on the row lock; client retries
 * are made idempotent by an optional idempotency key per action.
 *
 * Actions that need a model never hold this lock across the call: see
 * attempt-actions.ts (park under a token, call, apply if still parked).
 */
import {
  startAttempt,
  type ActError,
  type AnyChallengeType,
  type Assessment,
  type Attempt,
  type ServiceRequest,
  type Services,
  type TypeRegistry,
} from '@challengeforge/engine'
import type { Db } from '../client'
import { newId, newSeed } from '../ids'
import { fromJson, toBool, toJson } from '../json'
import { ForbiddenError, NotFoundError, hasRole, requireSignedIn, type Scope } from '../scope'
import { datasetLoaderFor } from './assets'
import { getForAuthoring, getPlayable, loadVersionDefinition } from './content'
import { withDeadlockRetry } from '../tx'
import { canReviewAsInstructor } from './cohort-progress'
import { LOCKED_MESSAGE, canPlay } from './access'
import { recordAssessment } from './results'

/** Performs a service a type asked for (e.g. a model reply); the server adds secrets such as API keys. */
export type ServiceRunner = (
  request: ServiceRequest,
  context: { siteId: string; userId: string; attemptId: string; challengeId: string },
) => Promise<unknown>

/** How long a parked service action may block its attempt before it is treated as lost. */
export const PENDING_TIMEOUT_MS = 2 * 60_000
/** Background jobs get longer: they advance only when polled or run by cron. */
export const JOB_TIMEOUT_MS = 30 * 60_000
export const JOB_KEY_PREFIX = 'job:'

/** Runs one bounded slice of a background job; returns progress to save, or the final result. */
export type JobSliceRunner = (
  request: ServiceRequest,
  progress: unknown,
  context: { siteId: string; userId: string; attemptId: string; challengeId: string },
) => Promise<{ done: false; progress: unknown } | { done: true; result: unknown }>

export interface AttemptDeps {
  registry: TypeRegistry
  services?: Services
  /** Needed only by types whose actions ask for a service (chat missions, judged grading). */
  runService?: ServiceRunner
  /** Needed only by types whose actions ask for a background job (e.g. prompt hardening). */
  runJobSlice?: JobSliceRunner
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

export interface PendingJob {
  id: string
  status: 'queued' | 'running'
  progress: unknown
}

export interface AttemptSnapshot {
  /** Long work (e.g. an evaluation run) in progress for this attempt; the page polls it. */
  pendingJob: PendingJob | null
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

/**
 * A stored definition read through its type's schema, so a field the type
 * gained since the version was saved gets its default (e.g. `patient_chat` on
 * a diagnostic case saved before the simulated patient existed). A definition
 * the current schema refuses is passed on unchanged rather than locking
 * learners out of an attempt they already started.
 */
export function withDefaults(type: AnyChallengeType, stored: unknown): unknown {
  const parsed = type.definitionSchema.safeParse(stored)
  return parsed.success ? parsed.data : stored
}

/** @internal */
export async function definitionFor(db: Db, type: AnyChallengeType, versionId: string): Promise<unknown> {
  const hit = defCache.get(versionId)
  if (hit !== undefined) {
    defCache.delete(versionId)
    defCache.set(versionId, hit)
    return hit
  }
  const def = withDefaults(type, await loadVersionDefinition(db, versionId))
  defCache.set(versionId, def)
  if (defCache.size > DEF_CACHE_LIMIT) defCache.delete(defCache.keys().next().value as string)
  return def
}

/** @internal */
export function typeFor(registry: TypeRegistry, typeId: string, typeVersion: number): AnyChallengeType {
  const type = registry.get(typeId, typeVersion)
  if (!type) throw new Error(`Challenge type ${typeId}@${typeVersion} is not installed.`)
  return type
}

/** @internal */
export interface AttemptRow {
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

/** @internal */
export const ATTEMPT_COLUMNS = [
  'id', 'user_id', 'challenge_id', 'challenge_version_id', 'type_id', 'type_version', 'is_preview', 'seed', 'seq', 'status', 'state',
] as const

/** @internal */
export function toAttempt(row: AttemptRow): Attempt<unknown> {
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

async function pendingJobOf(db: Db, attemptId: string): Promise<PendingJob | null> {
  const job = await db
    .selectFrom('jobs')
    .select(['id', 'status', 'progress'])
    .where('attempt_id', '=', attemptId)
    .where('status', 'in', ['queued', 'running'])
    .orderBy('created_at', 'desc')
    .limit(1)
    .executeTakeFirst()
  return job ? { id: job.id, status: job.status as PendingJob['status'], progress: job.progress === null ? null : fromJson(job.progress) } : null
}

/** @internal */
export async function snapshotOf(db: Db, deps: AttemptDeps, row: AttemptRow): Promise<AttemptSnapshot> {
  const type = typeFor(deps.registry, row.type_id, row.type_version)
  const def = await definitionFor(db, type, row.challenge_version_id)
  return {
    pendingJob: await pendingJobOf(db, row.id),
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
async function resolveTarget(db: Db, scope: Scope, registry: TypeRegistry, challengeId: string, preview: boolean): Promise<Target> {
  const target = preview ? await getForAuthoring(db, scope, challengeId) : await getPlayable(db, scope, challengeId)
  // A restricted pack needs a grant or a cohort assignment (repos/access.ts).
  if (!preview && !(await canPlay(db, scope, challengeId))) throw new ForbiddenError(LOCKED_MESSAGE)
  return { ...target, definition: withDefaults(typeFor(registry, target.typeId, target.typeVersion), target.definition) }
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
  const target = await resolveTarget(db, scope, deps.registry, challengeId, preview)
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
  const target = await resolveTarget(db, scope, deps.registry, challengeId, preview)
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
/** @internal */
export function servicesFor(db: Db, deps: AttemptDeps, challengeId: string): Services {
  return { loadDataset: datasetLoaderFor(db, challengeId), ...(deps.services ?? {}) }
}

/** Reads an attempt: its owner, an editor, or an instructor of a cohort it belongs to. */
export async function getAttempt(db: Db, scope: Scope, deps: AttemptDeps, attemptId: string): Promise<AttemptSnapshot> {
  const p = requireSignedIn(scope)
  const row = await db.selectFrom('attempts').select(ATTEMPT_COLUMNS).where('id', '=', attemptId).where('site_id', '=', scope.siteId).executeTakeFirst()
  const allowed =
    row !== undefined &&
    (row.user_id === p.userId || hasRole(scope, 'editor') || (await canReviewAsInstructor(db, scope, row.user_id, row.challenge_id)))
  // Someone else's attempt is "not found", so ids cannot be probed.
  if (!row || !allowed) throw new NotFoundError('Attempt not found.')
  return snapshotOf(db, deps, row)
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
