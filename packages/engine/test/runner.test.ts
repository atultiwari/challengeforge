import { describe, it, expect, vi } from 'vitest'
import { z } from 'zod'
import type { AttemptCtx, ChallengeType, StepEnv } from '../src/contract'
import { startAttempt, act, assess, replay } from '../src/runner'
import { combineCriteria } from '../src/assessment'

/**
 * A toy interactive type: the learner adds numbers until they choose to stop.
 * `ask_oracle` calls an injected service, so we can prove that service
 * outputs are recorded on the event and reused (not re-called) on replay.
 */
const CounterDef = z.object({ target: z.number().int(), limit: z.number().int().positive() })
type CounterDef = z.infer<typeof CounterDef>

const CounterAction = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add'), n: z.number().int().min(1).max(5) }),
  z.object({ kind: z.literal('ask_oracle') }),
  z.object({ kind: z.literal('stop') }),
  z.object({ kind: z.literal('explode') }),
])
type CounterAction = z.infer<typeof CounterAction>

interface CounterState {
  total: number
  steps: number
  stopped: boolean
  oracleSaid: string | null
}

const oracle = vi.fn(async () => 'add three')

const counterType: ChallengeType<CounterDef, CounterState, CounterAction, { total: number; oracleSaid: string | null }> = {
  id: 'counter',
  version: 1,
  paradigm: 'interactive',
  definitionSchema: CounterDef,
  actionSchema: CounterAction,
  lint: (def) => (def.target > def.limit * 5 ? [{ path: 'target', severity: 'error', message: 'Target is unreachable.' }] : []),
  init: () => ({ total: 0, steps: 0, stopped: false, oracleSaid: null }),
  async step(def, state, action, env: StepEnv) {
    switch (action.kind) {
      case 'add':
        return { ok: true, state: { ...state, total: state.total + action.n, steps: state.steps + 1 } }
      case 'ask_oracle': {
        const said = typeof env.recorded === 'string' ? env.recorded : await oracle()
        return { ok: true, state: { ...state, oracleSaid: said, steps: state.steps + 1 }, effects: said }
      }
      case 'stop':
        return { ok: true, state: { ...state, stopped: true } }
      case 'explode':
        throw new Error('boom')
    }
  },
  view: (_def, s) => ({ total: s.total, oracleSaid: s.oracleSaid }),
  isTerminal: (def, s) => s.stopped || s.steps >= def.limit,
  async evaluate(def, trajectory, final) {
    return combineCriteria(
      [
        {
          id: 'hit',
          label: 'Reached the target',
          score: final.total === def.target ? 10 : 0,
          max: 10,
          passed: final.total === def.target,
          feedback: '',
        },
        { id: 'moves', label: 'Moves', score: trajectory.length <= 3 ? 5 : 0, max: 5, passed: true, feedback: '' },
      ],
      { passFraction: 0.6 },
    )
  },
}

const def: CounterDef = { target: 7, limit: 4 }
const ctx: AttemptCtx = { attemptId: 'a1', userId: 'u1', challengeId: 'c1', seed: 42 }
const env = (at = '2026-10-08T10:00:00.000Z') => ({ services: {}, at })

describe('startAttempt', () => {
  it('opens an attempt at seq 0 with the initial view', () => {
    const { attempt, view } = startAttempt(counterType, def, ctx)
    expect(attempt).toMatchObject({ seq: 0, status: 'open', state: { total: 0 } })
    expect(view).toEqual({ total: 0, oracleSaid: null })
  })
})

describe('act', () => {
  it('applies a valid action, bumps seq and returns the event and new view', async () => {
    const { attempt } = startAttempt(counterType, def, ctx)
    const r = await act(counterType, def, attempt, { kind: 'add', n: 3 }, env())
    if (!r.ok) throw new Error('expected ok')
    expect(r.attempt.seq).toBe(1)
    expect(r.event).toEqual({ seq: 1, action: { kind: 'add', n: 3 }, at: '2026-10-08T10:00:00.000Z' })
    expect(r.view.total).toBe(3)
  })

  it('never mutates the attempt it was given', async () => {
    const { attempt } = startAttempt(counterType, def, ctx)
    const before = JSON.parse(JSON.stringify(attempt))
    await act(counterType, def, attempt, { kind: 'add', n: 3 }, env())
    expect(attempt).toEqual(before)
  })

  it('rejects an action that fails the type schema, without changing state', async () => {
    const { attempt } = startAttempt(counterType, def, ctx)
    for (const bad of [{ kind: 'add', n: 99 }, { kind: 'teleport' }, null, 'add', { n: 1 }]) {
      const r = await act(counterType, def, attempt, bad, env())
      expect(r).toMatchObject({ ok: false, error: { code: 'invalid_action' } })
    }
  })

  it('refuses actions once the attempt is terminal', async () => {
    const { attempt } = startAttempt(counterType, def, ctx)
    const stopped = await act(counterType, def, attempt, { kind: 'stop' }, env())
    if (!stopped.ok) throw new Error('expected ok')
    expect(stopped.attempt.status).toBe('terminal')
    const r = await act(counterType, def, stopped.attempt, { kind: 'add', n: 1 }, env())
    expect(r).toMatchObject({ ok: false, error: { code: 'attempt_closed' } })
  })

  it('closes the attempt when the type says it is terminal', async () => {
    let { attempt } = startAttempt(counterType, def, ctx)
    for (let i = 0; i < 4; i += 1) {
      const r = await act(counterType, def, attempt, { kind: 'add', n: 1 }, env())
      if (!r.ok) throw new Error('expected ok')
      attempt = r.attempt
    }
    expect(attempt.status).toBe('terminal')
  })

  it('turns a throwing step into step_failed and leaves the attempt untouched', async () => {
    const { attempt } = startAttempt(counterType, def, ctx)
    const r = await act(counterType, def, attempt, { kind: 'explode' }, env())
    expect(r).toMatchObject({ ok: false, error: { code: 'step_failed' } })
    if (r.ok) throw new Error('expected failure')
    expect(r.error.cause).toBeInstanceOf(Error)
  })

  it('passes through a rejection from the type itself', async () => {
    const picky: typeof counterType = {
      ...counterType,
      step: async () => ({ ok: false, error: { code: 'not_allowed', message: 'Not now.' } }),
    }
    const { attempt } = startAttempt(picky, def, ctx)
    const r = await act(picky, def, attempt, { kind: 'stop' }, env())
    expect(r).toMatchObject({ ok: false, error: { code: 'rejected', message: 'Not now.' } })
  })

  it('records service outputs on the event', async () => {
    const { attempt } = startAttempt(counterType, def, ctx)
    const r = await act(counterType, def, attempt, { kind: 'ask_oracle' }, env())
    if (!r.ok) throw new Error('expected ok')
    expect(r.event.effects).toBe('add three')
  })
})

describe('assess', () => {
  it('evaluates a terminal attempt over its trajectory', async () => {
    let { attempt } = startAttempt(counterType, def, ctx)
    const events = []
    for (const action of [{ kind: 'add', n: 4 }, { kind: 'add', n: 3 }, { kind: 'stop' }]) {
      const r = await act(counterType, def, attempt, action, env())
      if (!r.ok) throw new Error('expected ok')
      attempt = r.attempt
      events.push(r.event)
    }
    const a = await assess(counterType, def, attempt, events, {})
    expect(a).toMatchObject({ score: 15, max: 15, passed: true })
  })

  it('refuses to assess an attempt that is still open', async () => {
    const { attempt } = startAttempt(counterType, def, ctx)
    await expect(assess(counterType, def, attempt, [], {})).rejects.toThrow(/still open/)
  })
})

describe('replay', () => {
  it('rebuilds the same attempt from its event log without re-calling services', async () => {
    oracle.mockClear()
    let { attempt } = startAttempt(counterType, def, ctx)
    const events = []
    for (const action of [{ kind: 'add', n: 2 }, { kind: 'ask_oracle' }, { kind: 'stop' }]) {
      const r = await act(counterType, def, attempt, action, env())
      if (!r.ok) throw new Error('expected ok')
      attempt = r.attempt
      events.push(r.event)
    }
    expect(oracle).toHaveBeenCalledTimes(1)

    const rebuilt = await replay(counterType, def, ctx, events, {})
    if (!rebuilt.ok) throw new Error('expected ok')
    expect(rebuilt.attempt).toEqual(attempt)
    expect(oracle).toHaveBeenCalledTimes(1)
  })

  it('reports the event that no longer applies (e.g. after an incompatible definition change)', async () => {
    const events = [
      { seq: 1, action: { kind: 'stop' }, at: '2026-10-08T10:00:00.000Z' },
      { seq: 2, action: { kind: 'add', n: 1 }, at: '2026-10-08T10:00:01.000Z' },
    ]
    const r = await replay(counterType, def, ctx, events, {})
    expect(r).toMatchObject({ ok: false, failedAtSeq: 2, error: { code: 'attempt_closed' } })
  })

  it('rejects an event log with gaps or out-of-order sequence numbers', async () => {
    const events = [{ seq: 2, action: { kind: 'stop' }, at: '2026-10-08T10:00:00.000Z' }]
    const r = await replay(counterType, def, ctx, events, {})
    expect(r).toMatchObject({ ok: false, failedAtSeq: 2, error: { code: 'bad_sequence' } })
  })
})

describe('lint is part of the contract', () => {
  it('lets a type report authoring problems before publishing', () => {
    expect(counterType.lint({ target: 100, limit: 2 })).toHaveLength(1)
    expect(counterType.lint(def)).toEqual([])
  })
})
