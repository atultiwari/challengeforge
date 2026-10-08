/**
 * Rule shapes (answer keys). Harvested from the Lab's flag-rules.ts.
 *
 * Deliberately NOT harvested: `reproduce`, `test_suite` and `battery`. They
 * are bound to challenge-specific code (hidden oracles, attack batteries) and
 * return as built-in challenge types in Phase 2+ (PLAN.md §5).
 */
import { z } from 'zod'

/** An exact string/choice match. */
export const ExactRuleSchema = z.object({
  type: z.literal('exact'),
  field: z.string().min(1),
  expected: z.string().min(1),
  case_sensitive: z.boolean().default(false),
})

/** A number within a tolerance, with feedback for predictable wrong answers. */
export const NumericRangeRuleSchema = z.object({
  type: z.literal('numeric_range'),
  field: z.string().min(1),
  expected: z.number(),
  tolerance: z.number().nonnegative(),
  unit: z.string().nullable().default(null),
  /**
   * Predictable wrong answers and what each one means. The message tells the
   * learner which mistake they made; it must never state the expected value.
   */
  common_mistakes: z
    .array(
      z.object({
        value: z.number(),
        tolerance: z.number().nonnegative().default(0.5),
        message: z.string().min(1),
      }),
    )
    .default([]),
})

/** Find enough of a hidden set without over-flagging. */
export const SetMatchRuleSchema = z.object({
  type: z.literal('set_match'),
  field: z.string().min(1),
  /** Ids of the items that are genuinely the target. */
  expected_ids: z.array(z.string().min(1)).min(1),
  min_hits: z.number().int().positive(),
  max_false_positives: z.number().int().nonnegative(),
  /** When set, a hit only counts if the learner also tagged the right category. */
  require_category: z.boolean().default(false),
  categories: z.record(z.string(), z.string()).default({}),
  /** Further categories that also count for an item, where two are defensible. */
  also_accept: z.record(z.string(), z.array(z.string())).default({}),
  /** Other ids that count as the same item; flagging both copies counts once. */
  aliases: z.record(z.string(), z.string()).default({}),
})

/** LLM judge with a fixed rubric over the server transcript. */
export const LlmRubricRuleSchema = z.object({
  type: z.literal('llm_rubric'),
  goal_id: z.string().min(1),
  rubric: z.string().min(1),
  /** Let the judge see the learner's messages as untrusted context. Default: replies only. */
  show_patient_messages: z.boolean().default(false),
})

/** Deterministic leak detection: the bot echoed the per-user canary. */
export const CanaryRuleSchema = z.object({
  type: z.literal('canary'),
  goal_id: z.string().min(1),
})

/** The learner picks a decision threshold; the server recomputes performance from a dataset. */
export const MetricTargetRuleSchema = z.object({
  type: z.literal('metric_target'),
  field: z.string().min(1),
  dataset_ref: z.string().min(1),
  score_column: z.string().min(1),
  truth_column: z.string().min(1),
  min_sensitivity: z.number().gt(0).max(1),
  /** How far below the best achievable specificity (at the target) still passes. */
  max_specificity_gap: z.number().min(0).max(1),
})

export const LeafRuleSchema = z.discriminatedUnion('type', [
  ExactRuleSchema,
  NumericRangeRuleSchema,
  SetMatchRuleSchema,
  LlmRubricRuleSchema,
  CanaryRuleSchema,
  MetricTargetRuleSchema,
])
export type LeafRule = z.infer<typeof LeafRuleSchema>

export const AllOfRuleSchema = z.object({
  type: z.literal('all_of'),
  rules: z.array(LeafRuleSchema).min(2),
})

export const AnyNOfRuleSchema = z.object({
  type: z.literal('any_n_of'),
  n: z.number().int().positive(),
  rules: z.array(LeafRuleSchema).min(2),
})

export const RuleSchema = z.union([LeafRuleSchema, AllOfRuleSchema, AnyNOfRuleSchema])
export type Rule = z.infer<typeof RuleSchema>

export type ExactRule = z.infer<typeof ExactRuleSchema>
export type NumericRangeRule = z.infer<typeof NumericRangeRuleSchema>
export type SetMatchRule = z.infer<typeof SetMatchRuleSchema>
export type LlmRubricRule = z.infer<typeof LlmRubricRuleSchema>
export type CanaryRule = z.infer<typeof CanaryRuleSchema>
export type MetricTargetRule = z.infer<typeof MetricTargetRuleSchema>
