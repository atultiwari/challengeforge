import type { TermMatchRule } from './schema'
import type { Validator } from './types'
import { readString } from '../payload'
import { matchesAnyTerm } from '../text'

/**
 * A free-typed answer that must name one of the accepted terms or synonyms,
 * e.g. a diagnosis. Whole-term match after normalisation, never a substring.
 */
export const validateTermMatch: Validator<TermMatchRule> = (rule, payload) => {
  const raw = readString(payload, rule.field)
  if (raw === null || raw.trim() === '') {
    return { passed: false, message: 'No answer was submitted for this part.' }
  }
  const passed = matchesAnyTerm(raw, rule.accepted)
  return {
    passed,
    message: passed ? 'Correct.' : 'That is not the answer we are looking for.',
    foundIds: passed ? [rule.field] : [],
  }
}
