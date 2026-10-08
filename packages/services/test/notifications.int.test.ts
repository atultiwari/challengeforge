import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createChallenge, createCohort, createOrganisation, joinCohort, overrideAssessment, performAction, publish, setMailPreferences, setOrgMember, startOrResume, type AttemptDeps, type Scope } from '@challengeforge/db'
import { createMailer, sendDueNotifications, type MailMessage } from '../src'
import { createUser, freshDb, registry, setupSite, type TestDb } from '../../db/test/harness'

const reviewed = {
  title: 'Reviewed (synthetic)',
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
  runService: async (req) => (req.kind === 'llm.chat' ? { text: 'reply' } : { correct: true, outcomes: [{ passed: true, message: 'ok' }], pointsPenalty: 0, foundIds: [] }),
}

let t: TestDb
let s: Awaited<ReturnType<typeof setupSite>>
beforeAll(async () => {
  t = await freshDb()
  s = await setupSite(t.db)
})
afterAll(async () => t.close())

const capture = () => {
  const sent: MailMessage[] = []
  return { sent, mailer: createMailer({ mode: 'smtp', host: 'h', port: 465, secure: true, from: 'x@y.test' }, { smtpSend: async (m) => void sent.push(m) }) }
}
const emailOf = async (scope: Scope) => (await t.db.selectFrom('user').select('email').where('id', '=', scope.principal!.userId).executeTakeFirstOrThrow()).email

describe('notifications', () => {
  it('a reviewed result and a joined cohort each send one email, with a link back', async () => {
    const challengeId = await createChallenge(t.db, s.admin, registry, { slug: 'r', typeId: 'chat-mission', typeVersion: 1, definition: reviewed })
    await publish(t.db, s.admin, challengeId)
    const { attemptId } = await startOrResume(t.db, s.learner, deps, challengeId)
    await performAction(t.db, s.learner, deps, attemptId, { kind: 'send', text: 'hi' })
    await performAction(t.db, s.learner, deps, attemptId, { kind: 'finish' })
    await overrideAssessment(t.db, s.admin, attemptId, { passed: true, points: 100 })

    const teacher = await createUser(t.db, s.site.id, 'learner', 'notify-teacher')
    const org = await createOrganisation(t.db, s.admin, { slug: 'notify-org', name: 'Notify org' })
    await setOrgMember(t.db, s.admin, org.id, await emailOf(teacher), 'instructor')
    const cohort = await createCohort(t.db, teacher, org.id, 'Notify cohort')
    await joinCohort(t.db, s.learner, cohort.joinCode)

    const { sent, mailer } = capture()
    expect(await sendDueNotifications(t.db, mailer, 'https://site.test')).toEqual({ sent: 2, skipped: 0, failed: 0 })
    expect(sent.map((m) => m.subject).sort()).toEqual(['You joined Notify cohort', 'Your result on Reviewed (synthetic) was reviewed'])
    expect(sent.every((m) => m.to === sent[0]!.to && m.text.includes('https://site.test/account'))).toBe(true)
    expect(sent.find((m) => m.subject.startsWith('You joined'))!.text).toContain(`https://site.test/cohorts/${cohort.id}`)
    expect(await sendDueNotifications(t.db, mailer, 'https://site.test')).toEqual({ sent: 0, skipped: 0, failed: 0 })
  })

  it('people who turned updates off, and sites without mail, get nothing; failures retry later', async () => {
    const quiet = await createUser(t.db, s.site.id, 'learner', 'quiet')
    await setMailPreferences(t.db, quiet, { updates: false })
    const teacher = await createUser(t.db, s.site.id, 'learner', 'notify-teacher-2')
    const org = await createOrganisation(t.db, s.admin, { slug: 'notify-org-2', name: 'Notify org 2' })
    await setOrgMember(t.db, s.admin, org.id, await emailOf(teacher), 'instructor')
    const cohort = await createCohort(t.db, teacher, org.id, 'Quiet cohort')
    await joinCohort(t.db, quiet, cohort.joinCode)
    await joinCohort(t.db, s.otherLearner, cohort.joinCode)

    const down = createMailer({ mode: 'smtp', host: 'h', port: 465, secure: true, from: 'x@y.test' }, { smtpSend: async () => { throw new Error('SMTP down') } })
    expect(await sendDueNotifications(t.db, down, 'https://site.test')).toEqual({ sent: 0, skipped: 1, failed: 1 })
    expect(await sendDueNotifications(t.db, down, 'https://site.test')).toEqual({ sent: 0, skipped: 0, failed: 0 })
    const row = await t.db.selectFrom('notifications').select(['status', 'failures', 'last_error']).where('user_id', '=', s.otherLearner.principal!.userId).executeTakeFirstOrThrow()
    expect(row).toEqual({ status: 'pending', failures: 1, last_error: 'SMTP down' })
  })
})
