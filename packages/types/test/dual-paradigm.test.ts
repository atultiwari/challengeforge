/**
 * The Phase 0 exit criterion (PLAN.md §8): ONE runner, ONE registry, two
 * paradigms. A static Lab-style mission and an interactive diagnostic case
 * are both authored as plain data, played through the same functions, and
 * assessed into the same Assessment shape.
 */
import { describe, it, expect } from 'vitest'
import { startAttempt, act, assess, type AttemptEvent } from '@challengeforge/engine'
import { builtInTypes, registry } from '../src'
import labJson from '../fixtures/lab-legacy/synthetic-metrics-mission.json'
import dkaJson from '../fixtures/diagnostic-sim/dka-young-adult.json'

async function run(typeId: string, raw: unknown, actions: unknown[]) {
  const type = registry.get(typeId, 1)
  if (!type) throw new Error(`no type ${typeId}`)
  const parsed = registry.parseDefinition(typeId, 1, raw)
  if (!parsed.ok) throw new Error(JSON.stringify(parsed.issues))
  const def = parsed.definition
  let { attempt } = startAttempt(type, def, { attemptId: 'a', userId: 'u', challengeId: typeId, seed: 1 })
  const events: AttemptEvent[] = []
  for (const action of actions) {
    const r = await act(type, def, attempt, action, { services: {}, at: '2026-10-08T12:00:00.000Z' })
    if (!r.ok) throw new Error(r.error.message)
    attempt = r.attempt
    events.push(r.event)
  }
  return assess(type, def, attempt, events, {})
}

describe('one contract, both paradigms', () => {
  it('registers both built-in types with their paradigms', () => {
    expect(builtInTypes.map((t) => `${t.id}@${t.version}:${t.paradigm}`)).toEqual([
      'lab-legacy@1:static',
      'diagnostic-sim@1:interactive',
      'question-set@1:static',
      'chat-mission@1:interactive',
      'prompt-hardening@1:interactive',
    ])
  })

  it('static: one submission, assessed', async () => {
    const a = await run('lab-legacy', labJson, [{ kind: 'submit', payload: { sensitivity: 41, explanation: 'opt_b' } }])
    expect(a).toMatchObject({ passed: true, status: 'auto' })
  })

  it('interactive: a sequence of actions, the trajectory assessed', async () => {
    const a = await run('diagnostic-sim', dkaJson, [
      { kind: 'search', category: 'history', query: 'insulin' },
      { kind: 'ask', item: 'h_insulin' },
      { kind: 'submit_diagnosis', text: 'diabetic ketoacidosis' },
    ])
    expect(a.criteria.length).toBeGreaterThan(5)
    expect(a.passed).toBe(false)
  })
})
