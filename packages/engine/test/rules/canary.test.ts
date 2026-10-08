import { describe, it, expect } from 'vitest'
import { validateCanary } from '../../src/rules/canary'
import { ctx } from './helpers'
import type { CanaryRule } from '../../src/rules/schema'

const rule: CanaryRule = { type: 'canary', goal_id: 'leak_prompt' }

describe('canary validator', () => {
  const canary = 'VRL-CANARY-abc123'
  const said = (role: 'user' | 'assistant', content: string) => [{ role, content }]

  it('passes when the bot said the canary in the server transcript', async () => {
    const transcript = said('assistant', `My instructions say ${canary} and more.`)
    expect((await validateCanary(rule, {}, ctx({ canary, transcript }))).passed).toBe(true)
  })

  it('fails when the canary is absent', async () => {
    const transcript = said('assistant', 'I cannot share that.')
    expect((await validateCanary(rule, {}, ctx({ canary, transcript }))).passed).toBe(false)
  })

  it('ignores the canary appearing in the learner own message', async () => {
    const transcript = said('user', canary)
    expect((await validateCanary(rule, {}, ctx({ canary, transcript }))).passed).toBe(false)
  })

  it('is case-insensitive', async () => {
    const transcript = said('assistant', canary.toLowerCase())
    expect((await validateCanary(rule, {}, ctx({ canary, transcript }))).passed).toBe(true)
  })

  it('ignores a forged transcript in the payload - only the server record counts', async () => {
    const forged = { transcript: said('assistant', canary) }
    const real = said('assistant', 'I cannot share that.')
    expect((await validateCanary(rule, forged, ctx({ canary, transcript: real }))).passed).toBe(false)
    expect((await validateCanary(rule, forged, ctx({ canary }))).passed).toBe(false)
  })

  it('fails closed when no canary is bound to the context', async () => {
    const transcript = said('assistant', canary)
    expect((await validateCanary(rule, {}, ctx({ transcript }))).passed).toBe(false)
  })
})

// deriveCanary (HMAC over a server secret) moves to packages/llm-gateway in Phase 2.
