import { describe, it, expect } from 'vitest'
import { validateExact } from '../../src/rules/exact'
import { ctx } from './helpers'
import type { ExactRule } from '../../src/rules/schema'

const rule: ExactRule = { type: 'exact', field: 'explanation', expected: 'option_c', case_sensitive: false }

describe('exact validator', () => {
  it('passes on an exact match', async () => {
    const r = await validateExact(rule, { explanation: 'option_c' }, ctx())
    expect(r.passed).toBe(true)
  })

  it('is case-insensitive by default', async () => {
    const r = await validateExact(rule, { explanation: 'OPTION_C' }, ctx())
    expect(r.passed).toBe(true)
  })

  it('respects case_sensitive when set', async () => {
    const strict = { ...rule, case_sensitive: true }
    expect((await validateExact(strict, { explanation: 'OPTION_C' }, ctx())).passed).toBe(false)
    expect((await validateExact(strict, { explanation: 'option_c' }, ctx())).passed).toBe(true)
  })

  it('trims surrounding whitespace', async () => {
    const r = await validateExact(rule, { explanation: '  option_c \n' }, ctx())
    expect(r.passed).toBe(true)
  })

  it('fails on a wrong answer', async () => {
    const r = await validateExact(rule, { explanation: 'small_sample' }, ctx())
    expect(r.passed).toBe(false)
  })

  it('fails safely on a missing or non-string field', async () => {
    expect((await validateExact(rule, {}, ctx())).passed).toBe(false)
    expect((await validateExact(rule, { explanation: 42 }, ctx())).passed).toBe(false)
    expect((await validateExact(rule, null, ctx())).passed).toBe(false)
  })

  it('never puts the expected answer in the learner-facing message', async () => {
    const r = await validateExact(rule, { explanation: 'wrong' }, ctx())
    expect(r.message.toLowerCase()).not.toContain('option_c')
  })
})
