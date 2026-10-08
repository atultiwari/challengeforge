import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { closeStaleReservations, mysqlLlmStore, STALE_RESERVATION_MS } from '../src'
import { freshDb, setupSite, type TestDb } from './harness'

let t: TestDb
let s: Awaited<ReturnType<typeof setupSite>>
let userId: string
beforeAll(async () => {
  t = await freshDb()
  s = await setupSite(t.db)
  userId = s.learner.principal!.userId
})
afterAll(async () => t.close())

const reserve = (cap: number, purpose = 'chat', challengeId = 'c1') =>
  mysqlLlmStore(t.db, s.site.id).reserveCall({ userId, challengeId, purpose, cap, provider: 'mock', model: 'mock-model', credentialSource: 'platform' })

describe('MySQL LlmStore', () => {
  it('reserves atomically: parallel requests can never exceed the cap', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => reserve(3)))
    const granted = results.filter((r) => r.reservationId !== null)
    expect(granted).toHaveLength(3)
    expect(results.filter((r) => r.reservationId === null).every((r) => r.callsUsed === 3)).toBe(true)
  })

  it('a released (failed) call gives its slot back; a completed one does not', async () => {
    const store = mysqlLlmStore(t.db, s.site.id)
    const a = await reserve(2, 'judge')
    const b = await reserve(2, 'judge')
    expect(b.callsUsed).toBe(2)
    await store.releaseCall(a.reservationId!)
    await store.completeCall(b.reservationId!, {
      userId, challengeId: 'c1', provider: 'mock', model: 'mock-model', credentialSource: 'platform', purpose: 'judge',
      inputTokens: 10, outputTokens: 5, costEstimateUsd: 0.25, requestId: 'req-1',
    })
    expect((await reserve(2, 'judge')).reservationId).not.toBeNull()
    expect((await reserve(2, 'judge')).reservationId).toBeNull()
  })

  it('closes reservations that never reported back, keeping their slot used', async () => {
    const live = await reserve(5, 'stale', 'c-stale')
    const later = new Date(Date.now() + STALE_RESERVATION_MS + 60_000)
    const old = await reserve(5, 'stale', 'c-stale')
    await t.db.updateTable('llm_usage').set({ created_at: new Date(Date.now() - STALE_RESERVATION_MS - 60_000) }).where('id', '=', old.reservationId!).execute()
    expect(await closeStaleReservations(t.db)).toBe(1)
    const rows = await t.db.selectFrom('llm_usage').select(['id', 'status']).where('challenge_id', '=', 'c-stale').execute()
    expect(Object.fromEntries(rows.map((r) => [r.id, r.status]))).toEqual({ [live.reservationId!]: 'reserved', [old.reservationId!]: 'completed' })
    expect((await reserve(5, 'stale', 'c-stale')).callsUsed).toBe(3)
    await closeStaleReservations(t.db, later)
    const after = await t.db.selectFrom('llm_usage').select('status').where('challenge_id', '=', 'c-stale').execute()
    expect(after.map((r) => r.status)).toEqual(['completed', 'completed', 'completed'])
  })

  it('caps are per user, challenge and purpose', async () => {
    expect((await reserve(1, 'chat', 'c2')).reservationId).not.toBeNull()
    expect((await reserve(1, 'chat', 'c2')).reservationId).toBeNull()
    expect((await reserve(1, 'other', 'c2')).reservationId).not.toBeNull()
  })

  it('sums only platform-funded spend for the budget', async () => {
    const store = mysqlLlmStore(t.db, s.site.id)
    const byok = await store.reserveCall({ userId, challengeId: 'c3', purpose: 'chat', cap: 5, provider: 'mock', model: 'm', credentialSource: 'byok' })
    await store.completeCall(byok.reservationId!, {
      userId, challengeId: 'c3', provider: 'mock', model: 'm', credentialSource: 'byok', purpose: 'chat',
      inputTokens: 1, outputTokens: 1, costEstimateUsd: 9, requestId: null,
    })
    expect(await store.sumPlatformCostUsd(userId)).toBeCloseTo(0.25)
  })

  it('stores and returns encrypted credentials per user and provider, never plaintext', async () => {
    const store = mysqlLlmStore(t.db, s.site.id)
    expect(await store.getCredential(userId, 'anthropic')).toBeNull()
    await store.saveCredential(userId, 'anthropic', { ciphertext: 'c1', iv: 'i1', authTag: 't1' }, '1234')
    await store.saveCredential(userId, 'anthropic', { ciphertext: 'c2', iv: 'i2', authTag: 't2' }, '5678')
    expect(await store.getCredential(userId, 'anthropic')).toEqual({ provider: 'anthropic', ciphertext: 'c2', iv: 'i2', authTag: 't2' })
    expect(await store.listCredentials(userId)).toEqual([{ provider: 'anthropic', last4: '5678' }])
    await store.deleteCredential(userId, 'anthropic')
    expect(await store.getCredential(userId, 'anthropic')).toBeNull()
  })
})
