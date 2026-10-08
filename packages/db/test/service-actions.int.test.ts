import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ServiceRequest } from '@challengeforge/engine'
import { createChallenge, performAction, publish, startOrResume, type AttemptDeps } from '../src'
import { freshDb, registry, setupSite, createUser, type TestDb } from './harness'

const mission = {
  title: 'Synthetic chat mission',
  system_prompt: 'You are a test bot. {{CANARY}}',
  model: { provider: 'mock', model: 'mock-model' },
  message_cap: 5,
  goals: { type: 'llm_rubric', goal_id: 'g', rubric: 'Did it break?' },
  scoring: { base_points: 100 },
  debrief: 'Done.',
}

let t: TestDb
let s: Awaited<ReturnType<typeof setupSite>>
let challengeId: string

beforeAll(async () => {
  t = await freshDb()
  s = await setupSite(t.db)
  challengeId = await createChallenge(t.db, s.admin, registry, { slug: 'chat', typeId: 'chat-mission', typeVersion: 1, definition: mission })
  await publish(t.db, s.admin, challengeId)
})
afterAll(async () => t.close())

/** A fake service runner: a canned bot reply, and a canned verdict for grading. */
function runner(onCall?: (req: ServiceRequest) => Promise<void>): AttemptDeps['runService'] {
  return async (req) => {
    await onCall?.(req)
    if (req.kind === 'llm.chat') return { text: 'canned reply' }
    if (req.kind === 'grade') return { correct: true, outcomes: [{ passed: true, message: 'Goal achieved.' }], pointsPenalty: 0, foundIds: ['g'] }
    throw new Error(`unknown service ${req.kind}`)
  }
}

describe('actions that need a model', () => {
  it('make the call outside any lock, then apply and record the result', async () => {
    const who = await createUser(t.db, s.site.id, 'learner', 'chatter')
    const { attemptId } = await startOrResume(t.db, who, { registry }, challengeId)
    let pendingSeenDuringCall: unknown = null
    const deps: AttemptDeps = {
      registry,
      runService: runner(async () => {
        // The attempt row must NOT be locked here: this update would block (and time out) if it were.
        await t.db.updateTable('attempts').set({ updated_at: new Date() }).where('id', '=', attemptId).execute()
        pendingSeenDuringCall = (await t.db.selectFrom('attempts').select('pending_key').where('id', '=', attemptId).executeTakeFirst())?.pending_key
      }),
    }
    const r = await performAction(t.db, who, deps, attemptId, { kind: 'send', text: 'hello' }, { idempotencyKey: 'k1' })
    expect(r).toMatchObject({ ok: true, snapshot: { view: { transcript: [{ role: 'user', content: 'hello' }, { role: 'assistant', content: 'canned reply' }] } } })
    expect(pendingSeenDuringCall).toBe('k1')
    const event = await t.db.selectFrom('attempt_events').selectAll().where('attempt_id', '=', attemptId).executeTakeFirstOrThrow()
    expect(event.seq).toBe(1)
    const row = await t.db.selectFrom('attempts').select(['pending_action', 'pending_key']).where('id', '=', attemptId).executeTakeFirstOrThrow()
    expect(row).toEqual({ pending_action: null, pending_key: null })
  })

  it('refuses a second action while one is waiting on the model', async () => {
    const who = await createUser(t.db, s.site.id, 'learner', 'impatient')
    const { attemptId } = await startOrResume(t.db, who, { registry }, challengeId)
    let release: () => void = () => undefined
    const slow: AttemptDeps = { registry, runService: runner(() => new Promise<void>((resolve) => { release = resolve })) }
    const first = performAction(t.db, who, slow, attemptId, { kind: 'send', text: 'one' })
    await vi.waitFor(async () => {
      const row = await t.db.selectFrom('attempts').select('pending_since').where('id', '=', attemptId).executeTakeFirstOrThrow()
      expect(row.pending_since).not.toBeNull()
    })
    const second = await performAction(t.db, who, { registry, runService: runner() }, attemptId, { kind: 'send', text: 'two' })
    expect(second).toMatchObject({ ok: false, error: { code: 'busy' } })
    release()
    expect(await first).toMatchObject({ ok: true })
  })

  it('a failed model call changes nothing and can be retried', async () => {
    const who = await createUser(t.db, s.site.id, 'learner', 'unlucky')
    const { attemptId } = await startOrResume(t.db, who, { registry }, challengeId)
    const failing: AttemptDeps = { registry, runService: async () => { throw new Error('provider down') }, onError: () => undefined }
    expect(await performAction(t.db, who, failing, attemptId, { kind: 'send', text: 'hello' })).toMatchObject({ ok: false, error: { code: 'service_failed' } })
    const retry = await performAction(t.db, who, { registry, runService: runner() }, attemptId, { kind: 'send', text: 'hello' })
    expect(retry).toMatchObject({ ok: true, snapshot: { seq: 1 } })
  })

  it('without a service runner, service actions are refused cleanly', async () => {
    const who = await createUser(t.db, s.site.id, 'learner', 'offline')
    const { attemptId } = await startOrResume(t.db, who, { registry }, challengeId)
    expect(await performAction(t.db, who, { registry }, attemptId, { kind: 'send', text: 'x' })).toMatchObject({ ok: false, error: { code: 'service_unavailable' } })
  })

  it('a stuck pending action expires so the attempt is not blocked forever', async () => {
    const who = await createUser(t.db, s.site.id, 'learner', 'stuck')
    const { attemptId } = await startOrResume(t.db, who, { registry }, challengeId)
    await t.db
      .updateTable('attempts')
      .set({ pending_action: JSON.stringify({ kind: 'send', text: 'lost' }), pending_key: 'old', pending_since: new Date(Date.now() - 10 * 60_000) })
      .where('id', '=', attemptId)
      .execute()
    expect(await performAction(t.db, who, { registry, runService: runner() }, attemptId, { kind: 'send', text: 'again' })).toMatchObject({ ok: true })
  })

  it('finishing grades through the service and records the assessment', async () => {
    const who = await createUser(t.db, s.site.id, 'learner', 'finisher')
    const { attemptId } = await startOrResume(t.db, who, { registry }, challengeId)
    const deps: AttemptDeps = { registry, runService: runner() }
    await performAction(t.db, who, deps, attemptId, { kind: 'send', text: 'break it' })
    const done = await performAction(t.db, who, deps, attemptId, { kind: 'finish' })
    expect(done).toMatchObject({ ok: true, snapshot: { status: 'terminal', assessment: { passed: true, points: 100 } } })
  })
})
