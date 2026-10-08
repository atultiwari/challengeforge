import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createChallenge, listAudit, overrideAssessment, publish, recordAudit, setRole, type Scope } from '../src'
import { createUser, freshDb, registry, setupSite, type TestDb } from './harness'
import { quizMission } from './fixtures'

let t: TestDb
let s: Awaited<ReturnType<typeof setupSite>>
beforeAll(async () => {
  t = await freshDb()
  s = await setupSite(t.db)
})
afterAll(async () => t.close())

describe('audit log', () => {
  it('records role changes with the before and after, and who made them', async () => {
    const who = await createUser(t.db, s.site.id, 'learner', 'promoted')
    await setRole(t.db, s.admin, who.principal!.userId, 'author')
    await setRole(t.db, s.admin, who.principal!.userId, 'author') // no change: no entry
    const entries = (await listAudit(t.db, s.admin)).filter((e) => e.targetId === who.principal!.userId)
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ action: 'role.changed', actorId: s.admin.principal!.userId, details: { from: 'learner', to: 'author' } })
  })

  it('records publishing, attributed to the CLI when there is no signed-in user', async () => {
    const id = await createChallenge(t.db, s.admin, registry, { slug: 'audited', typeId: 'lab-legacy', typeVersion: 1, definition: quizMission })
    await publish(t.db, s.admin, id)
    const cli: Scope = { siteId: s.site.id, principal: null }
    await recordAudit(t.db, cli, { action: 'pack.imported', targetType: 'pack', targetId: 'p1' }, 'cli')
    const log = await listAudit(t.db, s.admin)
    expect(log.find((e) => e.targetId === id)).toMatchObject({ action: 'challenge.published' })
    expect(log.find((e) => e.targetId === 'p1')).toMatchObject({ actorId: 'system:cli', actorName: null })
  })

  it('only admins read the log, and only their own site\'s', async () => {
    await expect(listAudit(t.db, s.author)).rejects.toMatchObject({ code: 'forbidden' })
    const other = await setupSite(t.db, 'audit-other')
    expect(await listAudit(t.db, other.admin)).toEqual([])
  })

  it('a failed override writes nothing to the log', async () => {
    await expect(overrideAssessment(t.db, s.admin, 'missing', { passed: true, points: 1 })).rejects.toMatchObject({ code: 'not_found' })
    expect((await listAudit(t.db, s.admin)).some((e) => e.action === 'assessment.overridden')).toBe(false)
  })

  it('pages newest first', async () => {
    const all = await listAudit(t.db, s.admin)
    const older = await listAudit(t.db, s.admin, { before: all[0]!.at })
    expect(older.every((e) => e.at < all[0]!.at)).toBe(true)
    expect((await listAudit(t.db, s.admin, { limit: 1 }))).toHaveLength(1)
  })
})
