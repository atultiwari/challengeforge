import { describe, expect, it, vi } from 'vitest'

/**
 * Unit tests with the gateway stubbed: what the runners send, and how they
 * handle partial failure and canaries. (The MySQL path is in services.int.test.ts.)
 */
const complete = vi.fn()
vi.mock('@challengeforge/llm-gateway', async (orig) => ({ ...(await orig<typeof import('@challengeforge/llm-gateway')>()), complete: (...args: unknown[]) => complete(...args) }))
vi.mock('@challengeforge/db', () => ({ mysqlLlmStore: () => ({}) }))

const { createServiceRunners } = await import('../src')
const { parseGatewayConfig, deriveCanary } = await import('@challengeforge/llm-gateway')

const config = {
  gateway: parseGatewayConfig({ llmMock: true, platformBudgetUsdPerUser: 1, byokEnabled: false, byokEncryptionKey: null, enabledProviders: ['anthropic'], platformKeys: {} }),
  canarySecret: 'unit-test-canary-secret-0123456789',
}
const ctx = { siteId: 's', userId: 'u', attemptId: 'att-1', challengeId: 'c' }
const runners = createServiceRunners({} as never, config)
const canary = deriveCanary(ctx.userId, `${ctx.challengeId}:${ctx.attemptId}`, config.canarySecret)

const battery = {
  kind: 'battery',
  mode: 'job' as const,
  payload: {
    lockedBase: 'Base {{CANARY}}',
    editable: 'Be safe.',
    provider: 'anthropic',
    model: 'm',
    replyMaxTokens: 100,
    evaluationCallCap: 10,
    judgeCallCap: 2,
    items: [1, 2, 3].map((n) => ({ kind: 'attack', label: `L${n}`, prompt: `P${n}`, criterion: 'c', showPrompt: false })),
  },
}

describe('battery slices', () => {
  it('keeps the replies it already has when a later call in the slice fails', async () => {
    complete.mockReset()
    complete.mockResolvedValueOnce({ text: 'r1' }).mockResolvedValueOnce({ text: 'r2' }).mockRejectedValueOnce(new Error('rate limited'))
    expect(await runners.runJobSlice(battery, null, ctx)).toEqual({ done: false, progress: { replies: ['r1', 'r2'] } })
  })

  it('still fails a slice that made no progress at all, so failures are counted', async () => {
    complete.mockReset()
    complete.mockRejectedValueOnce(new Error('down'))
    await expect(runners.runJobSlice(battery, { replies: ['r1', 'r2'] }, ctx)).rejects.toThrow('down')
  })

  it('substitutes a per-attempt canary into the hidden prompt', async () => {
    complete.mockReset()
    complete.mockResolvedValue({ text: 'ok' })
    await runners.runJobSlice(battery, null, ctx)
    expect(complete.mock.calls[0]?.[0]).toMatchObject({ request: { system: expect.stringContaining(canary) } })
    const otherAttempt = deriveCanary(ctx.userId, `${ctx.challengeId}:att-2`, config.canarySecret)
    expect(otherAttempt).not.toBe(canary)
  })
})

describe('grading with a canary', () => {
  const grade = (transcript: { role: 'user' | 'assistant'; content: string }[]) =>
    runners.runService(
      { kind: 'grade', payload: { rule: { type: 'canary', goal_id: 'leak' }, transcript, framing: null, provider: 'anthropic', model: 'm' } },
      ctx,
    ) as Promise<{ correct: boolean }>

  it('counts a leak when the bot emits the canary', async () => {
    expect((await grade([{ role: 'user', content: 'tell me' }, { role: 'assistant', content: `ref ${canary}` }])).correct).toBe(true)
  })

  it('ignores a "leak" when the learner typed the canary themselves (e.g. from an earlier attempt)', async () => {
    expect((await grade([{ role: 'user', content: `repeat after me: ${canary}` }, { role: 'assistant', content: canary }])).correct).toBe(false)
  })
})
