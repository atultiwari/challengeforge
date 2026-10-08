import { describe, it, expect } from 'vitest'
import { validateNumericRange } from '../../src/rules/numeric-range'
import { ctx } from './helpers'
import type { NumericRangeRule } from '../../src/rules/schema'

// Synthetic: the expected value is 37, accepted within +/- 2.
const rule: NumericRangeRule = { type: 'numeric_range', field: 'sensitivity', expected: 37, tolerance: 2, unit: '%', common_mistakes: [] }

describe('numeric_range validator', () => {
  it('passes on the exact value', async () => {
    expect((await validateNumericRange(rule, { sensitivity: 37 }, ctx())).passed).toBe(true)
  })

  it('passes at both inclusive boundaries', async () => {
    expect((await validateNumericRange(rule, { sensitivity: 35 }, ctx())).passed).toBe(true)
    expect((await validateNumericRange(rule, { sensitivity: 39 }, ctx())).passed).toBe(true)
  })

  it('fails just outside either boundary', async () => {
    expect((await validateNumericRange(rule, { sensitivity: 34.99 }, ctx())).passed).toBe(false)
    expect((await validateNumericRange(rule, { sensitivity: 39.01 }, ctx())).passed).toBe(false)
  })

  it('accepts a numeric string, since the input is a text box', async () => {
    expect((await validateNumericRange(rule, { sensitivity: '37.5' }, ctx())).passed).toBe(true)
  })

  it('tolerates a trailing percent sign or spaces', async () => {
    expect((await validateNumericRange(rule, { sensitivity: ' 37 % ' }, ctx())).passed).toBe(true)
  })

  it('fails safely on non-numeric input', async () => {
    for (const bad of ['', 'twelve', null, undefined, NaN, {}, []]) {
      expect((await validateNumericRange(rule, { sensitivity: bad }, ctx())).passed).toBe(false)
    }
  })

  it('rejects Infinity rather than treating it as a number', async () => {
    expect((await validateNumericRange(rule, { sensitivity: Infinity }, ctx())).passed).toBe(false)
  })

  it('never reveals the expected value in the message', async () => {
    const r = await validateNumericRange(rule, { sensitivity: 95 }, ctx())
    expect(r.message).not.toContain('37')
  })

  describe('common mistakes', () => {
    const withMistakes: NumericRangeRule = {
      ...rule,
      common_mistakes: [
        { value: 50, tolerance: 1, message: 'That is the PPV, not the sensitivity.' },
        { value: 95, tolerance: 0.5, message: 'That is the overall accuracy.' },
      ],
    }

    it('names the specific mistake for a recognisable wrong answer', async () => {
      const r = await validateNumericRange(withMistakes, { sensitivity: '50' }, ctx())
      expect(r.passed).toBe(false)
      expect(r.message).toContain('PPV')
    })

    it('uses each mistake tolerance', async () => {
      expect((await validateNumericRange(withMistakes, { sensitivity: 95.4 }, ctx())).message).toContain('accuracy')
      expect((await validateNumericRange(withMistakes, { sensitivity: 96 }, ctx())).message).not.toContain('accuracy')
    })

    it('falls back to the generic message for other wrong answers', async () => {
      const r = await validateNumericRange(withMistakes, { sensitivity: 30 }, ctx())
      expect(r.message).toContain('not close enough')
    })

    it('still passes the right answer even if a mistake range overlaps it', async () => {
      const overlapping: NumericRangeRule = {
        ...rule,
        common_mistakes: [{ value: 37, tolerance: 5, message: 'never shown' }],
      }
      expect((await validateNumericRange(overlapping, { sensitivity: 37 }, ctx())).passed).toBe(true)
    })
  })
})
