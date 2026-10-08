import type { NumericRangeRule } from './schema'
import type { Validator } from './types'
import { readField, parseLearnerNumber } from '../payload'

const GENERIC_MISS = 'That number is not close enough. Check how you calculated it.'

export const validateNumericRange: Validator<NumericRangeRule> = (rule, payload) => {
  const submitted = parseLearnerNumber(readField(payload, rule.field))
  if (submitted === null) {
    return { passed: false, message: 'Enter a number for this part.' }
  }
  if (Math.abs(submitted - rule.expected) <= rule.tolerance) {
    return { passed: true, message: 'Correct.' }
  }

  // A recognisable wrong answer gets feedback on the specific mistake - "that
  // is the PPV" teaches more than "not close enough".
  const mistake = (rule.common_mistakes ?? []).find((m) => Math.abs(submitted - m.value) <= m.tolerance)
  return { passed: false, message: mistake?.message.trim() ?? GENERIC_MISS }
}
