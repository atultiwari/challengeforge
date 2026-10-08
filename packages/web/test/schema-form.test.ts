import { describe, expect, it } from 'vitest'
import { defaultFor, humanize, isMap, renameKey, issuesAt, moveItem, nextItemId, removeAt, setAt, summaryOf, variantIndex, type JsonSchema } from '../src/lib/schema-form/model'

const catalogItem: JsonSchema = {
  type: 'object',
  properties: {
    id: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,63}$' },
    label: { type: 'string', minLength: 1 },
    keywords: { type: 'array', items: { type: 'string' }, default: [] },
    tag: { type: 'string', enum: ['essential', 'useful', 'neutral'] },
    cost: { type: 'number', default: 0 },
    note: { type: 'string' },
  },
  required: ['id', 'label', 'tag'],
}

describe('humanize', () => {
  it('turns schema keys into labels a clinician reads', () => {
    expect(humanize('chief_complaint')).toBe('Chief complaint')
    expect(humanize('min_history')).toBe('Min history')
  })
})

describe('defaultFor', () => {
  it('builds a valid-shaped new value: required fields, declared defaults, first enum value', () => {
    expect(defaultFor(catalogItem)).toEqual({ id: '', label: '', keywords: [], tag: 'essential', cost: 0 })
  })

  it('handles consts, nullable values, minimum array sizes and discriminated unions', () => {
    expect(defaultFor({ type: 'string', const: 'single' })).toBe('single')
    expect(defaultFor({ anyOf: [{ type: 'integer', minimum: 1 }, { type: 'null' }] })).toBeNull()
    expect(defaultFor({ type: 'array', minItems: 2, items: { type: 'string' } })).toEqual(['', ''])
    const union: JsonSchema = { oneOf: [{ type: 'object', properties: { mode: { type: 'string', const: 'fail' } }, required: ['mode'] }] }
    expect(defaultFor(union)).toEqual({ mode: 'fail' })
  })

  it('uses the minimum for numbers', () => {
    expect(defaultFor({ type: 'integer', minimum: 1 })).toBe(1)
  })
})

describe('immutable path updates', () => {
  const doc = { a: { list: [{ x: 1 }, { x: 2 }] } }

  it('setAt returns a new document and leaves the old one alone', () => {
    const next = setAt(doc, ['a', 'list', 1, 'x'], 9)
    expect(next).toEqual({ a: { list: [{ x: 1 }, { x: 9 }] } })
    expect(doc.a.list[1]?.x).toBe(2)
  })

  it('setAt with undefined removes an optional key', () => {
    expect(setAt({ a: 1, b: 2 }, ['b'], undefined)).toEqual({ a: 1 })
  })

  it('removeAt and moveItem work on arrays without mutating', () => {
    const list = [1, 2, 3]
    expect(removeAt(list, 0)).toEqual([2, 3])
    expect(moveItem(list, 0, 1)).toEqual([2, 1, 3])
    expect(moveItem(list, 0, -1)).toEqual([1, 2, 3])
    expect(list).toEqual([1, 2, 3])
  })
})

describe('helpers for array cards', () => {
  it('gives new catalog items an unused id', () => {
    expect(nextItemId('history', [{ id: 'history_1' }, { id: 'history_3' }])).toBe('history_4')
    expect(nextItemId('investigations', [])).toBe('investigation_1')
  })

  it('summarises an item by its most human field', () => {
    expect(summaryOf({ id: 'h1', label: 'When did it start?' })).toBe('When did it start?')
    expect(summaryOf({ id: 'q1', prompt: 'Which test?' })).toBe('Which test?')
    expect(summaryOf({ id: 'x' })).toBe('x')
    expect(summaryOf('plain')).toBe('plain')
  })

  it('finds which variant of a union a value is', () => {
    const union: JsonSchema = {
      oneOf: [
        { type: 'object', properties: { mode: { const: 'fail' } } },
        { type: 'object', properties: { mode: { const: 'cap' }, cap_fraction: { type: 'number' } } },
      ],
    }
    expect(variantIndex(union, { mode: 'cap', cap_fraction: 0.5 })).toBe(1)
    expect(variantIndex(union, { mode: 'unknown' })).toBe(0)
  })

  it('collects the lint issues for one path', () => {
    const issues = [
      { path: 'history.2.label', severity: 'error', message: 'Too short' },
      { path: 'history.2', severity: 'warning', message: 'Odd' },
      { path: 'title', severity: 'error', message: 'x' },
    ]
    expect(issuesAt(issues, ['history', 2, 'label']).map((i) => i.message)).toEqual(['Too short'])
  })
})

describe('maps (e.g. vitals)', () => {
  it('recognises a free-form map and renames keys in place', () => {
    expect(isMap({ type: 'object', additionalProperties: { type: 'string' } })).toBe(true)
    expect(isMap({ type: 'object', properties: {} })).toBe(false)
    expect(Object.keys(renameKey({ a: 1, b: 2, c: 3 }, 'b', 'B'))).toEqual(['a', 'B', 'c'])
  })
})
