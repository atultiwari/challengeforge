import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createChallenge, getLrsEndpoint, performAction, publish, saveLrsEndpoint, siteLearningFacts, startOrResume, upsertPack } from '@challengeforge/db'
import { pushToLrs, seal, statementFor, type FetchLike, type Statement } from '../src'
import { freshDb, registry, setupSite, type TestDb } from '../../db/test/harness'

// Synthetic values only.
const SECRET = 'test-only-secret-for-xapi-sealing-0123456789'
const quiz = {
  title: 'xAPI quiz (synthetic)',
  story_brief: 'Pick b.',
  interaction: 'scenario_quiz',
  interaction_config: { options: ['a', 'b'] },
  rule: { type: 'exact', field: 'answer', expected: 'b' },
  scoring: { base_points: 100, hint_costs: [], wrong_attempt_penalty: 0, reveal_after_attempts: null },
  hints: [],
  debrief: 'Done.',
}

let t: TestDb
let s: Awaited<ReturnType<typeof setupSite>>
let challengeId: string
/** Past the push's lag window, so just-created facts are due. */
const later = () => new Date(Date.now() + 120_000)
beforeAll(async () => {
  t = await freshDb()
  s = await setupSite(t.db)
  const packId = await upsertPack(t.db, s.admin, { slug: 'xapi-pack', title: 'xAPI pack', description: '' })
  challengeId = await createChallenge(t.db, s.admin, registry, { slug: 'xq', typeId: 'lab-legacy', typeVersion: 1, definition: quiz, packId })
  await publish(t.db, s.admin, challengeId)
  const { attemptId } = await startOrResume(t.db, s.learner, { registry }, challengeId)
  await performAction(t.db, s.learner, { registry }, attemptId, { kind: 'submit', payload: { answer: 'b' } })
})
afterAll(async () => t.close())

describe('xAPI', () => {
  it('turns facts into statements that identify learners by account, never email', async () => {
    const facts = await siteLearningFacts(t.db, s.admin)
    expect(facts.map((f) => f.kind)).toEqual(['attempted', 'result'])
    const [attempted, passed] = facts.map((f) => statementFor(f, 'https://site.test'))
    expect(attempted!.verb.id).toBe('http://adlnet.gov/expapi/verbs/attempted')
    expect(passed).toMatchObject({
      actor: { account: { homePage: 'https://site.test', name: s.learner.principal!.userId } },
      verb: { id: 'http://adlnet.gov/expapi/verbs/passed' },
      object: { id: `https://site.test/play/${challengeId}` },
      result: { success: true, completion: true, score: { scaled: 1 } },
      context: { contextActivities: { grouping: [{ id: 'https://site.test/packs/xapi-pack' }] } },
    })
    expect(JSON.stringify(facts.map((f) => statementFor(f, 'https://site.test')))).not.toContain('@')
    expect(statementFor(facts[1]!, 'https://site.test').id).toBe(passed!.id)
    expect(passed!.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    await expect(siteLearningFacts(t.db, s.author)).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('pushes new statements to the LRS once, with its credentials, and records failures', async () => {
    await saveLrsEndpoint(t.db, s.admin, { endpoint: 'https://lrs.example.test/xapi', username: 'key-1', secretSealed: seal('lrs-secret', SECRET) })
    const received: { url: string; headers: Record<string, string>; statements: Statement[] }[] = []
    const lrs: FetchLike = async (url, init) => {
      received.push({ url, headers: init.headers, statements: JSON.parse(init.body) as Statement[] })
      return { ok: true, status: 200, json: async () => [] }
    }
    expect(await pushToLrs(t.db, SECRET, 'https://site.test', { fetchImpl: lrs, now: later() })).toEqual({ sent: 2, failed: 0 })
    expect(received[0]!.url).toBe('https://lrs.example.test/xapi/statements')
    expect(received[0]!.headers['x-experience-api-version']).toBe('1.0.3')
    expect(received[0]!.headers['authorization']).toBe(`Basic ${Buffer.from('key-1:lrs-secret').toString('base64')}`)
    expect(await pushToLrs(t.db, SECRET, 'https://site.test', { fetchImpl: lrs, now: later() })).toEqual({ sent: 0, failed: 0 })

    const { attemptId } = await startOrResume(t.db, s.otherLearner, { registry }, challengeId)
    await performAction(t.db, s.otherLearner, { registry }, attemptId, { kind: 'submit', payload: { answer: 'b' } })
    const down: FetchLike = async () => ({ ok: false, status: 503, json: async () => ({}) })
    expect(await pushToLrs(t.db, SECRET, 'https://site.test', { fetchImpl: down, now: later() })).toEqual({ sent: 0, failed: 1 })
    expect((await getLrsEndpoint(t.db, s.admin))?.lastError).toBe('The LRS answered HTTP 503.')
    expect(await pushToLrs(t.db, SECRET, 'https://site.test', { fetchImpl: lrs, now: later() })).toEqual({ sent: 2, failed: 0 })
    expect(received.at(-1)!.statements.every((st) => st.actor.account.name === s.otherLearner.principal!.userId)).toBe(true)
  })

  it('refuses an LRS on an unsafe address', async () => {
    await expect(saveLrsEndpoint(t.db, s.admin, { endpoint: 'http://lrs.example.test/', username: 'k', secretSealed: 'x' })).rejects.toMatchObject({ code: 'invalid' })
  })

  it('one statement the LRS refuses is skipped, not retried forever (review)', async () => {
    const { attemptId } = await startOrResume(t.db, s.author, { registry }, challengeId)
    await performAction(t.db, s.author, { registry }, attemptId, { kind: 'submit', payload: { answer: 'b' } })
    const picky: FetchLike = async (_url, init) => {
      const batch = JSON.parse(init.body) as Statement[]
      const bad = batch.some((st) => st.verb.id.endsWith('/attempted'))
      return { ok: !bad, status: bad ? 400 : 200, json: async () => [] }
    }
    expect(await pushToLrs(t.db, SECRET, 'https://site.test', { fetchImpl: picky, now: later() })).toEqual({ sent: 1, failed: 0 })
    expect((await getLrsEndpoint(t.db, s.admin))?.lastError).toMatch(/refused 1 statement/)
    expect(await pushToLrs(t.db, SECRET, 'https://site.test', { fetchImpl: picky, now: later() })).toEqual({ sent: 0, failed: 0 })
  })

  it('facts younger than the lag window wait for the next run', async () => {
    const { attemptId } = await startOrResume(t.db, s.anonymous.principal ? s.anonymous : s.otherAuthor, { registry }, challengeId)
    void attemptId
    const lrs: FetchLike = async () => ({ ok: true, status: 200, json: async () => [] })
    expect(await pushToLrs(t.db, SECRET, 'https://site.test', { fetchImpl: lrs, now: new Date() })).toEqual({ sent: 0, failed: 0 })
    expect((await pushToLrs(t.db, SECRET, 'https://site.test', { fetchImpl: lrs, now: later() })).sent).toBe(1)
  })
})
