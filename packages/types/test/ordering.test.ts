import { describe, expect, it } from 'vitest'
import { act, assess, replay, startAttempt, type AttemptEvent } from '@challengeforge/engine'
import { ordering, shuffledIds, stepsInPlace, type OrderingDef, type OrderingView } from '../src/ordering'
import { registry, starterDefinition } from '../src'

// Synthetic content.
const def: OrderingDef = ordering.definitionSchema.parse({
  title: 'Hand hygiene and gloves (synthetic)',
  steps: [
    { id: 'wash', text: 'Clean your hands', explanation: 'Always first.' },
    { id: 'gloves', text: 'Put on gloves' },
    { id: 'clean', text: 'Clean the site' },
    { id: 'dress', text: 'Apply the dressing' },
    { id: 'dispose', text: 'Dispose of waste' },
  ],
  critical_pairs: [{ before: 'wash', after: 'gloves', message: 'Clean your hands before gloving.' }],
})
const ctx = { attemptId: 'a1', userId: 'u1', challengeId: 'c1', seed: 11 }
const env = { services: {}, at: '2026-10-08T10:00:00.000Z' }

async function submit(order: string[]) {
  const { attempt } = startAttempt(ordering, def, ctx)
  const r = await act(ordering, def, attempt, { kind: 'submit', order }, env)
  if (!r.ok) throw new Error(r.error.message)
  return { attempt: r.attempt, view: r.view as OrderingView, event: r.event as AttemptEvent }
}

describe('ordering (the type SDK worked example)', () => {
  it('shuffles per attempt, deterministically, and never starts from the answer', () => {
    const ids = def.steps.map((s) => s.id)
    expect(shuffledIds(ids, 11)).toEqual(shuffledIds(ids, 11))
    for (let seed = 0; seed < 200; seed += 1) expect(shuffledIds(ids, seed)).not.toEqual(ids)
    expect([...shuffledIds(ids, 3)].sort()).toEqual([...ids].sort())
    const { view } = startAttempt(ordering, def, ctx)
    expect(JSON.stringify(view)).not.toContain('Always first.')
  })

  it('the right order passes with full marks', async () => {
    const { attempt } = await submit(['wash', 'gloves', 'clean', 'dress', 'dispose'])
    const a = await assess(ordering, def, attempt, [], {})
    expect(a).toMatchObject({ passed: true, score: 5, max: 5, criticalFailure: false })
  })

  it('one displaced step costs only the steps around it', async () => {
    const order = ['wash', 'gloves', 'dress', 'clean', 'dispose']
    expect([...stepsInPlace(def, order).values()].filter(Boolean)).toHaveLength(2)
    const { attempt, view } = await submit(order)
    expect(view.results!.yourOrder.map((s) => s.correct)).toEqual([true, true, false, false, false])
    expect((await assess(ordering, def, attempt, [], {})).passed).toBe(false)
  })

  it('reversing a critical pair fails, whatever else is right', async () => {
    const { attempt, view } = await submit(['gloves', 'wash', 'clean', 'dress', 'dispose'])
    expect(view.results!.brokenRules).toEqual(['Clean your hands before gloving.'])
    expect(await assess(ordering, def, attempt, [], {})).toMatchObject({ passed: false, criticalFailure: true })
  })

  it('refuses an order that is not exactly the steps, and replays from the event log', async () => {
    const { attempt } = startAttempt(ordering, def, ctx)
    expect(await act(ordering, def, attempt, { kind: 'submit', order: ['wash', 'wash', 'clean', 'dress', 'dispose'] }, env)).toMatchObject({ ok: false })
    const { attempt: done, event } = await submit(['wash', 'gloves', 'clean', 'dress', 'dispose'])
    expect(await replay(ordering, def, ctx, [event], {})).toMatchObject({ ok: true, attempt: { state: done.state } })
  })

  it('lints contradictions and unknown steps; is registered and form-authorable', () => {
    const bad = ordering.definitionSchema.parse({ ...def, critical_pairs: [{ before: 'dispose', after: 'wash' }, { before: 'x', after: 'wash' }] })
    expect(ordering.lint(bad).map((i) => i.message)).toEqual(['This pair contradicts the order of the steps.', 'Both steps of a critical pair must be in the list.'])
    expect(ordering.lint(def)).toEqual([])
    expect(registry.get('ordering', 1)).toBe(ordering)
    expect(ordering.definitionSchema.safeParse(starterDefinition('ordering')).success).toBe(true)
  })
})
