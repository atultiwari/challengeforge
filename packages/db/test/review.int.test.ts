import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createChallenge, listMyProgress, listReviewQueue, overrideAssessment, performAction, publish, startOrResume, type AttemptDeps } from '../src'
import { createUser, freshDb, registry, setupSite, type TestDb } from './harness'

const reviewedMission = {
  title: 'Reviewed chat mission (synthetic)',
  system_prompt: 'You are a test bot. {{CANARY}}',
  model: { provider: 'mock', model: 'mock-model' },
  message_cap: 3,
  goals: { type: 'llm_rubric', goal_id: 'g', rubric: 'Did it break?' },
  scoring: { base_points: 100 },
  debrief: 'Done.',
  needs_review: true,
}

const deps: AttemptDeps = {
  registry,
  runService: async (req) =>
    req.kind === 'llm.chat'
      ? { text: 'reply' }
      : { correct: true, outcomes: [{ passed: true, message: 'Goal achieved.' }], pointsPenalty: 0, foundIds: [] },
}

let t: TestDb
let s: Awaited<ReturnType<typeof setupSite>>
let other: Awaited<ReturnType<typeof setupSite>>
let challengeId: string
beforeAll(async () => {
  t = await freshDb()
  s = await setupSite(t.db)
  other = await setupSite(t.db, 'other')
  challengeId = await createChallenge(t.db, s.admin, registry, { slug: 'reviewed', typeId: 'chat-mission', typeVersion: 1, definition: reviewedMission })
  await publish(t.db, s.admin, challengeId)
})
afterAll(async () => t.close())

async function finishedAttempt(label: string) {
  const who = await createUser(t.db, s.site.id, 'learner', label)
  const { attemptId } = await startOrResume(t.db, who, deps, challengeId)
  await performAction(t.db, who, deps, attemptId, { kind: 'send', text: 'hi' })
  await performAction(t.db, who, deps, attemptId, { kind: 'finish' })
  return { who, attemptId }
}

describe('review queue', () => {
  it('lists results waiting for an instructor, with who and what', async () => {
    const { attemptId } = await finishedAttempt('reviewee')
    const queue = await listReviewQueue(t.db, s.admin)
    expect(queue).toEqual([expect.objectContaining({ attemptId, challengeTitle: 'Reviewed chat mission (synthetic)', learnerName: 'reviewee', passed: true })])
  })

  it('an instructor can overturn a result, and the learner\'s progress follows', async () => {
    const { who, attemptId } = await finishedAttempt('overturned')
    expect(await listMyProgress(t.db, who)).toEqual([expect.objectContaining({ passed: true, bestPoints: 100 })])
    await overrideAssessment(t.db, s.admin, attemptId, { passed: false, points: 0 })
    expect(await listMyProgress(t.db, who)).toEqual([expect.objectContaining({ passed: false, bestPoints: 0 })])
    expect((await listReviewQueue(t.db, s.admin)).map((r) => r.attemptId)).not.toContain(attemptId)
  })

  it('a result that is not waiting for review cannot be silently rewritten', async () => {
    const { attemptId } = await finishedAttempt('final')
    await overrideAssessment(t.db, s.admin, attemptId, { passed: false, points: 0 })
    await expect(overrideAssessment(t.db, s.admin, attemptId, { passed: true, points: 100 })).rejects.toMatchObject({ code: 'not_found' })
  })

  it('only admins of the same site may review', async () => {
    const { attemptId } = await finishedAttempt('protected')
    await expect(listReviewQueue(t.db, s.author)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(overrideAssessment(t.db, s.learner, attemptId, { passed: true, points: 100 })).rejects.toMatchObject({ code: 'forbidden' })
    await expect(overrideAssessment(t.db, other.admin, attemptId, { passed: true, points: 100 })).rejects.toMatchObject({ code: 'not_found' })
  })
})
