import { describe, it, expect } from 'vitest'
import { calculatePoints, maxAchievablePoints, isUnlocked } from '../src/scoring'

const base = { basePoints: 100, hintCosts: [10, 20, 40], validatorPenalty: 0 }

describe('calculatePoints', () => {
  it('awards full points with no hints and no penalty', () => {
    expect(calculatePoints({ ...base, hintIndicesUsed: [] })).toBe(100)
  })

  it('deducts the cost of each hint used', () => {
    expect(calculatePoints({ ...base, hintIndicesUsed: [0] })).toBe(90)
    expect(calculatePoints({ ...base, hintIndicesUsed: [0, 1] })).toBe(70)
    expect(calculatePoints({ ...base, hintIndicesUsed: [0, 1, 2] })).toBe(30)
  })

  it('still awards points to a learner who used every hint', () => {
    expect(calculatePoints({ ...base, hintIndicesUsed: [0, 1, 2] })).toBeGreaterThan(0)
  })

  it('applies a validator penalty on top of hint costs', () => {
    expect(calculatePoints({ ...base, hintIndicesUsed: [0], validatorPenalty: 20 })).toBe(70)
  })

  it('never goes below zero', () => {
    expect(calculatePoints({ ...base, hintIndicesUsed: [0, 1, 2], validatorPenalty: 500 })).toBe(0)
  })

  it('deducts a penalty per wrong attempt before capture', () => {
    expect(calculatePoints({ ...base, hintIndicesUsed: [], wrongAttempts: 2, wrongAttemptPenalty: 10 })).toBe(80)
  })

  it('combines hints and wrong attempts, floored at zero', () => {
    expect(calculatePoints({ ...base, hintIndicesUsed: [0, 1], wrongAttempts: 3, wrongAttemptPenalty: 10 })).toBe(40)
    expect(calculatePoints({ ...base, hintIndicesUsed: [0, 1, 2], wrongAttempts: 9, wrongAttemptPenalty: 10 })).toBe(0)
  })

  it('awards nothing after "show me the answer"', () => {
    expect(calculatePoints({ ...base, hintIndicesUsed: [], revealed: true })).toBe(0)
  })

  it('ignores negative penalty inputs rather than adding points', () => {
    expect(calculatePoints({ ...base, hintIndicesUsed: [], wrongAttempts: -3, wrongAttemptPenalty: 10 })).toBe(100)
    expect(calculatePoints({ ...base, hintIndicesUsed: [], wrongAttempts: 3, wrongAttemptPenalty: -10 })).toBe(100)
  })

  it('ignores a hint index that does not exist', () => {
    expect(calculatePoints({ ...base, hintIndicesUsed: [7] })).toBe(100)
  })

  it('ignores a negative penalty rather than awarding bonus points', () => {
    expect(calculatePoints({ ...base, hintIndicesUsed: [], validatorPenalty: -50 })).toBe(100)
  })
})

describe('maxAchievablePoints', () => {
  it('shows what is still on the table after hints are bought', () => {
    expect(maxAchievablePoints(100, [10, 20, 40], [0, 1])).toBe(70)
  })
})

describe('isUnlocked', () => {
  it('opens a challenge with no prerequisites', () => {
    expect(isUnlocked([], [])).toBe(true)
  })

  it('keeps A4 locked until A1 is captured', () => {
    expect(isUnlocked(['A1'], [])).toBe(false)
    expect(isUnlocked(['A1'], ['B5', 'B7'])).toBe(false)
    expect(isUnlocked(['A1'], ['A1'])).toBe(true)
  })

  it('requires every prerequisite, not just one', () => {
    expect(isUnlocked(['A1', 'B5'], ['A1'])).toBe(false)
    expect(isUnlocked(['A1', 'B5'], ['A1', 'B5'])).toBe(true)
  })
})
