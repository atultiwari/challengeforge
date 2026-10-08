import { describe, it, expect } from 'vitest'
import { validateSetMatch } from '../../src/rules/set-match'
import { ctx } from './helpers'
import type { SetMatchRule } from '../../src/rules/schema'

// 5 planted errors, pass on >=4 found with <=2 false flags.
const rule: SetMatchRule = {
  type: 'set_match',
  field: 'flags',
  expected_ids: ['e1', 'e2', 'e3', 'e4', 'e5'],
  min_hits: 4,
  max_false_positives: 2,
  require_category: true,
  categories: { e1: 'contraindication', e2: 'omission', e3: 'hallucination', e4: 'laterality', e5: 'dose_error' },
  also_accept: {},
  aliases: {},
}

const flag = (id: string, category: string) => ({ id, category })

describe('set_match validator', () => {
  it('passes with exactly min_hits correct and no false flags', async () => {
    const payload = { flags: [flag('e1', 'contraindication'), flag('e2', 'omission'), flag('e3', 'hallucination'), flag('e4', 'laterality')] }
    const r = await validateSetMatch(rule, payload, ctx())
    expect(r.passed).toBe(true)
    expect(r.detail?.found).toBe(4)
  })

  it('fails below min_hits', async () => {
    const payload = { flags: [flag('e1', 'contraindication'), flag('e2', 'omission'), flag('e3', 'hallucination')] }
    expect((await validateSetMatch(rule, payload, ctx())).passed).toBe(false)
  })

  it('fails when false flags exceed the allowance even if all real errors are found', async () => {
    const payload = {
      flags: [
        flag('e1', 'contraindication'), flag('e2', 'omission'), flag('e3', 'hallucination'),
        flag('e4', 'laterality'), flag('e5', 'dose_error'),
        flag('x1', 'omission'), flag('x2', 'omission'), flag('x3', 'omission'),
      ],
    }
    const r = await validateSetMatch(rule, payload, ctx())
    expect(r.passed).toBe(false)
    expect(r.detail?.falsePositives).toBe(3)
  })

  it('passes at exactly max_false_positives', async () => {
    const payload = {
      flags: [flag('e1', 'contraindication'), flag('e2', 'omission'), flag('e3', 'hallucination'), flag('e4', 'laterality'), flag('x1', 'omission'), flag('x2', 'omission')],
    }
    expect((await validateSetMatch(rule, payload, ctx())).passed).toBe(true)
  })

  it('does not count a correct sentence tagged with the wrong category', async () => {
    const payload = {
      flags: [flag('e1', 'dose_error'), flag('e2', 'omission'), flag('e3', 'hallucination'), flag('e4', 'laterality')],
    }
    const r = await validateSetMatch(rule, payload, ctx())
    expect(r.detail?.found).toBe(3)
    expect(r.passed).toBe(false)
  })

  it('counts a miscategorised real error as a miss, not a false flag', async () => {
    const payload = { flags: [flag('e1', 'dose_error')] }
    const r = await validateSetMatch(rule, payload, ctx())
    expect(r.detail?.falsePositives).toBe(0)
  })

  it('ignores category when require_category is false', async () => {
    const loose = { ...rule, require_category: false }
    const payload = { flags: [flag('e1', 'nonsense'), flag('e2', 'nonsense'), flag('e3', 'nonsense'), flag('e4', 'nonsense')] }
    expect((await validateSetMatch(loose, payload, ctx())).passed).toBe(true)
  })

  it('deduplicates repeated flags on the same sentence', async () => {
    const payload = {
      flags: [flag('e1', 'contraindication'), flag('e1', 'contraindication'), flag('e2', 'omission'), flag('e3', 'hallucination'), flag('e4', 'laterality')],
    }
    const r = await validateSetMatch(rule, payload, ctx())
    expect(r.detail?.found).toBe(4)
    expect(r.passed).toBe(true)
  })

  it('fails safely on a malformed payload', async () => {
    for (const bad of [{}, { flags: 'e1' }, { flags: [1, 2] }, null]) {
      expect((await validateSetMatch(rule, bad, ctx())).passed).toBe(false)
    }
  })

  it('never lists the expected ids in the message', async () => {
    const r = await validateSetMatch(rule, { flags: [] }, ctx())
    for (const id of rule.expected_ids) expect(r.message).not.toContain(id)
  })

  describe('aliases (either copy of a duplicate)', () => {
    const withAliases: SetMatchRule = {
      type: 'set_match', field: 'flags', expected_ids: ['R-10', 'R-20'], min_hits: 2, max_false_positives: 0,
      require_category: false, categories: {}, also_accept: {}, aliases: { 'R-11': 'R-10' },
    }

    it('counts the alias as the planted item', async () => {
      const r = await validateSetMatch(withAliases, { flags: [{ id: 'R-11' }, { id: 'R-20' }] }, ctx())
      expect(r.passed).toBe(true)
    })

    it('counts both copies once, not as a hit plus a false flag', async () => {
      const r = await validateSetMatch(withAliases, { flags: [{ id: 'R-10' }, { id: 'R-11' }, { id: 'R-20' }] }, ctx())
      expect(r.passed).toBe(true)
      expect(r.detail).toMatchObject({ found: 2, falsePositives: 0 })
    })
  })

  describe('plain ids from a "choose all that apply" question', () => {
    const multi: SetMatchRule = {
      type: 'set_match', field: 'answers.q3', expected_ids: ['a', 'c'], min_hits: 2, max_false_positives: 0,
      require_category: false, categories: {}, also_accept: {}, aliases: {},
    }

    it('accepts an array of option ids', async () => {
      expect((await validateSetMatch(multi, { answers: { q3: ['a', 'c'] } }, ctx())).passed).toBe(true)
    })

    it('counts an extra wrong option as a false positive', async () => {
      const r = await validateSetMatch(multi, { answers: { q3: ['a', 'b', 'c'] } }, ctx())
      expect(r.passed).toBe(false)
      expect(r.detail?.falsePositives).toBe(1)
    })

    it('rejects a malformed array rather than guessing', async () => {
      expect((await validateSetMatch(multi, { answers: { q3: ['a', 42] } }, ctx())).passed).toBe(false)
    })
  })

  describe('also_accept (two defensible categories)', () => {
    const both: SetMatchRule = {
      type: 'set_match', field: 'flags', expected_ids: ['R-12'], min_hits: 1, max_false_positives: 0,
      require_category: true, categories: { 'R-12': 'units' }, also_accept: { 'R-12': ['impossible'] }, aliases: {},
    }

    it('counts either category', async () => {
      expect((await validateSetMatch(both, { flags: [flag('R-12', 'units')] }, ctx())).passed).toBe(true)
      expect((await validateSetMatch(both, { flags: [flag('R-12', 'impossible')] }, ctx())).passed).toBe(true)
    })

    it('still rejects a category nobody accepted', async () => {
      expect((await validateSetMatch(both, { flags: [flag('R-12', 'duplicate')] }, ctx())).passed).toBe(false)
    })
  })

  it('does not treat prototype names as aliases or categories', async () => {
    const r = await validateSetMatch({ ...rule, require_category: true }, { flags: [{ id: 'constructor', category: 'x' }, 'toString'] }, ctx())
    expect(r.passed).toBe(false)
    expect(r.detail?.falsePositives).toBe(2)
  })
})
