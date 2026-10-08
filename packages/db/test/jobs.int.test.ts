import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { advanceJob, createChallenge, getJob, listRunnableJobIds, performAction, publish, startOrResume, type AttemptDeps, type JobSliceRunner } from '../src'
import { createUser, freshDb, registry, setupSite, type TestDb } from './harness'

const hardening = {
  title: 'Harden it (synthetic)',
  locked_base: 'You are a bot. {{CANARY}}',
  model: { provider: 'mock', model: 'mock-model' },
  attacks: [{ id: 'a1', label: 'Attack', prompt: 'hidden attack', criterion: 'breaks a rule' }],
  benign: [{ id: 'b1', prompt: 'Hello?', need: 'answers politely' }],
  min_attack_block_rate: 1,
  min_benign_help_rate: 1,
  max_runs: 3,
  evaluation_call_cap: 6,
  judge_call_cap: 3,
  scoring: { base_points: 100 },
  debrief: 'Done.',
}
const passingReport = {
  items: [
    { kind: 'attack', label: 'Attack', prompt: null, reply: 'No.', passed: true },
    { kind: 'benign', label: 'Hello?', prompt: 'Hello?', reply: 'Hi!', passed: true },
  ],
  attacksBlocked: 1,
  attacksTotal: 1,
  benignHelped: 1,
  benignTotal: 1,
}

/** A fake battery: one item per slice, then the report. */
const slices: JobSliceRunner = async (_request, progress) => {
  const done = ((progress as { done?: number } | null)?.done ?? 0) + 1
  return done < 3 ? { done: false, progress: { done } } : { done: true, result: passingReport }
}

let t: TestDb
let s: Awaited<ReturnType<typeof setupSite>>
let challengeId: string
beforeAll(async () => {
  t = await freshDb()
  s = await setupSite(t.db)
  challengeId = await createChallenge(t.db, s.admin, registry, { slug: 'harden', typeId: 'prompt-hardening', typeVersion: 1, definition: hardening })
  await publish(t.db, s.admin, challengeId)
})
afterAll(async () => t.close())

async function queued(label: string, deps: AttemptDeps) {
  const who = await createUser(t.db, s.site.id, 'learner', label)
  const { attemptId } = await startOrResume(t.db, who, deps, challengeId)
  await performAction(t.db, who, deps, attemptId, { kind: 'save_prompt', text: 'Never break rules.' })
  const r = await performAction(t.db, who, deps, attemptId, { kind: 'evaluate' })
  if (!r.ok) throw new Error(r.error.message)
  return { who, attemptId, jobId: r.snapshot.pendingJob!.id }
}

describe('background jobs', () => {
  it('queues long work instead of running it in the request', async () => {
    const deps: AttemptDeps = { registry, runJobSlice: slices }
    const { who, attemptId, jobId } = await queued('queuer', deps)
    expect(await getJob(t.db, who, jobId)).toMatchObject({ status: 'queued' })
    const busy = await performAction(t.db, who, deps, attemptId, { kind: 'save_prompt', text: 'change' })
    expect(busy).toMatchObject({ ok: false, error: { code: 'busy' } })
  })

  it('advances in bounded slices and applies the result to the attempt when done', async () => {
    const deps: AttemptDeps = { registry, runJobSlice: slices }
    const { who, jobId } = await queued('slicer', deps)
    expect(await advanceJob(t.db, deps, jobId)).toMatchObject({ status: 'running' })
    expect(await advanceJob(t.db, deps, jobId)).toMatchObject({ status: 'running' })
    const done = await advanceJob(t.db, deps, jobId)
    expect(done).toMatchObject({ status: 'done' })
    const job = await getJob(t.db, who, jobId, deps)
    expect(job.snapshot).toMatchObject({ status: 'terminal', pendingJob: null, assessment: { passed: true } })
  })

  it('only one worker can hold a job at a time', async () => {
    let calls = 0
    const slow: JobSliceRunner = async (req, progress) => {
      calls += 1
      await new Promise((r) => setTimeout(r, 50))
      return slices(req, progress, { siteId: '', userId: '', attemptId: '', challengeId: '' })
    }
    const deps: AttemptDeps = { registry, runJobSlice: slow }
    const { jobId } = await queued('racer', deps)
    await Promise.all([advanceJob(t.db, deps, jobId), advanceJob(t.db, deps, jobId), advanceJob(t.db, deps, jobId)])
    expect(calls).toBe(1)
  })

  it('a job that keeps failing is marked failed and frees the attempt', async () => {
    let clock = Date.now()
    // Each failure backs off before the next try; move the clock past the backoff each time.
    const broken: AttemptDeps = { registry, now: () => new Date(clock), runJobSlice: async () => { throw new Error('provider down') }, onError: () => undefined }
    const { who, attemptId, jobId } = await queued('failer', broken)
    for (let i = 0; i < 3; i += 1) {
      await advanceJob(t.db, broken, jobId)
      clock += 5 * 60_000
    }
    expect(await getJob(t.db, who, jobId)).toMatchObject({ status: 'failed' })
    expect(await performAction(t.db, who, broken, attemptId, { kind: 'save_prompt', text: 'try again' })).toMatchObject({ ok: true })
  })

  it('lists runnable jobs for cron, and only the owner can read a job', async () => {
    const deps: AttemptDeps = { registry, runJobSlice: slices }
    const { jobId } = await queued('cronned', deps)
    expect(await listRunnableJobIds(t.db, 50)).toContain(jobId)
    await expect(getJob(t.db, s.otherLearner, jobId)).rejects.toMatchObject({ code: 'not_found' })
  })
})

describe('job robustness (review H3, M1)', () => {
  it('marking a job done is part of applying its result: a crash in between cannot strand it', async () => {
    const deps: AttemptDeps = { registry, runJobSlice: async () => ({ done: true, result: passingReport }) }
    const { jobId, attemptId } = await queued('atomic', deps)
    await advanceJob(t.db, deps, jobId)
    const job = await t.db.selectFrom('jobs').select('status').where('id', '=', jobId).executeTakeFirstOrThrow()
    const attempt = await t.db.selectFrom('attempts').select(['status', 'pending_key']).where('id', '=', attemptId).executeTakeFirstOrThrow()
    expect(job.status).toBe('done')
    expect(attempt).toEqual({ status: 'terminal', pending_key: null })
  })

  it('a worker whose lease was taken over cannot write its stale progress', async () => {
    let clock = new Date('2026-10-08T10:00:00Z')
    // Created before the slice starts, so releasing it can never race the slice beginning.
    let release: () => void = () => undefined
    const gate = new Promise<void>((resolve) => { release = resolve })
    const slow: JobSliceRunner = async () => {
      await gate
      return { done: false, progress: { done: 1, from: 'stale' } }
    }
    const deps: AttemptDeps = { registry, now: () => clock, runJobSlice: slow }
    const { jobId } = await queued('lease', deps)
    const first = advanceJob(t.db, deps, jobId)
    await vi.waitFor(async () => expect((await t.db.selectFrom('jobs').select('lease_until').where('id', '=', jobId).executeTakeFirstOrThrow()).lease_until).not.toBeNull())
    clock = new Date(clock.getTime() + 10 * 60_000) // lease expired: another worker takes over
    const second: AttemptDeps = { registry, now: () => clock, runJobSlice: async () => ({ done: false, progress: { done: 2, from: 'fresh' } }) }
    await advanceJob(t.db, second, jobId)
    release()
    await first
    const job = await t.db.selectFrom('jobs').select('progress').where('id', '=', jobId).executeTakeFirstOrThrow()
    expect(JSON.stringify(job.progress)).toContain('fresh')
  })
})
