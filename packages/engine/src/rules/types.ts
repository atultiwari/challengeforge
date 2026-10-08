/**
 * Shared types for the rule (answer-checking) primitives.
 *
 * Harvested from the Clinical AI Challenge Lab's validators, with the Lab's
 * closed challenge-id enum widened to `string` and every outside dependency
 * (judge, datasets) injected so the engine stays pure.
 */

/** Per-rule outcome, surfaced to the learner as feedback without leaking the key. */
export interface RuleOutcome {
  passed: boolean
  /** Learner-facing, must never contain the expected answer. */
  message: string
  /** Optional progress counters, e.g. "3 of 5 found". */
  detail?: { found?: number; required?: number; falsePositives?: number }
}

/** One turn of a conversation, as recorded by the SERVER (never the browser). */
export interface TranscriptTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface JudgeVerdict {
  goal_met: boolean
  reason: string
}

export type Judge = (
  rubric: string,
  transcript: readonly TranscriptTurn[],
  options?: { showPatient?: boolean },
) => Promise<JudgeVerdict>

export type DatasetRow = Readonly<Record<string, unknown>>
export type DatasetLoader = (ref: string) => Promise<readonly DatasetRow[]>

/**
 * Services a rule may need. Everything optional fails CLOSED when absent: a
 * missing judge or dataset must never hand the learner a pass.
 */
export interface RuleContext {
  challengeId: string
  userId: string
  /** Per-user canary planted in a hidden system prompt. */
  canary?: string
  /** The conversation as the SERVER recorded it; payload transcripts are ignored. */
  transcript?: readonly TranscriptTurn[]
  judge?: Judge
  loadDataset?: DatasetLoader
}

/** A rule outcome may also carry a points deduction and the hidden items found. */
export interface ScoredOutcome extends RuleOutcome {
  pointsPenalty?: number
  /** Server-side only: ids of hidden items the learner found. Never sent on failure. */
  foundIds?: string[]
}

export type Validator<R> = (rule: R, payload: unknown, ctx: RuleContext) => Promise<ScoredOutcome> | ScoredOutcome
