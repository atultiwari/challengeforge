import { z } from 'zod'

/**
 * Points, hints and retry rules for a challenge. Harvested from the Lab's
 * ScoringSchema; every challenge type can embed it in its definition.
 */
export const ScoringPolicySchema = z.object({
  base_points: z.number().int().positive(),
  /** Point cost of each hint, in order. */
  hint_costs: z.array(z.number().int().nonnegative()).default([]),
  max_attempts: z.number().int().positive().nullable().default(null),
  /** Points lost per wrong submission before success: guessing costs something. */
  wrong_attempt_penalty: z.number().int().nonnegative().default(0),
  /** Seconds a learner must wait after a wrong submission. 0 = no wait. */
  retry_cooldown_seconds: z.number().int().nonnegative().default(0),
  /** After this many wrong submissions "show me the answer" is offered (0 points). null = never. */
  reveal_after_attempts: z.number().int().positive().nullable().default(null),
})
export type ScoringPolicy = z.infer<typeof ScoringPolicySchema>
