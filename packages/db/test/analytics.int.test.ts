import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  addAssignment,
  addCollaborator,
  challengeAnalytics,
  cohortAnalytics,
  createChallenge,
  createCohort,
  createOrganisation,
  joinCohort,
  median,
  packAnalytics,
  performAction,
  publish,
  setOrgMember,
  startOrResume,
  upsertPack,
  type Scope,
} from '../src'
import { createUser, freshDb, registry, setupSite, type TestDb } from './harness'
import { quizMission, RIGHT, WRONG } from './fixtures'

/** One submission per attempt, so a wrong answer FINISHES the attempt as a fail. */
const oneShot = { ...quizMission, scoring: { ...quizMission.scoring, max_attempts: 1, reveal_after_attempts: null } }

let t: TestDb
let s: Awaited<ReturnType<typeof setupSite>>
let packId: string
let quizId: string
const emailOf = async (scope: Scope) => (await t.db.selectFrom('user').select('email').where('id', '=', scope.principal!.userId).executeTakeFirstOrThrow()).email

async function play(who: Scope, answer: typeof RIGHT) {
  const { attemptId } = await startOrResume(t.db, who, { registry }, quizId)
  await performAction(t.db, who, { registry }, attemptId, answer)
}

beforeAll(async () => {
  t = await freshDb()
  s = await setupSite(t.db)
  packId = await upsertPack(t.db, s.admin, { slug: 'stats', title: 'Stats pack', description: '' })
  quizId = await createChallenge(t.db, s.author, registry, { slug: 'q', typeId: 'lab-legacy', typeVersion: 1, definition: oneShot, packId })
  await publish(t.db, s.admin, quizId)
})
afterAll(async () => t.close())

describe('analytics', () => {
  it('median handles odd, even and empty lists', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
    expect(median([])).toBeNull()
  })

  it('counts attempts, passes and misses per challenge, ignoring previews', async () => {
    const a = await createUser(t.db, s.site.id, 'learner', 'stats-a')
    const b = await createUser(t.db, s.site.id, 'learner', 'stats-b')
    await play(a, WRONG)
    await play(a, RIGHT)
    await play(b, WRONG)
    await startOrResume(t.db, s.author, { registry }, quizId, { preview: true })
    const stats = await challengeAnalytics(t.db, s.author, quizId)
    expect(stats).toMatchObject({ learners: 2, attempts: 3, finished: 3, passedAttempts: 1, learnersPassed: 1, pendingReview: 0 })
    expect(stats.passRate).toBeCloseTo(1 / 3)
    expect(stats.medianMinutes).not.toBeNull()
    expect(stats.criteria[0]).toMatchObject({ assessed: 3, missed: 2 })
    expect(stats.criteria[0]!.missRate).toBeCloseTo(2 / 3)
  })

  it('authors see their own challenges (and co-authored ones), editors see packs', async () => {
    await expect(challengeAnalytics(t.db, s.otherAuthor, quizId)).rejects.toMatchObject({ code: 'forbidden' })
    await addCollaborator(t.db, s.author, quizId, await emailOf(s.otherAuthor))
    expect((await challengeAnalytics(t.db, s.otherAuthor, quizId)).attempts).toBe(3)
    await expect(packAnalytics(t.db, s.author, packId)).rejects.toMatchObject({ code: 'forbidden' })
    const pack = await packAnalytics(t.db, s.admin, packId)
    expect(pack).toMatchObject({ packTitle: 'Stats pack', challenges: [expect.objectContaining({ challengeId: quizId, attempts: 3 })] })
    await expect(challengeAnalytics(t.db, s.learner, quizId)).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('instructors see only their cohort\'s learners on its assigned challenges', async () => {
    const teacher = await createUser(t.db, s.site.id, 'learner', 'stats-teacher')
    const student = await createUser(t.db, s.site.id, 'learner', 'stats-student')
    const org = await createOrganisation(t.db, s.admin, { slug: 'stats-org', name: 'Stats org' })
    await setOrgMember(t.db, s.admin, org.id, await emailOf(teacher), 'instructor')
    const cohort = await createCohort(t.db, teacher, org.id, 'Stats cohort')
    expect(await cohortAnalytics(t.db, teacher, cohort.id)).toEqual([])
    await addAssignment(t.db, teacher, cohort.id, { packId })
    await joinCohort(t.db, student, cohort.joinCode)
    await play(student, RIGHT)
    const [stats] = await cohortAnalytics(t.db, teacher, cohort.id)
    expect(stats).toMatchObject({ challengeId: quizId, learners: 1, attempts: 1, passRate: 1 })
    await expect(cohortAnalytics(t.db, student, cohort.id)).rejects.toMatchObject({ code: 'forbidden' })
  })
})
