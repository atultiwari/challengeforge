/**
 * The challenge-type contract (PLAN.md §3.2).
 *
 * A challenge TYPE is code; a challenge is DATA (`Def`) authored against the
 * type's schema. Every challenge runs as an ATTEMPT: a state folded from an
 * append-only log of learner actions. A static challenge is the one-step case.
 *
 * Everything here is pure except the injected `services`, and service outputs
 * are recorded on the event (`effects`) so an attempt can be replayed and
 * re-graded without calling a model again.
 */
import type { z } from 'zod'
import type { Assessment } from './assessment'
import type { RuleContext } from './rules/types'

export type Paradigm = 'static' | 'interactive'

/** Fixed facts about an attempt, known when it starts. */
export interface AttemptCtx {
  attemptId: string
  userId: string
  challengeId: string
  /** Seed for any randomness, so replays are deterministic. */
  seed: number
}

/** Outside capabilities a type may use. Absent services must fail closed. */
export type Services = Omit<RuleContext, 'challengeId' | 'userId'>

export interface StepEnv {
  ctx: AttemptCtx
  services: Services
  /** ISO time of this action, supplied by the runner (from the event on replay). */
  at: string
  /** On replay: the `effects` this step recorded originally. Types must prefer it over calling a service. */
  recorded?: unknown
}

export interface StepError {
  code: string
  /** Learner-safe. */
  message: string
}

export type StepOutcome<S> =
  | { ok: true; state: S; effects?: unknown }
  | { ok: false; error: StepError }

export interface LintIssue {
  /** Dot-path into the definition, for the author form to highlight. */
  path: string
  severity: 'error' | 'warning'
  message: string
}

export interface AttemptEvent<A = unknown> {
  seq: number
  action: A
  at: string
  effects?: unknown
}

export interface ChallengeType<Def, State, Action, View> {
  readonly id: string
  readonly version: number
  readonly paradigm: Paradigm
  /** What the author fills in, including the answer key. Never sent to a browser. */
  readonly definitionSchema: z.ZodType<Def>
  /** What a browser may send. Everything else is rejected at the boundary. */
  readonly actionSchema: z.ZodType<Action>
  lint(def: Def): readonly LintIssue[]
  init(def: Def, ctx: AttemptCtx): State
  step(def: Def, state: State, action: Action, env: StepEnv): Promise<StepOutcome<State>>
  /** The ONLY projection of state that may reach the learner (default-deny, PLAN.md §3.4). */
  view(def: Def, state: State): View
  isTerminal(def: Def, state: State): boolean
  evaluate(def: Def, trajectory: readonly AttemptEvent<Action>[], final: State, services: Services): Promise<Assessment>
}

/** A type with its generics erased, for registries that hold many types. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyChallengeType = ChallengeType<any, any, any, any>
