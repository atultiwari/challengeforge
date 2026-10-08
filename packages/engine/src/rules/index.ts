import type { LeafRule, Rule } from './schema'
import type { RuleContext, RuleOutcome, ScoredOutcome } from './types'
import { validateExact } from './exact'
import { validateNumericRange } from './numeric-range'
import { validateSetMatch } from './set-match'
import { validateCanary } from './canary'
import { validateLlmRubric } from './llm-rubric'
import { validateMetricTarget } from './metric-target'

async function validateLeaf(rule: LeafRule, payload: unknown, ctx: RuleContext): Promise<ScoredOutcome> {
  switch (rule.type) {
    case 'exact':
      return validateExact(rule, payload, ctx)
    case 'numeric_range':
      return validateNumericRange(rule, payload, ctx)
    case 'set_match':
      return validateSetMatch(rule, payload, ctx)
    case 'canary':
      return validateCanary(rule, payload, ctx)
    case 'llm_rubric':
      return validateLlmRubric(rule, payload, ctx)
    case 'metric_target':
      return validateMetricTarget(rule, payload, ctx)
    default:
      // Unknown rule type: fail closed. An unrecognised key must never pass.
      return { passed: false, message: 'This answer could not be checked.' }
  }
}

export interface RuleResult {
  correct: boolean
  /** Learner-safe outcomes, one per leaf rule. */
  outcomes: RuleOutcome[]
  pointsPenalty: number
  /** Server-side only. */
  foundIds: string[]
}

function summarise(outcomes: readonly ScoredOutcome[], correct: boolean): RuleResult {
  return {
    correct,
    // foundIds are deliberately stripped from what the learner receives.
    outcomes: outcomes.map(({ passed, message, detail }) => (detail ? { passed, message, detail } : { passed, message })),
    pointsPenalty: outcomes.reduce((sum, o) => sum + (o.pointsPenalty ?? 0), 0),
    foundIds: [...new Set(outcomes.flatMap((o) => o.foundIds ?? []))],
  }
}

/** The single entry point for checking a value against an answer-key rule. */
export async function evaluateRule(rule: Rule, payload: unknown, ctx: RuleContext): Promise<RuleResult> {
  if (rule.type === 'all_of') {
    const outcomes = await Promise.all(rule.rules.map((r) => validateLeaf(r, payload, ctx)))
    return summarise(outcomes, outcomes.every((o) => o.passed))
  }
  if (rule.type === 'any_n_of') {
    const outcomes = await Promise.all(rule.rules.map((r) => validateLeaf(r, payload, ctx)))
    return summarise(outcomes, outcomes.filter((o) => o.passed).length >= rule.n)
  }
  const outcome = await validateLeaf(rule, payload, ctx)
  return summarise([outcome], outcome.passed)
}

export * from './schema'
export * from './types'
export { performanceAt, bestSpecificityAtTarget } from './metric-target'
