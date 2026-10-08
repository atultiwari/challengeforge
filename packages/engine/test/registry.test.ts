import { describe, it, expect } from 'vitest'
import { z } from 'zod'
import { createTypeRegistry } from '../src/registry'
import type { AnyChallengeType } from '../src/contract'

const fake = (id: string, version: number): AnyChallengeType => ({
  id,
  version,
  paradigm: 'static',
  definitionSchema: z.object({ answer: z.string().min(1) }),
  actionSchema: z.unknown(),
  lint: () => [],
  init: () => ({}),
  step: async (_d, s) => ({ ok: true, state: s }),
  view: () => ({}),
  isTerminal: () => false,
  evaluate: async () => ({ criteria: [], score: 0, max: 0, passed: false, criticalFailure: false, status: 'auto' }),
})

describe('createTypeRegistry', () => {
  const registry = createTypeRegistry([fake('flag', 1), fake('flag', 2), fake('quiz', 1)])

  it('finds a type by id and version', () => {
    expect(registry.get('flag', 2)?.version).toBe(2)
    expect(registry.get('flag', 3)).toBeUndefined()
    expect(registry.get('nope', 1)).toBeUndefined()
  })

  it('lists every registered type', () => {
    expect(registry.list().map((t) => `${t.id}@${t.version}`)).toEqual(['flag@1', 'flag@2', 'quiz@1'])
  })

  it('refuses two types with the same id and version', () => {
    expect(() => createTypeRegistry([fake('flag', 1), fake('flag', 1)])).toThrow(/flag@1/)
  })

  it('parses a definition with the right type, returning author-facing issues on failure', () => {
    expect(registry.parseDefinition('quiz', 1, { answer: 'x' })).toEqual({ ok: true, definition: { answer: 'x' }, warnings: [] })
    const bad = registry.parseDefinition('quiz', 1, { answer: '' })
    expect(bad.ok).toBe(false)
    if (bad.ok) throw new Error('expected failure')
    expect(bad.issues[0]?.path).toBe('answer')
  })

  it('runs the type lint after the schema, so cross-field errors block publishing', () => {
    const strict = createTypeRegistry([{ ...fake('quiz', 1), lint: () => [{ path: 'answer', severity: 'error', message: 'Too easy.' }] }])
    expect(strict.parseDefinition('quiz', 1, { answer: 'x' })).toMatchObject({ ok: false, issues: [{ message: 'Too easy.' }] })
    const warnOnly = createTypeRegistry([{ ...fake('quiz', 1), lint: () => [{ path: 'answer', severity: 'warning', message: 'Hmm.' }] }])
    expect(warnOnly.parseDefinition('quiz', 1, { answer: 'x' })).toMatchObject({ ok: true, warnings: [{ message: 'Hmm.' }] })
  })

  it('reports an unknown type instead of throwing', () => {
    expect(registry.parseDefinition('ghost', 1, {})).toMatchObject({ ok: false, issues: [{ path: '', severity: 'error' }] })
  })
})
