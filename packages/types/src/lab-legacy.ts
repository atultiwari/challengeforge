/**
 * `lab-legacy` (static): the Clinical AI Lab's missions on the new contract.
 *
 * One answer-key rule, many possible submissions. A wrong submission is a
 * non-terminal step (with the Lab's attempt policy: max attempts, cooldown,
 * "show me the answer"); a right one ends the attempt. The interaction
 * configuration is public by the Lab's own design; the rule, hints, debrief
 * and review items are not, and appear in the view only when earned.
 */
import { z } from 'zod'
import {
  RuleSchema,
  ScoringPolicySchema,
  canReveal,
  canSubmit,
  combineCriteria,
  evaluateRule,
  type AttemptCtx,
  type AttemptEvent,
  type AttemptState as PolicyState,
  type ChallengeType,
  type Criterion,
  type LintIssue,
  type PointsInput,
  type RuleOutcome,
  type RuleResult,
  type Services,
} from '@challengeforge/engine'

export const LabLegacyDefSchema = z
  .object({
  title: z.string().min(1),
  story_brief: z.string().default(''),
  /** Which player component renders it (ported from the Lab's interaction enum). */
  interaction: z.string().min(1),
  /** PUBLIC component configuration: labels, options, dataset refs. */
  interaction_config: z.record(z.string(), z.unknown()).default({}),
  rule: RuleSchema,
  scoring: ScoringPolicySchema,
  hints: z.array(z.string().min(1)).default([]),
  debrief: z.string().min(1),
  review_items: z
    .array(z.object({ id: z.string().min(1), label: z.string().min(1), explanation: z.string().min(1) }))
    .default([]),
  })
  // A missing cost would make a hint free, so this is a hard error, not just lint.
  .refine((d) => d.hints.length === d.scoring.hint_costs.length, {
    path: ['hints'],
    message: 'Each hint needs exactly one cost.',
  })
export type LabLegacyDef = z.infer<typeof LabLegacyDefSchema>

export const LabLegacyActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('submit'), payload: z.record(z.string(), z.unknown()) }),
  z.object({ kind: z.literal('hint'), index: z.number().int().nonnegative() }),
  z.object({ kind: z.literal('reveal') }),
])
export type LabLegacyAction = z.infer<typeof LabLegacyActionSchema>

export interface LabLegacyState {
  attempts: number
  wrongAttempts: number
  lastWrongAt: string | null
  solvedAt: string | null
  revealedAt: string | null
  hintsUsed: readonly number[]
  lastResult: RuleResult | null
}

export interface LabLegacyView {
  title: string
  storyBrief: string
  interaction: string
  config: Readonly<Record<string, unknown>>
  status: 'open' | 'solved' | 'revealed' | 'closed'
  attemptsUsed: number
  hintCosts: readonly number[]
  hints: readonly { index: number; cost: number; text: string }[]
  lastOutcomes: readonly RuleOutcome[] | null
  canReveal: boolean
  debrief?: string
  reviewItems?: readonly { id: string; label: string; explanation: string; found: boolean }[]
}

/** Shape check for a recorded grading result, so replay never trusts a malformed row. */
const RecordedResultSchema = z.strictObject({
  correct: z.boolean(),
  outcomes: z.array(
    z.strictObject({
      passed: z.boolean(),
      message: z.string(),
      detail: z
        .strictObject({ found: z.number().optional(), required: z.number().optional(), falsePositives: z.number().optional() })
        .optional(),
    }),
  ),
  pointsPenalty: z.number(),
  foundIds: z.array(z.string()),
})

type LeafRule = Extract<LabLegacyDef['rule'], { field?: unknown } | { goal_id?: unknown }>

function leavesOf(rule: LabLegacyDef['rule']): { leaf: LeafRule; path: string }[] {
  if (rule.type === 'all_of' || rule.type === 'any_n_of') {
    return rule.rules.map((leaf, i) => ({ leaf: leaf as LeafRule, path: `rule.rules.${i}` }))
  }
  return [{ leaf: rule as LeafRule, path: 'rule' }]
}

/** Judged rules are not repeatable: re-grading must reuse the recorded verdict. */
const isDeterministic = (rule: LabLegacyDef['rule']): boolean =>
  leavesOf(rule).every(({ leaf }) => leaf.type !== 'llm_rubric' && leaf.type !== 'canary')

const policyState = (s: LabLegacyState): PolicyState => ({
  attempts: s.attempts,
  wrongAttempts: s.wrongAttempts,
  lastWrongAt: s.lastWrongAt,
  completedAt: s.solvedAt,
  revealedAt: s.revealedAt,
})

const ruleCtx = (ctx: AttemptCtx, services: Services) => ({ ...services, challengeId: ctx.challengeId, userId: ctx.userId })

function outcomeLabels(def: LabLegacyDef): string[] {
  const raw = def.interaction_config['outcome_labels']
  return Array.isArray(raw) ? raw.filter((l): l is string => typeof l === 'string') : []
}

function isTerminal(def: LabLegacyDef, s: LabLegacyState): boolean {
  if (s.solvedAt || s.revealedAt) return true
  return def.scoring.max_attempts !== null && s.attempts >= def.scoring.max_attempts
}

function statusOf(def: LabLegacyDef, s: LabLegacyState): LabLegacyView['status'] {
  if (s.solvedAt) return 'solved'
  if (s.revealedAt) return 'revealed'
  return isTerminal(def, s) ? 'closed' : 'open'
}

function lint(def: LabLegacyDef): LintIssue[] {
  const issues: LintIssue[] = []
  if (def.hints.length !== def.scoring.hint_costs.length) {
    issues.push({
      path: 'hints',
      severity: 'error',
      message: `There are ${def.hints.length} hints but ${def.scoring.hint_costs.length} hint costs.`,
    })
  }
  const leaves = leavesOf(def.rule)
  const labels = outcomeLabels(def)
  if (labels.length > 0 && labels.length !== leaves.length) {
    issues.push({ path: 'interaction_config.outcome_labels', severity: 'warning', message: `Expected ${leaves.length} labels.` })
  }
  if (def.rule.type === 'any_n_of' && def.rule.n > def.rule.rules.length) {
    issues.push({ path: 'rule.n', severity: 'error', message: `Needs ${def.rule.n} of only ${def.rule.rules.length} parts.` })
  }
  for (const { leaf, path } of leaves) {
    if (leaf.type === 'set_match' && leaf.min_hits > leaf.expected_ids.length) {
      issues.push({ path: `${path}.min_hits`, severity: 'error', message: 'Requires more hits than there are items to find.' })
    }
  }
  const { max_attempts, reveal_after_attempts } = def.scoring
  if (max_attempts !== null && reveal_after_attempts !== null && reveal_after_attempts >= max_attempts) {
    issues.push({ path: 'scoring.reveal_after_attempts', severity: 'warning', message: 'The attempts run out before "show me the answer" is offered.' })
  }
  return issues
}

function view(def: LabLegacyDef, s: LabLegacyState): LabLegacyView {
  const status = statusOf(def, s)
  const base: LabLegacyView = {
    title: def.title,
    storyBrief: def.story_brief,
    interaction: def.interaction,
    config: { ...def.interaction_config },
    status,
    attemptsUsed: s.attempts,
    hintCosts: [...def.scoring.hint_costs],
    hints: s.hintsUsed.map((index) => ({ index, cost: def.scoring.hint_costs[index] ?? 0, text: def.hints[index] ?? '' })),
    lastOutcomes: s.lastResult?.outcomes ?? null,
    canReveal: canReveal(def.scoring, policyState(s)),
  }
  // The debrief is earned by solving or by choosing "show me the answer", not by running out of attempts.
  if (status === 'open' || status === 'closed') return base
  const found = new Set(s.lastResult?.foundIds ?? [])
  return {
    ...base,
    debrief: def.debrief,
    reviewItems: def.review_items.map((r) => ({ ...r, found: s.solvedAt !== null && found.has(r.id) })),
  }
}

async function evaluate(
  def: LabLegacyDef,
  trajectory: readonly AttemptEvent<LabLegacyAction>[],
  final: LabLegacyState,
  env: { ctx: AttemptCtx; services: Services },
) {
  const lastSubmit = [...trajectory].reverse().find((e) => e.action.kind === 'submit')
  const payload = lastSubmit?.action.kind === 'submit' ? lastSubmit.action.payload : {}
  // Deterministic rules are re-run, so a corrected key re-grades; judged ones reuse the recorded verdict.
  const result =
    isDeterministic(def.rule) || final.lastResult === null
      ? await evaluateRule(def.rule, payload, ruleCtx(env.ctx, env.services))
      : final.lastResult
  const correct = result.correct && final.revealedAt === null && lastSubmit !== undefined
  const labels = outcomeLabels(def)
  const criteria: Criterion[] = result.outcomes.map((o, i) => ({
    id: `part_${i + 1}`,
    label: labels[i] ?? `Part ${i + 1}`,
    // A captured mission earns the whole mission, as in the Lab.
    score: correct || o.passed ? 1 : 0,
    max: 1,
    passed: o.passed,
    feedback: o.message,
  }))
  return { ...combineCriteria(criteria, { passFraction: 0 }), passed: correct }
}

export const labLegacy: ChallengeType<LabLegacyDef, LabLegacyState, LabLegacyAction, LabLegacyView> & {
  pointsInput(def: LabLegacyDef, state: LabLegacyState): PointsInput
} = {
  id: 'lab-legacy',
  version: 1,
  paradigm: 'static',
  definitionSchema: LabLegacyDefSchema,
  actionSchema: LabLegacyActionSchema,
  lint,
  init: () => ({ attempts: 0, wrongAttempts: 0, lastWrongAt: null, solvedAt: null, revealedAt: null, hintsUsed: [], lastResult: null }),

  async step(def, s, action, env) {
    switch (action.kind) {
      case 'hint': {
        if (action.index !== s.hintsUsed.length || action.index >= def.hints.length) {
          return { ok: false, error: { code: 'hint_out_of_order', message: 'Hints are unlocked one at a time, in order.' } }
        }
        return { ok: true, state: { ...s, hintsUsed: [...s.hintsUsed, action.index] } }
      }
      case 'reveal': {
        if (!canReveal(def.scoring, policyState(s))) {
          return { ok: false, error: { code: 'reveal_not_available', message: 'Keep trying a little longer first.' } }
        }
        return { ok: true, state: { ...s, revealedAt: env.at } }
      }
      case 'submit': {
        const decision = canSubmit(def.scoring, policyState(s), new Date(env.at))
        if (!decision.allowed) return { ok: false, error: { code: decision.code, message: decision.message } }
        const recorded = RecordedResultSchema.safeParse(env.recorded)
        const result: RuleResult = recorded.success
          ? recorded.data
          : await evaluateRule(def.rule, action.payload, ruleCtx(env.ctx, env.services))
        const next: LabLegacyState = {
          ...s,
          attempts: s.attempts + 1,
          wrongAttempts: s.wrongAttempts + (result.correct ? 0 : 1),
          lastWrongAt: result.correct ? s.lastWrongAt : env.at,
          solvedAt: result.correct ? env.at : null,
          lastResult: result,
        }
        return { ok: true, state: next, effects: result }
      }
    }
  },

  view,
  isTerminal,
  evaluate,

  pointsInput: (def, s) => ({
    basePoints: def.scoring.base_points,
    hintCosts: def.scoring.hint_costs,
    hintIndicesUsed: [...s.hintsUsed],
    wrongAttempts: s.wrongAttempts,
    wrongAttemptPenalty: def.scoring.wrong_attempt_penalty,
    revealed: s.revealedAt !== null,
    validatorPenalty: s.lastResult?.pointsPenalty ?? 0,
  }),
}
