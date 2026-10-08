import type { ScoringPolicy } from './policy'

/**
 * Whether a learner may submit now, and whether "show me the answer" is on
 * offer. Pure, so every rule is unit-tested without a database.
 */
export interface AttemptState {
  attempts: number
  wrongAttempts: number
  lastWrongAt: string | null
  completedAt: string | null
  revealedAt: string | null
}

export type SubmitDecision =
  | { allowed: true }
  | { allowed: false; code: 'max_attempts'; message: string }
  | { allowed: false; code: 'cooldown'; message: string; retryAfterSeconds: number }

const NO_PROGRESS: AttemptState = {
  attempts: 0,
  wrongAttempts: 0,
  lastWrongAt: null,
  completedAt: null,
  revealedAt: null,
}

export function canSubmit(
  scoring: ScoringPolicy,
  state: AttemptState | null,
  now: Date = new Date(),
): SubmitDecision {
  const s = state ?? NO_PROGRESS
  // A captured flag can always be re-submitted; the better score is kept.
  if (s.completedAt) return { allowed: true }

  if (scoring.max_attempts !== null && s.attempts >= scoring.max_attempts) {
    return {
      allowed: false,
      code: 'max_attempts',
      message: `You have used all ${scoring.max_attempts} attempts for this challenge.`,
    }
  }

  if (scoring.retry_cooldown_seconds > 0 && s.lastWrongAt) {
    const readyAt = new Date(s.lastWrongAt).getTime() + scoring.retry_cooldown_seconds * 1000
    const wait = Math.ceil((readyAt - now.getTime()) / 1000)
    if (wait > 0) {
      return {
        allowed: false,
        code: 'cooldown',
        message: `Take another look first - you can submit again in ${wait} second${wait === 1 ? '' : 's'}.`,
        retryAfterSeconds: wait,
      }
    }
  }

  return { allowed: true }
}

/** "Show me the answer" is offered after enough honest attempts, before capture. */
export function canReveal(scoring: ScoringPolicy, state: AttemptState | null): boolean {
  if (scoring.reveal_after_attempts === null || !state) return false
  if (state.completedAt) return false
  return state.wrongAttempts >= scoring.reveal_after_attempts
}
