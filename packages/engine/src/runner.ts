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

export type ActErrorCode = 'invalid_action' | 'attempt_closed' | 'rejected' | 'step_failed'

export interface ActError {
  code: ActErrorCode
  /** Learner-safe. */
  message: string
  /** The type's own rejection code, when code is 'rejected'. */
  typeCode?: string
  /** Server-side only: the thrown value behind a step_failed. */
  cause?: unknown
}

export type ActResult<S, A, V> =
  | { ok: true; attempt: Attempt<S>; event: AttemptEvent<A>; view: V }
  | { ok: false; error: ActError }

export interface ActEnv {
  services: Services
  /** ISO time of the action. Injected so the runner never reads a clock. */
  at: string
  recorded?: unknown
}

export function startAttempt<D, S, A, V>(
  type: ChallengeType<D, S, A, V>,
  def: D,
  ctx: AttemptCtx,
): { attempt: Attempt<S>; view: V } {
  const state = type.init(def, ctx)
  const status: AttemptStatus = type.isTerminal(def, state) ? 'terminal' : 'open'
  return { attempt: { ctx, state, seq: 0, status }, view: type.view(def, state) }
}

export async function act<D, S, A, V>(
  type: ChallengeType<D, S, A, V>,
  def: D,
  attempt: Attempt<S>,
  rawAction: unknown,
  env: ActEnv,
): Promise<ActResult<S, A, V>> {
  if (attempt.status === 'terminal') {
    return { ok: false, error: { code: 'attempt_closed', message: 'This attempt has finished.' } }
  }
  const parsed = type.actionSchema.safeParse(rawAction)
  if (!parsed.success) {
    return { ok: false, error: { code: 'invalid_action', message: 'That action is not available here.' } }
  }

  const stepEnv: StepEnv = { ctx: attempt.ctx, services: env.services, at: env.at, recorded: env.recorded }
  let outcome
  try {
    outcome = await type.step(def, attempt.state, parsed.data, stepEnv)
  } catch (cause) {
    return {
      ok: false,
      error: { code: 'step_failed', message: 'Something went wrong. Please try again.', cause },
    }
  }
  if (!outcome.ok) {
    return { ok: false, error: { code: 'rejected', message: outcome.error.message, typeCode: outcome.error.code } }
  }

  const seq = attempt.seq + 1
  const event: AttemptEvent<A> =
    outcome.effects === undefined
      ? { seq, action: parsed.data, at: env.at }
      : { seq, action: parsed.data, at: env.at, effects: outcome.effects }
  const next: Attempt<S> = {
    ctx: attempt.ctx,
    state: outcome.state,
    seq,
    status: type.isTerminal(def, outcome.state) ? 'terminal' : 'open',
  }
  return { ok: true, attempt: next, event, view: type.view(def, outcome.state) }
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
 * recorded, so no model is called again. Used to re-grade after a rubric fix
 * and to show authors exactly what a learner did.
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
    const result = await act(type, def, attempt, event.action, { services, at: event.at, recorded: event.effects })
    if (!result.ok) return { ok: false, failedAtSeq: event.seq, error: result.error }
    attempt = result.attempt
  }
  return { ok: true, attempt }
}
