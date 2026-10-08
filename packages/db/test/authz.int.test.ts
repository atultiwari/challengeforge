/**
 * The authorisation matrix (PLAN.md §6.3): every repository operation is run
 * as the wrong person and must refuse. This replaces Postgres RLS as the
 * safety net, so a new repository function should add rows here.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  archive,
  createChallenge,
  getAssetForPlay,
  getAttempt,
  getForAuthoring,
  getPlayable,
  listForAuthoring,
  listMembers,
  listPlayable,
  performAction,
  publish,
  putAsset,
  saveDraftVersion,
  setRole,
  startOrResume,
  submitForReview,
  upsertPack,
  type Scope,
} from '../src'
import { freshDb, registry, setupSite, type TestDb } from './harness'
import { RIGHT, quizMission } from './fixtures'

let t: TestDb
let s: Awaited<ReturnType<typeof setupSite>>
let other: Awaited<ReturnType<typeof setupSite>>
let published: string
let draft: string
const deps = () => ({ registry })

beforeAll(async () => {
  t = await freshDb()
  s = await setupSite(t.db, 'main')
  other = await setupSite(t.db, 'other')
  published = await createChallenge(t.db, s.author, registry, { slug: 'pub', typeId: 'lab-legacy', typeVersion: 1, definition: quizMission })
  await publish(t.db, s.admin, published)
  draft = await createChallenge(t.db, s.author, registry, { slug: 'draft', typeId: 'lab-legacy', typeVersion: 1, definition: quizMission })
})
afterAll(async () => t.close())

const forbidden = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: 'forbidden' })
const notFound = (p: Promise<unknown>) => expect(p).rejects.toMatchObject({ code: 'not_found' })

describe('content', () => {
  it('learners and anonymous users cannot create, edit or publish', async () => {
    for (const who of [s.learner, s.anonymous]) {
      await forbidden(createChallenge(t.db, who, registry, { slug: 'x', typeId: 'lab-legacy', typeVersion: 1, definition: quizMission }))
      await forbidden(saveDraftVersion(t.db, who, registry, draft, quizMission))
      await forbidden(publish(t.db, who, draft))
      await forbidden(upsertPack(t.db, who, { slug: 'p', title: 'p', description: '' }))
    }
  })

  it("an author cannot touch another author's challenge, or publish their own", async () => {
    await forbidden(saveDraftVersion(t.db, s.otherAuthor, registry, draft, quizMission))
    await forbidden(getForAuthoring(t.db, s.otherAuthor, draft))
    await forbidden(submitForReview(t.db, s.otherAuthor, draft))
    await forbidden(publish(t.db, s.author, draft))
    await forbidden(archive(t.db, s.author, draft))
    expect((await listForAuthoring(t.db, s.otherAuthor)).map((c) => c.id)).not.toContain(draft)
  })

  it('learners never see drafts', async () => {
    expect((await listPlayable(t.db, s.learner)).map((c) => c.id)).toEqual([published])
    await notFound(getPlayable(t.db, s.learner, draft))
    await notFound(startOrResume(t.db, s.learner, deps(), draft))
  })

  it('nothing crosses sites', async () => {
    expect(await listPlayable(t.db, other.learner)).toEqual([])
    await notFound(getPlayable(t.db, other.learner, published))
    await notFound(startOrResume(t.db, other.learner, deps(), published))
    await notFound(publish(t.db, other.admin, draft))
    await notFound(getForAuthoring(t.db, other.admin, draft))
  })
})

describe('attempts', () => {
  it('only the owner can act on an attempt; others get "not found", not "forbidden"', async () => {
    const mine = await startOrResume(t.db, s.learner, deps(), published)
    await notFound(performAction(t.db, s.otherLearner, deps(), mine.attemptId, RIGHT))
    await notFound(getAttempt(t.db, s.otherLearner, deps(), mine.attemptId))
    await notFound(performAction(t.db, other.admin, deps(), mine.attemptId, RIGHT))
    await forbidden(performAction(t.db, s.anonymous, deps(), mine.attemptId, RIGHT))
  })

  it('an admin may read (not act on) an attempt to review it', async () => {
    const mine = await startOrResume(t.db, s.learner, deps(), published)
    expect((await getAttempt(t.db, s.admin, deps(), mine.attemptId)).attemptId).toBe(mine.attemptId)
    await notFound(performAction(t.db, s.admin, deps(), mine.attemptId, RIGHT))
  })

  it('anonymous users cannot start attempts', async () => {
    await forbidden(startOrResume(t.db, s.anonymous, deps(), published))
  })

  it('only the author (or an admin) can preview a draft', async () => {
    await forbidden(startOrResume(t.db, s.otherAuthor, deps(), draft, { preview: true }))
    await forbidden(startOrResume(t.db, s.learner, deps(), draft, { preview: true }))
    expect((await startOrResume(t.db, s.author, deps(), draft, { preview: true })).isPreview).toBe(true)
  })
})

describe('members and assets', () => {
  it('only admins list members or change roles; nobody can demote themselves', async () => {
    await forbidden(listMembers(t.db, s.author))
    await forbidden(setRole(t.db, s.author, s.learner.principal!.userId, 'admin'))
    await forbidden(setRole(t.db, s.admin, s.admin.principal!.userId, 'learner'))
    await notFound(setRole(t.db, other.admin, s.learner.principal!.userId, 'author'))
  })

  it('learners read assets of published challenges only, never gated ones', async () => {
    await putAsset(t.db, s.admin, { challengeId: published, path: 'data/open.json', contentType: 'application/json', visibility: 'public', bytes: Buffer.from('{}') })
    await putAsset(t.db, s.admin, { challengeId: published, path: 'data/secret.png', contentType: 'image/png', visibility: 'gated', bytes: Buffer.from('x') })
    await putAsset(t.db, s.admin, { challengeId: draft, path: 'data/draft.json', contentType: 'application/json', visibility: 'public', bytes: Buffer.from('{}') })
    expect((await getAssetForPlay(t.db, s.learner, published, 'data/open.json')).contentType).toBe('application/json')
    await notFound(getAssetForPlay(t.db, s.learner, published, 'data/secret.png'))
    await notFound(getAssetForPlay(t.db, s.learner, draft, 'data/draft.json'))
    await notFound(getAssetForPlay(t.db, other.learner, published, 'data/open.json'))
    await forbidden(getAssetForPlay(t.db, s.anonymous, published, 'data/open.json'))
    await forbidden(putAsset(t.db, s.author, { challengeId: published, path: 'x.json', contentType: 'application/json', visibility: 'public', bytes: Buffer.from('{}') }))
  })

  it('refuses unsafe asset paths', async () => {
    await expect(
      putAsset(t.db, s.admin, { challengeId: published, path: '../etc/passwd', contentType: 'text/plain', visibility: 'public', bytes: Buffer.from('x') }),
    ).rejects.toThrow(/Unsafe/)
  })
})

// Keeps the unused-import linter honest about Scope being part of the contract.
export type { Scope }
