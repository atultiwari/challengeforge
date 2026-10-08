import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  addAssignment,
  addCohortInstructor,
  cohortProgress,
  createChallenge,
  createCohort,
  createOrganisation,
  getAttempt,
  getAttemptForReview,
  isTeacher,
  joinCohort,
  listAssignments,
  listCohortMembers,
  listMyCohorts,
  listMyOrganisations,
  listOrgMembers,
  listReviewQueue,
  myCohortAssignments,
  normaliseJoinCode,
  overrideAssessment,
  performAction,
  publish,
  removeAssignment,
  removeCohortMember,
  removeOrgMember,
  setOrgMember,
  startOrResume,
  updateCohort,
  upsertPack,
  type AttemptDeps,
  type Scope,
} from '../src'
import { createUser, freshDb, registry, setupSite, type TestDb } from './harness'
import { quizMission, RIGHT } from './fixtures'

const reviewedMission = {
  title: 'Reviewed mission (synthetic)',
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
    req.kind === 'llm.chat' ? { text: 'reply' } : { correct: true, outcomes: [{ passed: true, message: 'ok' }], pointsPenalty: 0, foundIds: [] },
}

let t: TestDb
let s: Awaited<ReturnType<typeof setupSite>>
let orgId: string
let teacher: Scope
let orgAdmin: Scope
let quizId: string
let reviewedId: string
let packId: string
const emailOf = async (scope: Scope) => (await t.db.selectFrom('user').select('email').where('id', '=', scope.principal!.userId).executeTakeFirstOrThrow()).email

beforeAll(async () => {
  t = await freshDb()
  s = await setupSite(t.db)
  teacher = await createUser(t.db, s.site.id, 'learner', 'teacher')
  orgAdmin = await createUser(t.db, s.site.id, 'learner', 'org-admin')
  packId = await upsertPack(t.db, s.admin, { slug: 'course', title: 'Course pack', description: '' })
  quizId = await createChallenge(t.db, s.admin, registry, { slug: 'q', typeId: 'lab-legacy', typeVersion: 1, definition: quizMission, packId })
  reviewedId = await createChallenge(t.db, s.admin, registry, { slug: 'r', typeId: 'chat-mission', typeVersion: 1, definition: reviewedMission })
  await publish(t.db, s.admin, quizId)
  await publish(t.db, s.admin, reviewedId)
})
afterAll(async () => t.close())

describe('organisations', () => {
  it('site admins create organisations and name org admins; org admins add instructors', async () => {
    await expect(createOrganisation(t.db, s.author, { slug: 'med', name: 'Medical school' })).rejects.toMatchObject({ code: 'forbidden' })
    orgId = (await createOrganisation(t.db, s.admin, { slug: 'med', name: 'Medical school' })).id
    await expect(createOrganisation(t.db, s.admin, { slug: 'med', name: 'Again' })).rejects.toMatchObject({ code: 'invalid' })
    await setOrgMember(t.db, s.admin, orgId, await emailOf(orgAdmin), 'org_admin')
    await setOrgMember(t.db, orgAdmin, orgId, await emailOf(teacher), 'instructor')
    expect(await isTeacher(t.db, teacher)).toBe(true)
    expect(await isTeacher(t.db, s.learner)).toBe(false)
    expect((await listMyOrganisations(t.db, teacher)).map((o) => o.role)).toEqual(['instructor'])
    expect((await listOrgMembers(t.db, teacher, orgId)).map((m) => m.role).sort()).toEqual(['instructor', 'org_admin'])
  })

  it('org admins cannot create or remove other org admins; outsiders see nothing', async () => {
    await expect(setOrgMember(t.db, orgAdmin, orgId, await emailOf(s.learner), 'org_admin')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(removeOrgMember(t.db, orgAdmin, orgId, orgAdmin.principal!.userId)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(setOrgMember(t.db, teacher, orgId, await emailOf(s.learner), 'instructor')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(listOrgMembers(t.db, s.learner, orgId)).rejects.toMatchObject({ code: 'not_found' })
    const other = await setupSite(t.db, 'cohort-other')
    await expect(listOrgMembers(t.db, other.admin, orgId)).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('cohorts', () => {
  let cohortId: string
  let code: string

  it('an instructor creates a cohort, assigns work, and learners join by code', async () => {
    const cohort = await createCohort(t.db, teacher, orgId, 'Year 3, 2026')
    cohortId = cohort.id
    code = cohort.joinCode
    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    await expect(createCohort(t.db, s.learner, orgId, 'Nope')).rejects.toMatchObject({ code: 'not_found' })

    await addAssignment(t.db, teacher, cohortId, { packId, dueAt: new Date('2026-01-01T00:00:00Z') })
    await addAssignment(t.db, teacher, cohortId, { challengeId: reviewedId })
    await expect(addAssignment(t.db, teacher, cohortId, { challengeId: reviewedId })).rejects.toMatchObject({ code: 'invalid' })
    await expect(addAssignment(t.db, s.learner, cohortId, { challengeId: quizId })).rejects.toMatchObject({ code: 'not_found' })

    const joined = await joinCohort(t.db, s.learner, ` ${code.slice(0, 4).toLowerCase()}-${code.slice(4)} `)
    expect(joined.id).toBe(cohortId)
    await joinCohort(t.db, s.learner, code) // twice: no-op
    expect(normaliseJoinCode('ab-cd ef')).toBe('ABCDEF')
    expect((await listMyCohorts(t.db, s.learner)).learning.map((c) => c.id)).toEqual([cohortId])
    expect((await listMyCohorts(t.db, teacher)).teaching.map((c) => c.id)).toEqual([cohortId])
    expect((await listAssignments(t.db, s.learner, cohortId)).map((a) => a.title)).toEqual(['Course pack', 'Reviewed mission (synthetic)'])
    await expect(listCohortMembers(t.db, s.learner, cohortId)).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('a closed or rotated code stops new joins, with one message for every refusal', async () => {
    await updateCohort(t.db, teacher, cohortId, { joiningOpen: false })
    const closed = await joinCohort(t.db, s.otherLearner, code).catch((e: Error) => e.message)
    const unknown = await joinCohort(t.db, s.otherLearner, 'ZZZZZZZZ').catch((e: Error) => e.message)
    expect(closed).toBe(unknown)
    const rotated = await updateCohort(t.db, teacher, cohortId, { joiningOpen: true, rotateCode: true })
    expect(rotated.joinCode).not.toBe(code)
    await expect(joinCohort(t.db, s.otherLearner, code)).rejects.toMatchObject({ code: 'invalid' })
    await joinCohort(t.db, s.otherLearner, rotated.joinCode)
  })

  it('the grid shows each learner against each assigned challenge, packs expanded, lateness included', async () => {
    const { attemptId } = await startOrResume(t.db, s.learner, { registry }, quizId)
    await performAction(t.db, s.learner, { registry }, attemptId, RIGHT)
    const grid = await cohortProgress(t.db, teacher, cohortId, new Date('2026-06-01T00:00:00Z'))
    expect(grid.columns.map((c) => c.challengeId)).toEqual([quizId, reviewedId])
    const row = grid.rows.find((r) => r.userId === s.learner.principal!.userId)!
    expect(row.cells[quizId]).toMatchObject({ passed: true, late: true })
    expect(row.cells[reviewedId]).toMatchObject({ passed: false, attempts: 0, late: false })
    expect(row.passedCount).toBe(1)
    expect(grid.rows.find((r) => r.userId === s.otherLearner.principal!.userId)!.cells[quizId]).toMatchObject({ passed: false, late: true })
    await expect(cohortProgress(t.db, s.learner, cohortId)).rejects.toMatchObject({ code: 'forbidden' })
    expect((await myCohortAssignments(t.db, s.learner, cohortId)).map((a) => a.passed)).toEqual([true, false])
  })

  it('instructors review only their own cohort\'s learners on assigned challenges', async () => {
    const outsider = await createUser(t.db, s.site.id, 'learner', 'not-in-cohort')
    const finish = async (who: Scope) => {
      const { attemptId } = await startOrResume(t.db, who, deps, reviewedId)
      await performAction(t.db, who, deps, attemptId, { kind: 'send', text: 'hi' })
      await performAction(t.db, who, deps, attemptId, { kind: 'finish' })
      return attemptId
    }
    const mine = await finish(s.learner)
    const notMine = await finish(outsider)
    expect((await listReviewQueue(t.db, teacher)).map((r) => r.attemptId)).toEqual([mine])
    expect((await listReviewQueue(t.db, s.admin)).map((r) => r.attemptId).sort()).toEqual([mine, notMine].sort())
    await expect(getAttempt(t.db, teacher, deps, notMine)).rejects.toMatchObject({ code: 'not_found' })
    await expect(overrideAssessment(t.db, teacher, notMine, { passed: false, points: 0 })).rejects.toMatchObject({ code: 'not_found' })
    expect((await getAttempt(t.db, teacher, deps, mine)).status).toBe('terminal')
    await overrideAssessment(t.db, teacher, mine, { passed: false, points: 0 })
    await expect(listReviewQueue(t.db, s.learner)).rejects.toMatchObject({ code: 'forbidden' })
    // The learner reads their own attempt, but never as a reviewer.
    expect((await getAttempt(t.db, s.learner, deps, mine)).attemptId).toBe(mine)
    await expect(getAttemptForReview(t.db, s.learner, deps, mine)).rejects.toMatchObject({ code: 'not_found' })
    expect((await getAttemptForReview(t.db, teacher, deps, mine)).attemptId).toBe(mine)
  })

  it('removing a learner or an assignment ends the instructor\'s reach', async () => {
    const coTeacher = await createUser(t.db, s.site.id, 'learner', 'co-teacher')
    await expect(addCohortInstructor(t.db, teacher, cohortId, await emailOf(coTeacher))).rejects.toMatchObject({ code: 'invalid' })
    await setOrgMember(t.db, orgAdmin, orgId, await emailOf(coTeacher), 'instructor')
    await addCohortInstructor(t.db, teacher, cohortId, await emailOf(coTeacher))
    expect((await listMyCohorts(t.db, coTeacher)).teaching.map((c) => c.id)).toEqual([cohortId])

    await removeCohortMember(t.db, teacher, cohortId, s.otherLearner.principal!.userId)
    expect((await cohortProgress(t.db, teacher, cohortId)).rows.map((r) => r.userId)).toEqual([s.learner.principal!.userId])
    const assignment = (await listAssignments(t.db, teacher, cohortId)).find((a) => a.challengeId === reviewedId)!
    await removeAssignment(t.db, teacher, cohortId, assignment.id)
    expect((await cohortProgress(t.db, teacher, cohortId)).columns.map((c) => c.challengeId)).toEqual([quizId])
    await expect(removeCohortMember(t.db, teacher, cohortId, teacher.principal!.userId)).rejects.toMatchObject({ code: 'invalid' })
  })

  it('demoting or removing an instructor ends their reach into the organisation\'s cohorts (review)', async () => {
    const former = await createUser(t.db, s.site.id, 'learner', 'former-teacher')
    await setOrgMember(t.db, orgAdmin, orgId, await emailOf(former), 'instructor')
    const own = await createCohort(t.db, former, orgId, 'Their own class')
    await addCohortInstructor(t.db, former, cohortId, await emailOf(teacher)).catch(() => undefined)
    expect((await listMyCohorts(t.db, former)).teaching.map((c) => c.id)).toContain(own.id)
    await setOrgMember(t.db, orgAdmin, orgId, await emailOf(former), 'member')
    expect((await listMyCohorts(t.db, former)).teaching).toEqual([])
    await expect(cohortProgress(t.db, former, own.id)).rejects.toMatchObject({ code: 'not_found' })

    const leaver = await createUser(t.db, s.site.id, 'learner', 'leaver')
    await setOrgMember(t.db, orgAdmin, orgId, await emailOf(leaver), 'instructor')
    const theirs = await createCohort(t.db, leaver, orgId, 'Leaver class')
    await removeOrgMember(t.db, orgAdmin, orgId, leaver.principal!.userId)
    await expect(listCohortMembers(t.db, leaver, theirs.id)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('org admins manage every cohort of their organisation', async () => {
    expect((await listMyCohorts(t.db, orgAdmin)).teaching.map((c) => c.id)).toContain(cohortId)
    await updateCohort(t.db, orgAdmin, cohortId, { archived: true })
    expect((await listMyCohorts(t.db, s.learner)).learning).toEqual([])
  })
})
