import { describe, it, expect } from 'vitest'
import { canSubmit, canReveal, type AttemptState } from '../src/attempt-policy'

const scoring = {
  base_points: 100,
  hint_costs: [10, 20, 40],
  max_attempts: null,
  wrong_attempt_penalty: 10,
  retry_cooldown_seconds: 0,
  reveal_after_attempts: 3,
}

const state = (over: Partial<AttemptState> = {}): AttemptState => ({
  attempts: 0,
  wrongAttempts: 0,
  lastWrongAt: null,
  completedAt: null,
  revealedAt: null,
  ...over,
})

describe('canSubmit', () => {
  it('allows a first attempt with no progress row', () => {
    expect(canSubmit(scoring, null)).toEqual({ allowed: true })
  })

  it('enforces max_attempts', () => {
    const r = canSubmit({ ...scoring, max_attempts: 3 }, state({ attempts: 3, wrongAttempts: 3 }))
    expect(r).toMatchObject({ allowed: false, code: 'max_attempts' })
  })

  it('always lets a learner re-submit a flag they already captured', () => {
    const r = canSubmit({ ...scoring, max_attempts: 1 }, state({ attempts: 5, completedAt: '2026-09-23T00:00:00Z' }))
    expect(r.allowed).toBe(true)
  })

  it('makes the learner wait during a cooldown and says how long', () => {
    const now = new Date('2026-09-23T10:00:10Z')
    const r = canSubmit(
      { ...scoring, retry_cooldown_seconds: 30 },
      state({ attempts: 1, wrongAttempts: 1, lastWrongAt: '2026-09-23T10:00:00Z' }),
      now,
    )
    expect(r).toMatchObject({ allowed: false, code: 'cooldown', retryAfterSeconds: 20 })
  })

  it('allows a submission once the cooldown has passed', () => {
    const now = new Date('2026-09-23T10:00:31Z')
    const r = canSubmit(
      { ...scoring, retry_cooldown_seconds: 30 },
      state({ attempts: 1, wrongAttempts: 1, lastWrongAt: '2026-09-23T10:00:00Z' }),
      now,
    )
    expect(r.allowed).toBe(true)
  })

  it('has no cooldown when none is configured', () => {
    const r = canSubmit(scoring, state({ attempts: 1, wrongAttempts: 1, lastWrongAt: new Date().toISOString() }))
    expect(r.allowed).toBe(true)
  })
})

describe('canReveal', () => {
  it('is not offered before enough wrong attempts', () => {
    expect(canReveal(scoring, state({ wrongAttempts: 2 }))).toBe(false)
  })

  it('is offered after the configured number of wrong attempts', () => {
    expect(canReveal(scoring, state({ wrongAttempts: 3 }))).toBe(true)
  })

  it('is not offered once the flag is captured', () => {
    expect(canReveal(scoring, state({ wrongAttempts: 5, completedAt: '2026-09-23T00:00:00Z' }))).toBe(false)
  })

  it('is never offered when the challenge disables it', () => {
    expect(canReveal({ ...scoring, reveal_after_attempts: null }, state({ wrongAttempts: 50 }))).toBe(false)
  })

  it('is not offered to a learner with no progress', () => {
    expect(canReveal(scoring, null)).toBe(false)
  })
})
