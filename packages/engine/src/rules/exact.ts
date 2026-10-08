import type { ExactRule } from './schema'
import type { Validator } from './types'
import { readString } from '../payload'


export const validateExact: Validator<ExactRule> = (rule, payload) => {
  const raw = readString(payload, rule.field)
  if (raw === null) {
    return { passed: false, message: 'No answer was submitted for this part.' }
  }
  const submitted = raw.trim()
  const expected = rule.expected.trim()
  const passed = rule.case_sensitive
    ? submitted === expected
    : submitted.toLowerCase() === expected.toLowerCase()

  return {
    passed,
    message: passed ? 'Correct.' : 'That is not the answer we are looking for.',
    // Review items can refer to a question by its field (e.g. "answers.s2").
    foundIds: passed ? [rule.field] : [],
  }
}
