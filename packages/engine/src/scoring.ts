
/**
 * Points for a solved challenge (harvested from the Lab).
 *
 *   base points
 *   - what the learner spent on hints
 *   - a penalty for each wrong submission before success (guessing costs)
 *   - any penalty a rule applied (e.g. deductions for false findings)
 *   floored at zero. A learner who chose "show me the answer" earns zero.
 *
 * A learner who needed every hint still earns something: the point is that
 * they got there, and hint cost is the nudge to try first.
 */
export interface ScoreInput {
  basePoints: number
  hintCosts: number[]
  hintIndicesUsed: number[]
  validatorPenalty: number
  wrongAttempts?: number
  wrongAttemptPenalty?: number
  revealed?: boolean
}

export function calculatePoints({
  basePoints,
  hintCosts,
  hintIndicesUsed,
  validatorPenalty,
  wrongAttempts = 0,
  wrongAttemptPenalty = 0,
  revealed = false,
}: ScoreInput): number {
  if (revealed) return 0
  const hintSpend = hintIndicesUsed.reduce((sum, i) => sum + (hintCosts[i] ?? 0), 0)
  const guessing = Math.max(0, wrongAttempts) * Math.max(0, wrongAttemptPenalty)
  return Math.max(0, basePoints - hintSpend - guessing - Math.max(0, validatorPenalty))
}

/** What the challenge list shows before a challenge is attempted. */
export function maxAchievablePoints(basePoints: number, hintCosts: number[], hintIndicesUsed: number[]): number {
  return calculatePoints({ basePoints, hintCosts, hintIndicesUsed, validatorPenalty: 0 })
}

/** A challenge opens once every prerequisite is captured. */
export function isUnlocked(unlocksAfter: string[], capturedChallengeIds: string[]): boolean {
  return unlocksAfter.every((id) => capturedChallengeIds.includes(id))
}
