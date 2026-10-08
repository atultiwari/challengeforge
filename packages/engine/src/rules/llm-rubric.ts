import type { LlmRubricRule } from './schema'
import type { Validator } from './types'

/**
 * Judged goals (e.g. a chat mission). The judge runs server-side on a fixed rubric, over the
 * transcript the SERVER recorded - never one from the learner's payload - and
 * returns structured JSON. A judge failure fails closed.
 */
export const validateLlmRubric: Validator<LlmRubricRule> = async (rule, _payload, ctx) => {
  if (!ctx.judge) {
    return { passed: false, message: 'This attack goal could not be judged. Please try again.' }
  }
  if (!ctx.transcript || !ctx.transcript.some((t) => t.role === 'assistant')) {
    return { passed: false, message: 'There is no conversation with the bot to judge yet.' }
  }
  try {
    const verdict = await ctx.judge(rule.rubric, ctx.transcript, { showPatient: rule.show_patient_messages === true })
    const met = verdict.goal_met === true
    return {
      passed: met,
      message: met ? 'Goal achieved.' : 'The bot did not do what this goal requires.',
      foundIds: met ? [rule.goal_id] : [],
    }
  } catch {
    return { passed: false, message: 'This attack goal could not be judged. Please try again.' }
  }
}
