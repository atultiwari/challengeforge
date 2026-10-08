import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  addCollaborator,
  createChallenge,
  getForAuthoring,
  listAudit,
  listCollaborators,
  listForAuthoring,
  listReviewQueue,
  publish,
  removeCollaborator,
  saveDraftVersion,
  setRole,
  type Scope,
} from '../src'
import { createUser, freshDb, registry, setupSite, type TestDb } from './harness'
import { quizMission } from './fixtures'

let t: TestDb
let s: Awaited<ReturnType<typeof setupSite>>
let editor: Scope
let challengeId: string
const emailOf = async (scope: Scope) =>
  (await t.db.selectFrom('user').select('email').where('id', '=', scope.principal!.userId).executeTakeFirstOrThrow()).email

beforeAll(async () => {
  t = await freshDb()
  s = await setupSite(t.db)
  editor = await createUser(t.db, s.site.id, 'editor')
  challengeId = await createChallenge(t.db, s.author, registry, { slug: 'shared', typeId: 'lab-legacy', typeVersion: 1, definition: quizMission })
})
afterAll(async () => t.close())

describe('editors', () => {
  it('edit, publish and archive anyone\'s challenge, and work the review queue', async () => {
    expect(await saveDraftVersion(t.db, editor, registry, challengeId, { ...quizMission, title: 'Edited by editor' })).toBe(2)
    expect((await getForAuthoring(t.db, editor, challengeId)).canPublish).toBe(true)
    await publish(t.db, editor, challengeId)
    expect(await listReviewQueue(t.db, editor)).toEqual([])
    expect((await listForAuthoring(t.db, editor)).map((c) => c.id)).toContain(challengeId)
  })

  it('cannot manage people or read the audit log', async () => {
    await expect(setRole(t.db, editor, s.learner.principal!.userId, 'author')).rejects.toMatchObject({ code: 'forbidden' })
    await expect(listAudit(t.db, editor)).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('authors still cannot publish', async () => {
    await expect(publish(t.db, s.author, challengeId)).rejects.toMatchObject({ code: 'forbidden' })
  })
})

describe('co-authors', () => {
  it('a co-author can edit and see the challenge, but not publish or manage co-authors', async () => {
    await expect(saveDraftVersion(t.db, s.otherAuthor, registry, challengeId, quizMission)).rejects.toMatchObject({ code: 'forbidden' })
    expect((await listForAuthoring(t.db, s.otherAuthor)).map((c) => c.id)).not.toContain(challengeId)

    const added = await addCollaborator(t.db, s.author, challengeId, (await emailOf(s.otherAuthor)).toUpperCase())
    expect(added.userId).toBe(s.otherAuthor.principal!.userId)
    await addCollaborator(t.db, s.author, challengeId, await emailOf(s.otherAuthor)) // twice: no-op

    expect(await saveDraftVersion(t.db, s.otherAuthor, registry, challengeId, { ...quizMission, title: 'Co-authored' })).toBeGreaterThan(1)
    expect((await listForAuthoring(t.db, s.otherAuthor)).map((c) => c.id)).toContain(challengeId)
    expect((await listCollaborators(t.db, s.otherAuthor, challengeId)).map((c) => c.userId)).toEqual([s.otherAuthor.principal!.userId])
    await expect(publish(t.db, s.otherAuthor, challengeId)).rejects.toMatchObject({ code: 'forbidden' })
    await expect(removeCollaborator(t.db, s.otherAuthor, challengeId, s.otherAuthor.principal!.userId)).rejects.toMatchObject({ code: 'forbidden' })
  })

  it('only authors can be added, with one message for unknown and learner emails', async () => {
    const learnerMsg = await addCollaborator(t.db, s.author, challengeId, await emailOf(s.learner)).catch((e: Error) => e.message)
    const unknownMsg = await addCollaborator(t.db, s.author, challengeId, 'nobody@example.test').catch((e: Error) => e.message)
    expect(learnerMsg).toBe(unknownMsg)
    await expect(addCollaborator(t.db, s.author, challengeId, await emailOf(s.author))).rejects.toMatchObject({ code: 'invalid' })
  })

  it('people from another site are never found', async () => {
    const other = await setupSite(t.db, 'collab-other')
    await expect(addCollaborator(t.db, s.author, challengeId, await emailOf(other.author))).rejects.toMatchObject({ code: 'invalid' })
    await expect(listCollaborators(t.db, other.admin, challengeId)).rejects.toMatchObject({ code: 'not_found' })
  })

  it('removing a co-author takes their access away, and both changes are audited', async () => {
    await removeCollaborator(t.db, s.author, challengeId, s.otherAuthor.principal!.userId)
    await expect(saveDraftVersion(t.db, s.otherAuthor, registry, challengeId, quizMission)).rejects.toMatchObject({ code: 'forbidden' })
    const actions = (await listAudit(t.db, s.admin)).filter((e) => e.targetId === challengeId).map((e) => e.action)
    expect(actions).toEqual(expect.arrayContaining(['collaborator.added', 'collaborator.removed', 'challenge.published']))
  })

  it('learners cannot list co-authors', async () => {
    await expect(listCollaborators(t.db, s.learner, challengeId)).rejects.toMatchObject({ code: 'not_found' })
  })
})
