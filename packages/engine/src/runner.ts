/**
 * The attempt runner: the one place that turns a learner's raw input into a
 * new attempt state. Pure — persistence and locking are the caller's job
 * (packages/db wraps `act` in a transaction with SELECT ... FOR UPDATE).
 *
 * Nothing here mutates its inputs; every function returns new values.
 */
import type { Assessment } from './assessment'
import type { AttemptCtx, AttemptEvent, ChallengeType, Services, StepEnv } from './contract'

export type AttemptStatus = 'open' | 'terminal'

export interface Attempt<S> {
  ctx: AttemptCtx
  state: S
  /** Sequence number of the last applied event; 0 before any action. */
  seq: number
  status: AttemptStatus
}

export type ActErrorCode = 'invalid_action' | 'invalid_time' | 'attempt_closed' | 'rejected' | 'step_failed'

/** Safe to serialise to a browser: it never carries a stack trace or service error. */
export interface ActError {
  code: ActErrorCode
  message: string
  /** The type's own rejection code, when code is 'rejected'. */
  typeCode?: string
}

export type ActResult<S, A, V> =
  | { ok: true; attempt: Attempt<S>; event: AttemptEvent<A>; view: V }
  | { ok: false; error: ActError }

export interface ActEnv {
  services: Services
  /** ISO time of the action. Injected so the runner never reads a clock. */
  at: string
  /** Receives the underlying cause of a step_failed, for server-side logging only. */
  onError?: (cause: unknown) => void
}

/** Larger actions are refused before parsing: no learner action needs more. */
export const MAX_ACTION_BYTES = 64 * 1024

const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

function isValidTime(at: string): boolean {
  return ISO_TIME.test(at) && Number.isFinite(Date.parse(at))
}

function withinSizeLimit(raw: unknown): boolean {
  try {
    const json = JSON.stringify(raw)
    return json === undefined || json.length <= MAX_ACTION_BYTES
  } catch {
    // Circular structures and BigInts are not valid actions.
    return false
  }
}

const fail = (code: ActErrorCode, message: string, typeCode?: string): { ok: false; error: ActError } => ({
  ok: false,
  error: typeCode === undefined ? { code, message } : { code, message, typeCode },
})

const STEP_FAILED = 'Something went wrong. Please try again.'

export function startAttempt<D, S, A, V>(
  type: ChallengeType<D, S, A, V>,
  def: D,
  ctx: AttemptCtx,
): { attempt: Attempt<S>; view: V } {
  const state = type.init(def, ctx)
  const status: AttemptStatus = type.isTerminal(def, state) ? 'terminal' : 'open'
  return { attempt: { ctx, state, seq: 0, status }, view: type.view(def, state) }
}

/**
 * Shared by `act` (live) and `replay`. Only replay may pass `recorded`
 * effects: on the live path a client must never be able to supply a result.
 */
async function applyAction<D, S, A, V>(
  type: ChallengeType<D, S, A, V>,
  def: D,
  attempt: Attempt<S>,
  rawAction: unknown,
  env: ActEnv,
  recorded: unknown,
): Promise<ActResult<S, A, V>> {
  if (attempt.status === 'terminal') return fail('attempt_closed', 'This attempt has finished.')
  if (!isValidTime(env.at)) return fail('invalid_time', 'The action time was not valid.')
  if (!withinSizeLimit(rawAction)) return fail('invalid_action', 'That action is not available here.')
  const parsed = type.actionSchema.safeParse(rawAction)
  if (!parsed.success) return fail('invalid_action', 'That action is not available here.')

  const stepEnv: StepEnv = { ctx: attempt.ctx, services: env.services, at: env.at, recorded }
  try {
    const outcome = await type.step(def, attempt.state, parsed.data, stepEnv)
    if (!outcome.ok) return fail('rejected', outcome.error.message, outcome.error.code)

    const seq = attempt.seq + 1
    const event: AttemptEvent<A> =
      outcome.effects === undefined
        ? { seq, action: parsed.data, at: env.at }
        : { seq, action: parsed.data, at: env.at, effects: outcome.effects }
    const status: AttemptStatus = type.isTerminal(def, outcome.state) ? 'terminal' : 'open'
    const view = type.view(def, outcome.state)
    return { ok: true, attempt: { ctx: attempt.ctx, state: outcome.state, seq, status }, event, view }
  } catch (cause) {
    env.onError?.(cause)
    return fail('step_failed', STEP_FAILED)
  }
}

export function act<D, S, A, V>(
  type: ChallengeType<D, S, A, V>,
  def: D,
  attempt: Attempt<S>,
  rawAction: unknown,
  env: ActEnv,
): Promise<ActResult<S, A, V>> {
  return applyAction(type, def, attempt, rawAction, env, undefined)
}

/** Grades a finished attempt over its whole trajectory. */
export async function assess<D, S, A, V>(
  type: ChallengeType<D, S, A, V>,
  def: D,
  attempt: Attempt<S>,
  events: readonly AttemptEvent<A>[],
  services: Services,
): Promise<Assessment> {
  if (attempt.status !== 'terminal') {
    throw new Error(`Attempt ${attempt.ctx.attemptId} is still open; end it before assessing.`)
  }
  return type.evaluate(def, events, attempt.state, { ctx: attempt.ctx, services })
}

export type ReplayResult<S> =
  | { ok: true; attempt: Attempt<S> }
  | { ok: false; failedAtSeq: number; error: ActError | { code: 'bad_sequence'; message: string } }

/**
 * Rebuilds an attempt from its event log, feeding each step the effects it
 * recorded, so no model is called again. Pass the definition VERSION the
 * attempt was pinned to: replaying against an edited catalog can fail. To
 * re-grade against a corrected rubric, call `assess` with the new definition
 * on the stored final state instead (types grade from state + trajectory).
 */
export async function replay<D, S, A, V>(
  type: ChallengeType<D, S, A, V>,
  def: D,
  ctx: AttemptCtx,
  events: readonly AttemptEvent<unknown>[],
  services: Services,
): Promise<ReplayResult<S>> {
  let { attempt } = startAttempt(type, def, ctx)
  for (const event of events) {
    if (event.seq !== attempt.seq + 1) {
      return {
        ok: false,
        failedAtSeq: event.seq,
        error: { code: 'bad_sequence', message: `Expected event ${attempt.seq + 1}, found ${event.seq}.` },
      }
    }
    const result = await applyAction(type, def, attempt, event.action, { services, at: event.at }, event.effects)
    if (!result.ok) return { ok: false, failedAtSeq: event.seq, error: result.error }
    attempt = result.attempt
  }
  return { ok: true, attempt }
}
