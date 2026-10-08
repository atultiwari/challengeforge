import { describe, it, expect } from 'vitest'
import { evaluateRule } from '../../src/rules'
import { ctx } from './helpers'
import type { Rule } from '../../src/rules/schema'

// A number AND a multiple-choice explanation, both required.
const numberAndChoice: Rule = {
  type: 'all_of',
  rules: [
    { type: 'numeric_range', field: 'sensitivity', expected: 37, tolerance: 2, unit: '%', common_mistakes: [] },
    { type: 'exact', field: 'explanation', expected: 'option_c', case_sensitive: false },
  ],
}

describe('all_of', () => {
  it('passes only when every sub-rule passes', async () => {
    const r = await evaluateRule(numberAndChoice, { sensitivity: 37, explanation: 'option_c' }, ctx())
    expect(r.correct).toBe(true)
    expect(r.outcomes).toHaveLength(2)
  })

  it('fails when the number is right but the explanation is wrong', async () => {
    const r = await evaluateRule(numberAndChoice, { sensitivity: 37, explanation: 'small_sample' }, ctx())
    expect(r.correct).toBe(false)
    expect(r.outcomes[0]?.passed).toBe(true)
    expect(r.outcomes[1]?.passed).toBe(false)
  })

  it('reports each sub-rule so the learner knows which half to redo', async () => {
    const r = await evaluateRule(numberAndChoice, { sensitivity: 95, explanation: 'option_c' }, ctx())
    expect(r.outcomes.map((o) => o.passed)).toEqual([false, true])
  })
})

describe('any_n_of', () => {
  // Pass on at least 2 of 3 goals.
  const rule: Rule = {
    type: 'any_n_of',
    n: 2,
    rules: [
      { type: 'exact', field: 'g1', expected: 'yes', case_sensitive: false },
      { type: 'exact', field: 'g2', expected: 'yes', case_sensitive: false },
      { type: 'exact', field: 'g3', expected: 'yes', case_sensitive: false },
    ],
  }

  it('passes at exactly n', async () => {
    const r = await evaluateRule(rule, { g1: 'yes', g2: 'yes', g3: 'no' }, ctx())
    expect(r.correct).toBe(true)
  })

  it('fails below n', async () => {
    const r = await evaluateRule(rule, { g1: 'yes', g2: 'no', g3: 'no' }, ctx())
    expect(r.correct).toBe(false)
  })

  it('passes above n', async () => {
    const r = await evaluateRule(rule, { g1: 'yes', g2: 'yes', g3: 'yes' }, ctx())
    expect(r.correct).toBe(true)
  })

  it('still reports every goal so the UI can tick them off', async () => {
    const r = await evaluateRule(rule, { g1: 'yes', g2: 'no', g3: 'yes' }, ctx())
    expect(r.outcomes.map((o) => o.passed)).toEqual([true, false, true])
  })
})

describe('evaluateRule dispatch', () => {
  it('handles a bare leaf rule', async () => {
    const r = await evaluateRule({ type: 'exact', field: 'a', expected: 'b', case_sensitive: false } as Rule, { a: 'b' }, ctx())
    expect(r.correct).toBe(true)
  })

  it('fails closed on an unknown rule type rather than passing the learner', async () => {
    const r = await evaluateRule({ type: 'not_a_real_rule' } as unknown as Rule, {}, ctx())
    expect(r.correct).toBe(false)
  })
})
