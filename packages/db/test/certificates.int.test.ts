import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createChallenge,
  listAudit,
  listCertificates,
  listMyCertificates,
  newCertificateId,
  overrideAssessment,
  performAction,
  publish,
  revokeCertificate,
  setCertificatesEnabled,
  startOrResume,
  upsertPack,
  verifyCertificate,
  type AttemptDeps,
  type Scope,
} from '../src'
import { createUser, freshDb, registry, setupSite, type TestDb } from './harness'
import { quizMission, RIGHT, WRONG } from './fixtures'

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
let packId: string
let quizA: string
let quizB: string

async function pass(who: Scope, challengeId: string) {
  const { attemptId } = await startOrResume(t.db, who, { registry }, challengeId)
  await performAction(t.db, who, { registry }, attemptId, RIGHT)
}

beforeAll(async () => {
  t = await freshDb()
  s = await setupSite(t.db)
  packId = await upsertPack(t.db, s.admin, { slug: 'cert', title: 'Certified pack', description: '' })
  quizA = await createChallenge(t.db, s.admin, registry, { slug: 'a', typeId: 'lab-legacy', typeVersion: 1, definition: quizMission, packId })
  quizB = await createChallenge(t.db, s.admin, registry, { slug: 'b', typeId: 'lab-legacy', typeVersion: 1, definition: quizMission, packId })
  await publish(t.db, s.admin, quizA)
  await publish(t.db, s.admin, quizB)
})
afterAll(async () => t.close())

describe('certificates', () => {
  it('ids are random, lowercase and unambiguous', () => {
    const ids = new Set(Array.from({ length: 200 }, newCertificateId))
    expect(ids.size).toBe(200)
    for (const id of ids) expect(id).toMatch(/^[a-hjkmnp-z2-9]{20}$/)
  })

  it('turning certificates on issues them to people who already finished the pack', async () => {
    const early = await createUser(t.db, s.site.id, 'learner', 'Early Bird')
    await pass(early, quizA)
    await pass(early, quizB)
    expect(await listMyCertificates(t.db, early)).toEqual([])
    await expect(setCertificatesEnabled(t.db, s.author, packId, true)).rejects.toMatchObject({ code: 'forbidden' })
    expect(await setCertificatesEnabled(t.db, s.admin, packId, true)).toBe(1)
    const [cert] = await listMyCertificates(t.db, early)
    expect(cert).toMatchObject({ recipientName: 'Early Bird', packTitle: 'Certified pack', siteName: 'Site main', challengeCount: 2, revokedAt: null })
    expect(await setCertificatesEnabled(t.db, s.admin, packId, true)).toBe(0) // never twice
  })

  it('the pass that completes the pack issues the certificate; a fail or a partial pack does not', async () => {
    const who = await createUser(t.db, s.site.id, 'learner', 'Steady')
    await pass(who, quizA)
    const { attemptId } = await startOrResume(t.db, who, { registry }, quizB)
    await performAction(t.db, who, { registry }, attemptId, WRONG)
    expect(await listMyCertificates(t.db, who)).toEqual([])
    await pass(who, quizB)
    expect(await listMyCertificates(t.db, who)).toHaveLength(1)
  })

  it('a result waiting for review does not count until a reviewer passes it', async () => {
    const reviewed = await createChallenge(t.db, s.admin, registry, { slug: 'r', typeId: 'chat-mission', typeVersion: 1, definition: reviewedMission, packId })
    await publish(t.db, s.admin, reviewed)
    const who = await createUser(t.db, s.site.id, 'learner', 'Patient')
    await pass(who, quizA)
    await pass(who, quizB)
    const { attemptId } = await startOrResume(t.db, who, deps, reviewed)
    await performAction(t.db, who, deps, attemptId, { kind: 'send', text: 'hi' })
    await performAction(t.db, who, deps, attemptId, { kind: 'finish' })
    expect(await listMyCertificates(t.db, who)).toEqual([])
    await overrideAssessment(t.db, s.admin, attemptId, { passed: true, points: 100 })
    expect((await listMyCertificates(t.db, who)).map((c) => c.challengeCount)).toEqual([3])
  })

  it('anyone with the id can verify it; a revoked one says why; bad ids find nothing', async () => {
    const all = await listCertificates(t.db, s.admin)
    const id = all[0]!.id
    expect(await verifyCertificate(t.db, s.site.id, id)).toMatchObject({ id, revokedAt: null })
    expect(await verifyCertificate(t.db, s.site.id, 'not-a-valid-id!')).toBeNull()
    const other = await setupSite(t.db, 'cert-other')
    expect(await verifyCertificate(t.db, other.site.id, id)).toBeNull()
    await expect(revokeCertificate(t.db, s.admin, id, ' ')).rejects.toMatchObject({ code: 'invalid' })
    await revokeCertificate(t.db, s.admin, id, 'Issued in error.')
    expect(await verifyCertificate(t.db, s.site.id, id)).toMatchObject({ revokeReason: 'Issued in error.' })
    await expect(revokeCertificate(t.db, s.admin, id, 'Again.')).rejects.toMatchObject({ code: 'not_found' })
    expect((await listAudit(t.db, s.admin)).some((e) => e.action === 'certificate.revoked' && e.targetId === id)).toBe(true)
  })
})
