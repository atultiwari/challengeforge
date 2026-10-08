import { describe, it, expect, vi } from 'vitest'
import { startAttempt, act, assess, replay, pointsFor, type Attempt, type AttemptEvent, type Services } from '@challengeforge/engine'
import { labLegacy, type LabLegacyDef, type LabLegacyState } from '../src/lab-legacy'
import fixture from '../fixtures/lab-legacy/synthetic-metrics-mission.json'

const def: LabLegacyDef = labLegacy.definitionSchema.parse(fixture)
const ctx = { attemptId: 'att-1', userId: 'u1', challengeId: 'synthetic-metrics', seed: 1 }
const T0 = Date.parse('2026-10-08T10:00:00.000Z')
const at = (secondsLater = 0) => new Date(T0 + secondsLater * 1000).toISOString()

const RIGHT = { sensitivity: '41.5', explanation: 'opt_b' }
const WRONG = { sensitivity: 92, explanation: 'opt_b' }

async function play(actions: unknown[], services: Services = {}) {
  let { attempt } = startAttempt(labLegacy, def, ctx)
  const events: AttemptEvent[] = []
  let lastView = labLegacy.view(def, attempt.state)
  for (const [i, action] of actions.entries()) {
    const r = await act(labLegacy, def, attempt, action, { services, at: at(i * 10) })
    if (!r.ok) throw new Error(`action ${i} failed: ${r.error.code} ${r.error.message}`)
    attempt = r.attempt
    events.push(r.event)
    lastView = r.view
  }
  return { attempt, events, view: lastView }
}

describe('lab-legacy definition', () => {
  it('parses a Lab-shaped mission and applies rule defaults', () => {
    expect(def.rule.type).toBe('all_of')
    expect(def.scoring.max_attempts).toBeNull()
  })

  it('lints a mismatch between hint costs and hint texts', () => {
    expect(labLegacy.lint(def)).toEqual([])
    const issues = labLegacy.lint({ ...def, hints: ['only one'] })
    expect(issues[0]).toMatchObject({ path: 'hints', severity: 'error' })
  })
})

describe('lab-legacy play', () => {
  it('starts open and shows the public configuration only', () => {
    const { view } = startAttempt(labLegacy, def, ctx)
    const json = JSON.stringify(view)
    expect(view.status).toBe('open')
    expect(json).toContain('What is the tool')
    expect(json).not.toContain('"expected"')
    expect(json).not.toContain('Accuracy hides')
  })

  it('a wrong submission keeps the attempt open, counts it, and gives safe feedback', async () => {
    const { attempt, view } = await play([{ kind: 'submit', payload: WRONG }])
    expect(attempt.status).toBe('open')
    expect(attempt.state.wrongAttempts).toBe(1)
    expect(view.lastOutcomes?.map((o) => o.passed)).toEqual([false, true])
    expect(view.lastOutcomes?.[0]?.message).toContain('overall accuracy')
    expect(JSON.stringify(view)).not.toContain('41')
  })

  it('a right submission solves it and only then reveals the debrief', async () => {
    const { attempt, view } = await play([{ kind: 'submit', payload: WRONG }, { kind: 'submit', payload: RIGHT }])
    expect(attempt.status).toBe('terminal')
    expect(view.debrief).toContain('Accuracy hides')
    expect(view.reviewItems?.[0]).toMatchObject({ id: 'sensitivity', found: false })
  })

  it('hints are bought in order, and their text appears in the view', async () => {
    const { attempt, view } = await play([{ kind: 'hint', index: 0 }])
    expect(view.hints).toEqual([{ index: 0, cost: 10, text: def.hints[0] }])
    const r = await act(labLegacy, def, attempt, { kind: 'hint', index: 0 }, { services: {}, at: at(99) })
    expect(r).toMatchObject({ ok: false, error: { typeCode: 'hint_out_of_order' } })
    const skip = await act(labLegacy, def, startAttempt(labLegacy, def, ctx).attempt, { kind: 'hint', index: 1 }, { services: {}, at: at(1) })
    expect(skip).toMatchObject({ ok: false, error: { typeCode: 'hint_out_of_order' } })
  })

  it('offers "show me the answer" only after enough wrong attempts', async () => {
    const early = await play([{ kind: 'submit', payload: WRONG }])
    expect(early.view.canReveal).toBe(false)
    const r = await act(labLegacy, def, early.attempt, { kind: 'reveal' }, { services: {}, at: at(50) })
    expect(r).toMatchObject({ ok: false, error: { typeCode: 'reveal_not_available' } })

    const stuck = await play([1, 2, 3].map(() => ({ kind: 'submit', payload: WRONG })))
    expect(stuck.view.canReveal).toBe(true)
    const revealed = await act(labLegacy, def, stuck.attempt, { kind: 'reveal' }, { services: {}, at: at(50) })
    if (!revealed.ok) throw new Error('expected ok')
    expect(revealed.attempt.status).toBe('terminal')
    expect(revealed.view.debrief).toBeDefined()
  })

  it('enforces max attempts and cooldowns through the harvested attempt policy', async () => {
    const strict = { ...def, scoring: { ...def.scoring, max_attempts: 2, retry_cooldown_seconds: 30 } }
    let attempt: Attempt<LabLegacyState> = startAttempt(labLegacy, strict, ctx).attempt
    const first = await act(labLegacy, strict, attempt, { kind: 'submit', payload: WRONG }, { services: {}, at: at(0) })
    if (!first.ok) throw new Error('expected ok')
    attempt = first.attempt
    const tooSoon = await act(labLegacy, strict, attempt, { kind: 'submit', payload: RIGHT }, { services: {}, at: at(5) })
    expect(tooSoon).toMatchObject({ ok: false, error: { typeCode: 'cooldown' } })
    const second = await act(labLegacy, strict, attempt, { kind: 'submit', payload: WRONG }, { services: {}, at: at(40) })
    if (!second.ok) throw new Error('expected ok')
    expect(second.attempt.status).toBe('terminal')
  })

  it('rejects malformed actions at the boundary', async () => {
    const { attempt } = startAttempt(labLegacy, def, ctx)
    for (const bad of [{ kind: 'submit' }, { kind: 'hint', index: -1 }, { kind: 'win' }]) {
      expect(await act(labLegacy, def, attempt, bad, { services: {}, at: at() })).toMatchObject({ ok: false, error: { code: 'invalid_action' } })
    }
  })
})

describe('lab-legacy assessment and points', () => {
  it('a solved attempt passes every part; points apply the hint and guessing deductions', async () => {
    const { attempt, events } = await play([
      { kind: 'hint', index: 0 },
      { kind: 'submit', payload: WRONG },
      { kind: 'submit', payload: RIGHT },
    ])
    const a = await assess(labLegacy, def, attempt, events, {})
    expect(a).toMatchObject({ passed: true, score: 2, max: 2 })
    expect(a.criteria.map((c) => c.label)).toEqual(['Sensitivity', 'Explanation'])
    expect(pointsFor(a, labLegacy.pointsInput(def, attempt.state))).toBe(80)
  })

  it('a revealed attempt earns nothing', async () => {
    const stuck = await play([...[1, 2, 3].map(() => ({ kind: 'submit', payload: WRONG })), { kind: 'reveal' }])
    const a = await assess(labLegacy, def, stuck.attempt, stuck.events, {})
    expect(a.passed).toBe(false)
    expect(pointsFor(a, labLegacy.pointsInput(def, stuck.attempt.state))).toBe(0)
  })

  it('re-grades against a corrected answer key', async () => {
    const { attempt, events } = await play([{ kind: 'submit', payload: RIGHT }])
    const corrected: LabLegacyDef = {
      ...def,
      rule: { type: 'exact', field: 'explanation', expected: 'opt_c', case_sensitive: false },
    }
    expect((await assess(labLegacy, def, attempt, events, {})).passed).toBe(true)
    expect((await assess(labLegacy, corrected, attempt, events, {})).passed).toBe(false)
  })

  it('replays to the same state from recorded grading results, without re-grading', async () => {
    const judge = vi.fn(async () => ({ goal_met: true, reason: '' }))
    const { attempt, events } = await play([{ kind: 'submit', payload: WRONG }, { kind: 'submit', payload: RIGHT }], { judge })
    const rebuilt = await replay(labLegacy, def, ctx, events, {})
    if (!rebuilt.ok) throw new Error('expected ok')
    expect(rebuilt.attempt).toEqual(attempt)
  })
})
