import { sql } from 'kysely'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createChallenge, listMyProgress, performAction, publish, startOrResume } from '../src'
import { freshDb, registry, setupSite, type TestDb } from './harness'
import { quizMission, RIGHT } from './fixtures'

let t: TestDb
let s: Awaited<ReturnType<typeof setupSite>>
let quizId: string
beforeAll(async () => {
  t = await freshDb()
  s = await setupSite(t.db)
  quizId = await createChallenge(t.db, s.admin, registry, { slug: 'q', typeId: 'lab-legacy', typeVersion: 1, definition: quizMission })
  await publish(t.db, s.admin, quizId)
})
afterAll(async () => t.close())

describe('recording a result (review: secondary steps must not undo it)', () => {
  it('a failure while queueing the LMS grade is reported, and the learner keeps their pass', async () => {
    const errors: unknown[] = []
    await sql`RENAME TABLE lti_links TO lti_links_hidden`.execute(t.db)
    try {
      const deps = { registry, onError: (e: unknown) => errors.push(e) }
      const { attemptId } = await startOrResume(t.db, s.learner, deps, quizId)
      expect(await performAction(t.db, s.learner, deps, attemptId, RIGHT)).toMatchObject({ ok: true, snapshot: { status: 'terminal', assessment: { passed: true } } })
    } finally {
      await sql`RENAME TABLE lti_links_hidden TO lti_links`.execute(t.db)
    }
    expect(errors).toHaveLength(1)
    expect(await listMyProgress(t.db, s.learner)).toEqual([expect.objectContaining({ challengeId: quizId, passed: true })])
  })
})
