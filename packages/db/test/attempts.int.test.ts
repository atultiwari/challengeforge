import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createChallenge,
  findOpenAttempt,
  getForAuthoring,
  listMyProgress,
  performAction,
  publish,
  saveDraftVersion,
  startOrResume,
  submitForReview,
} from '../src'
import { freshDb, registry, setupSite, type TestDb } from './harness'
import { RIGHT, WRONG, quizMission } from './fixtures'
import dka from '../../types/fixtures/diagnostic-sim/dka-young-adult.json'

let t: TestDb
let s: Awaited<ReturnType<typeof setupSite>>
let challengeId: string
const deps = { registry }

beforeAll(async () => {
  t = await freshDb()
  s = await setupSite(t.db)
  challengeId = await createChallenge(t.db, s.author, registry, { slug: 'quiz', typeId: 'lab-legacy', typeVersion: 1, definition: quizMission })
  await submitForReview(t.db, s.author, challengeId)
  await publish(t.db, s.admin, challengeId)
})
afterAll(async () => t.close())

describe('authoring workflow', () => {
  it('validates definitions with the type schema AND lint before saving', async () => {
    await expect(
      createChallenge(t.db, s.author, registry, { slug: 'bad', typeId: 'lab-legacy', typeVersion: 1, definition: { ...quizMission, hints: [] } }),
    ).rejects.toMatchObject({ code: 'invalid', issues: [expect.objectContaining({ path: 'hints' })] })
    await expect(
      createChallenge(t.db, s.author, registry, { slug: 'ghost', typeId: 'no-such-type', typeVersion: 1, definition: {} }),
    ).rejects.toMatchObject({ code: 'invalid' })
  })

  it('an edit is a new immutable version and goes back to draft', async () => {
    const id = await createChallenge(t.db, s.author, registry, { slug: 'edit-me', typeId: 'lab-legacy', typeVersion: 1, definition: quizMission })
    expect(await saveDraftVersion(t.db, s.author, registry, id, { ...quizMission, title: 'Renamed' })).toBe(2)
    const latest = await getForAuthoring(t.db, s.author, id)
    expect(latest).toMatchObject({ version: 2, title: 'Renamed', status: 'draft', canPublish: false })
  })
})

describe('playing an attempt', () => {
  it('starts once and resumes the same open attempt', async () => {
    const a = await startOrResume(t.db, s.learner, deps, challengeId)
    const b = await startOrResume(t.db, s.learner, deps, challengeId)
    expect(b.attemptId).toBe(a.attemptId)
    expect(a).toMatchObject({ status: 'open', seq: 0, assessment: null })
  })

  it('applies actions, persists state, and records the assessment and progress on completion', async () => {
    const { attemptId } = await startOrResume(t.db, s.learner, deps, challengeId)
    const wrong = await performAction(t.db, s.learner, deps, attemptId, WRONG)
    expect(wrong).toMatchObject({ ok: true, snapshot: { status: 'open', seq: 1 } })
    const right = await performAction(t.db, s.learner, deps, attemptId, RIGHT)
    if (!right.ok) throw new Error('expected ok')
    expect(right.snapshot).toMatchObject({ status: 'terminal', seq: 2, assessment: { passed: true, points: 90 } })
    expect(await listMyProgress(t.db, s.learner)).toEqual([{ challengeId, attempts: 1, bestPoints: 90, passed: true }])
  })

  it('opens a fresh attempt after the last one ended, and keeps the BEST result', async () => {
    const again = await startOrResume(t.db, s.learner, deps, challengeId)
    expect(again.seq).toBe(0)
    for (const action of [WRONG, WRONG, { kind: 'reveal' }]) await performAction(t.db, s.learner, deps, again.attemptId, action)
    expect(await listMyProgress(t.db, s.learner)).toEqual([{ challengeId, attempts: 2, bestPoints: 90, passed: true }])
  })

  it('returns type rejections without writing anything', async () => {
    const { attemptId } = await startOrResume(t.db, s.otherLearner, deps, challengeId)
    const r = await performAction(t.db, s.otherLearner, deps, attemptId, { kind: 'reveal' })
    expect(r).toMatchObject({ ok: false, error: { code: 'rejected', typeCode: 'reveal_not_available' } })
    expect((await startOrResume(t.db, s.otherLearner, deps, challengeId)).seq).toBe(0)
  })

  it('makes client retries idempotent with an idempotency key', async () => {
    const learner = (await import('./harness')).createUser
    const who = await learner(t.db, s.site.id, 'learner', 'retrier')
    const { attemptId } = await startOrResume(t.db, who, deps, challengeId)
    const first = await performAction(t.db, who, deps, attemptId, WRONG, { idempotencyKey: 'k-1' })
    const retry = await performAction(t.db, who, deps, attemptId, WRONG, { idempotencyKey: 'k-1' })
    expect(first).toMatchObject({ ok: true, duplicate: false, snapshot: { seq: 1 } })
    expect(retry).toMatchObject({ ok: true, duplicate: true, snapshot: { seq: 1 } })
  })

  it('serialises parallel actions on one attempt: no lost updates, no duplicate sequence numbers', async () => {
    const learner = (await import('./harness')).createUser
    const who = await learner(t.db, s.site.id, 'learner', 'racer')
    const { attemptId } = await startOrResume(t.db, who, deps, challengeId)
    const results = await Promise.all([1, 2, 3, 4, 5].map(() => performAction(t.db, who, deps, attemptId, { kind: 'hint', index: 0 })))
    const accepted = results.filter((r) => r.ok)
    // Exactly one hint purchase succeeds; the rest see the updated state and are rejected.
    expect(accepted).toHaveLength(1)
    const events = await t.db.selectFrom('attempt_events').select('seq').where('attempt_id', '=', attemptId).execute()
    expect(events.map((e) => e.seq)).toEqual([1])
  })

  it('pins an attempt to the version it started on, even after a re-publish', async () => {
    const learner = (await import('./harness')).createUser
    const who = await learner(t.db, s.site.id, 'learner', 'pinned')
    const { attemptId } = await startOrResume(t.db, who, deps, challengeId)
    await saveDraftVersion(t.db, s.author, registry, challengeId, { ...quizMission, rule: { type: 'exact', field: 'answer', expected: 'c' } })
    await publish(t.db, s.admin, challengeId)
    const r = await performAction(t.db, who, deps, attemptId, RIGHT)
    expect(r).toMatchObject({ ok: true, snapshot: { status: 'terminal', assessment: { passed: true } } })
  })

  it('parallel starts (two tabs, a double click) create exactly one open attempt', async () => {
    const learner = (await import('./harness')).createUser
    const who = await learner(t.db, s.site.id, 'learner', 'twotabs')
    const snapshots = await Promise.all([1, 2, 3, 4, 5].map(() => startOrResume(t.db, who, deps, challengeId)))
    expect(new Set(snapshots.map((x) => x.attemptId)).size).toBe(1)
    const open = await t.db.selectFrom('attempts').select('id').where('user_id', '=', who.principal!.userId).where('status', '=', 'open').execute()
    expect(open).toHaveLength(1)
  })

  it('findOpenAttempt resumes without ever creating one', async () => {
    const learner = (await import('./harness')).createUser
    const who = await learner(t.db, s.site.id, 'learner', 'looker')
    expect(await findOpenAttempt(t.db, who, deps, challengeId)).toBeNull()
    const started = await startOrResume(t.db, who, deps, challengeId)
    expect((await findOpenAttempt(t.db, who, deps, challengeId))?.attemptId).toBe(started.attemptId)
  })

  it('parallel draft saves get distinct version numbers', async () => {
    const id = await createChallenge(t.db, s.author, registry, { slug: 'race-save', typeId: 'lab-legacy', typeVersion: 1, definition: quizMission })
    const versions = await Promise.all([1, 2, 3, 4].map((n) => saveDraftVersion(t.db, s.author, registry, id, { ...quizMission, title: `v${n}` })))
    expect([...versions].sort()).toEqual([2, 3, 4, 5])
  })

  it('author previews never count towards progress', async () => {
    const preview = await startOrResume(t.db, s.author, deps, challengeId, { preview: true })
    await performAction(t.db, s.author, deps, preview.attemptId, { kind: 'submit', payload: { answer: 'c' } })
    expect(await listMyProgress(t.db, s.author)).toEqual([])
  })
})

describe('definitions saved before a type gained a field', () => {
  it('play with that field\'s default instead of crashing', async () => {
    const id = await createChallenge(t.db, s.author, registry, { slug: 'old-dka', typeId: 'diagnostic-sim', typeVersion: 1, definition: dka })
    await submitForReview(t.db, s.author, id)
    await publish(t.db, s.admin, id)
    // As stored by a release before the simulated patient existed.
    const { patient_chat: _added, ...older } = (await getForAuthoring(t.db, s.author, id)).definition as Record<string, unknown>
    await t.db.updateTable('challenge_versions').set({ definition: JSON.stringify(older) }).where('challenge_id', '=', id).execute()

    const snapshot = await startOrResume(t.db, s.learner, deps, id)
    expect(snapshot.view).not.toHaveProperty('patientChat')
    const preview = await startOrResume(t.db, s.author, deps, id, { preview: true })
    expect(preview.view).not.toHaveProperty('patientChat')
  })
})
