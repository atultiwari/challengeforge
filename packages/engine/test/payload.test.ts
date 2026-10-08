import { describe, it, expect } from 'vitest'
import { parseLearnerNumber, readField } from '../src/payload'

describe('parseLearnerNumber', () => {
  it('accepts plain decimals with an optional sign, trailing percent and spaces', () => {
    expect(parseLearnerNumber(' 12.5 % ')).toBe(12.5)
    expect(parseLearnerNumber('-3')).toBe(-3)
    expect(parseLearnerNumber('.5')).toBe(0.5)
    expect(parseLearnerNumber(7)).toBe(7)
  })

  it('rejects notations a learner would not mean: hex, exponents, stray percent signs', () => {
    for (const bad of ['0x10', '1e3', '1%2%', '%12', '12 34', 'Infinity', '']) expect(parseLearnerNumber(bad)).toBeNull()
  })
})

describe('readField', () => {
  it('reads own properties only, never the prototype chain', () => {
    expect(readField({}, 'constructor')).toBeUndefined()
    expect(readField({ a: { b: 1 } }, 'a.b')).toBe(1)
  })
})
