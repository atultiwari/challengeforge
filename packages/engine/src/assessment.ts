/**
 * Criterion-based assessment (PLAN.md §3.3): partial credit, critical errors,
 * and a review status for human override. Replaces the Lab's boolean
 * `correct` as the result of grading.
 */
import { evaluateRule } from './rules'
import type { Rule } from './rules/schema'
import type { RuleContext } from './rules/types'
import { calculatePoints } from './scoring'

export interface Criterion {
  id: string
  label: string
  score: number
  max: number
  passed: boolean
  /** Learner-facing; shown after the attempt ends. */
  feedback: string
  /** A missed critical criterion fails (or caps) the whole attempt. */
  critical?: boolean
}

export type AssessmentStatus = 'auto' | 'pending_review' | 'overridden'

export interface Assessment {
  criteria: readonly Criterion[]
  score: number
  max: number
  passed: boolean
  criticalFailure: boolean
  status: AssessmentStatus
}

export type CriticalPolicy = { mode: 'fail' } | { mode: 'cap'; capFraction: number }

export interface CombineOptions {
  /** Share of the maximum needed to pass, 0..1. */
  passFraction: number
  critical?: CriticalPolicy
  /** Route to an instructor before the result is final (e.g. LLM-judged free text). */
  needsReview?: boolean
}

const EPSILON = 1e-9

export function combineCriteria(criteria: readonly Criterion[], options: CombineOptions): Assessment {
  const max = criteria.reduce((sum, c) => sum + c.max, 0)
  const earned = criteria.reduce((sum, c) => sum + c.score, 0)
  const criticalFailure = criteria.some((c) => c.critical === true && !c.passed)
  const policy = options.critical ?? { mode: 'fail' }

  const score = criticalFailure && policy.mode === 'cap' ? Math.min(earned, policy.capFraction * max) : earned
  const meetsMark = max > 0 && score + EPSILON >= options.passFraction * max
  const passed = meetsMark && !(criticalFailure && policy.mode === 'fail')

  return {
    criteria: criteria.map((c) => ({ ...c })),
    score,
    max,
    passed,
    criticalFailure,
    status: options.needsReview ? 'pending_review' : 'auto',
  }
}

export interface RuleCriterionSpec {
  id: string
  label: string
  weight: number
  /** Default true: credit in proportion to the rule's parts that passed. */
  partialCredit?: boolean
  critical?: boolean
}

/** Wraps any answer-checking rule as a weighted criterion. */
export async function ruleCriterion(
  spec: RuleCriterionSpec,
  rule: Rule,
  payload: unknown,
  ctx: RuleContext,
): Promise<Criterion> {
  const result = await evaluateRule(rule, payload, ctx)
  const passedParts = result.outcomes.filter((o) => o.passed).length
  const fraction = result.correct ? 1 : spec.partialCredit === false ? 0 : passedParts / Math.max(1, result.outcomes.length)
  return {
    id: spec.id,
    label: spec.label,
    score: spec.weight * fraction,
    max: spec.weight,
    passed: result.correct,
    feedback: result.outcomes.map((o) => o.message).join(' '),
    ...(spec.critical ? { critical: true } : {}),
  }
}

export interface PointsInput {
  basePoints: number
  hintCosts: number[]
  hintIndicesUsed: number[]
  wrongAttempts?: number
  wrongAttemptPenalty?: number
  revealed?: boolean
  validatorPenalty?: number
}

/**
 * Leaderboard points for an assessment: base points scaled by the share of
 * the rubric earned, minus the Lab's hint and guessing deductions. A failed
 * attempt earns nothing.
 */
export function pointsFor(assessment: Assessment, input: PointsInput): number {
  if (!assessment.passed || assessment.max <= 0) return 0
  const scaledBase = Math.round((input.basePoints * assessment.score) / assessment.max)
  return calculatePoints({ ...input, basePoints: scaledBase, validatorPenalty: input.validatorPenalty ?? 0 })
}
