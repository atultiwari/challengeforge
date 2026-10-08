import { describe, it, expect } from 'vitest'
import { combineCriteria, ruleCriterion, pointsFor, type Criterion } from '../src/assessment'
import type { Rule } from '../src/rules/schema'

const c = (over: Partial<Criterion> & Pick<Criterion, 'id'>): Criterion => ({
  label: over.id,
  score: 0,
  max: 10,
  passed: false,
  feedback: '',
  ...over,
})

describe('combineCriteria', () => {
  it('sums scores and maxima and passes at the pass fraction', () => {
    const a = combineCriteria([c({ id: 'a', score: 6, passed: true }), c({ id: 'b', score: 1 })], { passFraction: 0.35 })
    expect(a).toMatchObject({ score: 7, max: 20, passed: true, status: 'auto', criticalFailure: false })
  })

  it('fails below the pass fraction', () => {
    const a = combineCriteria([c({ id: 'a', score: 6 }), c({ id: 'b', score: 1 })], { passFraction: 0.5 })
    expect(a.passed).toBe(false)
  })

  it('fails the attempt on a missed critical criterion, but keeps the earned score visible', () => {
    const a = combineCriteria(
      [c({ id: 'a', score: 10, passed: true }), c({ id: 'harm', score: 0, max: 0, critical: true })],
      { passFraction: 0.5 },
    )
    expect(a).toMatchObject({ passed: false, criticalFailure: true, score: 10 })
  })

  it('can cap the score instead of failing outright', () => {
    const a = combineCriteria(
      [c({ id: 'a', score: 10, passed: true }), c({ id: 'b', score: 10, passed: true }), c({ id: 'harm', max: 0, critical: true })],
      { passFraction: 0.2, critical: { mode: 'cap', capFraction: 0.25 } },
    )
    expect(a).toMatchObject({ score: 5, max: 20, passed: true, criticalFailure: true })
  })

  it('a passed critical criterion is not a failure', () => {
    const a = combineCriteria([c({ id: 'harm', max: 0, critical: true, passed: true })], { passFraction: 0 })
    expect(a.criticalFailure).toBe(false)
  })

  it('marks the assessment for human review when asked', () => {
    const a = combineCriteria([c({ id: 'a', score: 10, passed: true })], { passFraction: 0.5, needsReview: true })
    expect(a.status).toBe('pending_review')
  })

  it('treats an empty rubric as not passed rather than dividing by zero', () => {
    expect(combineCriteria([], { passFraction: 0.5 })).toMatchObject({ score: 0, max: 0, passed: false })
  })

  it('returns new arrays rather than the caller-owned input', () => {
    const input = [c({ id: 'a', score: 10, passed: true })]
    expect(combineCriteria(input, { passFraction: 0.5 }).criteria).not.toBe(input)
  })
})

describe('ruleCriterion', () => {
  const rule: Rule = {
    type: 'all_of',
    rules: [
      { type: 'exact', field: 'a', expected: 'x', case_sensitive: false },
      { type: 'exact', field: 'b', expected: 'y', case_sensitive: false },
    ],
  }
  const ctx = { challengeId: 'c', userId: 'u' }

  it('awards full weight when the rule passes', async () => {
    const cr = await ruleCriterion({ id: 'final', label: 'Answer', weight: 20 }, rule, { a: 'x', b: 'y' }, ctx)
    expect(cr).toMatchObject({ score: 20, max: 20, passed: true })
  })

  it('awards partial credit in proportion to the parts that passed', async () => {
    const cr = await ruleCriterion({ id: 'final', label: 'Answer', weight: 20 }, rule, { a: 'x', b: 'no' }, ctx)
    expect(cr).toMatchObject({ score: 10, passed: false })
  })

  it('can be all-or-nothing', async () => {
    const cr = await ruleCriterion({ id: 'final', label: 'Answer', weight: 20, partialCredit: false }, rule, { a: 'x' }, ctx)
    expect(cr.score).toBe(0)
  })

  it('joins the learner-safe messages as feedback', async () => {
    const cr = await ruleCriterion({ id: 'final', label: 'Answer', weight: 20 }, rule, { a: 'x', b: 'no' }, ctx)
    expect(cr.feedback).toContain('Correct.')
    expect(cr.feedback).not.toContain('y')
  })
})

describe('pointsFor', () => {
  const full = combineCriteria([c({ id: 'a', score: 10, passed: true })], { passFraction: 0.5 })
  const half = combineCriteria([c({ id: 'a', score: 5, passed: true })], { passFraction: 0.5 })

  it('scales base points by the assessment fraction and applies the harvested deductions', () => {
    expect(pointsFor(full, { basePoints: 100, hintCosts: [10, 20], hintIndicesUsed: [1] })).toBe(80)
    expect(pointsFor(half, { basePoints: 100, hintCosts: [], hintIndicesUsed: [] })).toBe(50)
    expect(pointsFor(full, { basePoints: 100, hintCosts: [], hintIndicesUsed: [], wrongAttempts: 2, wrongAttemptPenalty: 10 })).toBe(80)
  })

  it('awards nothing for a failed or revealed attempt', () => {
    const failed = combineCriteria([c({ id: 'a', score: 3 })], { passFraction: 0.5 })
    expect(pointsFor(failed, { basePoints: 100, hintCosts: [], hintIndicesUsed: [] })).toBe(0)
    expect(pointsFor(full, { basePoints: 100, hintCosts: [], hintIndicesUsed: [], revealed: true })).toBe(0)
  })
})
