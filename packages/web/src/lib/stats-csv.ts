import type { ChallengeStats } from '@challengeforge/db'
import type { CsvValue } from './csv'

export const STATS_HEADER = ['Challenge', 'Learners', 'Attempts', 'Finished', 'Passed attempts', 'Learners passed', 'Pass rate', 'Median minutes', 'Waiting for review', 'Critical failures', 'Most-missed criterion', 'Its miss rate'] as const

const pct = (x: number | null) => (x === null ? null : Math.round(x * 1000) / 10)

export function statsRow(s: ChallengeStats): CsvValue[] {
  const worst = s.criteria[0]
  return [s.title, s.learners, s.attempts, s.finished, s.passedAttempts, s.learnersPassed, pct(s.passRate), s.medianMinutes, s.pendingReview, s.criticalFailures, worst?.label ?? null, worst ? pct(worst.missRate) : null]
}

export const percent = (x: number | null): string => (x === null ? '–' : `${Math.round(x * 100)}%`)
