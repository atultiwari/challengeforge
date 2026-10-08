import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addMember, addSiteDomain, createSite, discardSetupAccount, findSiteByHost, grantNetworkAdminUnchecked, listMembers, listSites, needsSetup, normaliseHost, primaryHostOf, principalFor, sniffImage } from '../src'
import { createUser, freshDb, setupSite, type TestDb } from './harness'

let t: TestDb
let s: Awaited<ReturnType<typeof setupSite>>
beforeAll(async () => {
  t = await freshDb()
  s = await setupSite(t.db)
})
afterAll(async () => t.close())

describe('multi-site', () => {
  it('normalises hosts and refuses junk', () => {
    expect(normaliseHost('Lab.Example.org:443')).toBe('lab.example.org')
    expect(normaliseHost('127.0.0.1:3200')).toBe('127.0.0.1:3200')
    expect(normaliseHost('evil.test/path')).toBeNull()
    expect(normaliseHost('a b')).toBeNull()
  })

  it('only network admins create sites; the new site is found by its host and has its admin', async () => {
    await expect(createSite(t.db, s.admin, { slug: 'second', name: 'Second', host: 'second.example.test' })).rejects.toMatchObject({ code: 'forbidden' })
    await grantNetworkAdminUnchecked(t.db, s.admin.principal!.userId)
    const site = await createSite(t.db, s.admin, { slug: 'second', name: 'Second', host: 'Second.Example.test' })
    expect(await findSiteByHost(t.db, 'second.example.test:443')).toMatchObject({ id: site.id, name: 'Second' })
    expect(await findSiteByHost(t.db, 'unknown.example.test')).toBeNull()
    expect(await primaryHostOf(t.db, site.id)).toBe('second.example.test')
    expect(await needsSetup(t.db, site.id)).toBe(false)
    await expect(createSite(t.db, s.admin, { slug: 'third', name: 'Third', host: 'second.example.test' })).rejects.toMatchObject({ code: 'invalid' })
    await addSiteDomain(t.db, s.admin, site.id, 'www.second.example.test')
    expect((await listSites(t.db, s.admin)).find((x) => x.id === site.id)).toMatchObject({ hosts: ['second.example.test', 'www.second.example.test'], admins: 1 })
  })

  it('accounts are install-wide, roles are per site', async () => {
    const person = await createUser(t.db, s.site.id, 'author', 'roaming')
    const second = (await findSiteByHost(t.db, 'second.example.test'))!
    expect(await principalFor(t.db, second.id, person.principal!.userId)).toEqual({ userId: person.principal!.userId, role: 'learner' })
    const other = await createUser(t.db, s.site.id, 'learner', 'new-site-owner')
    const email = (await t.db.selectFrom('user').select('email').where('id', '=', other.principal!.userId).executeTakeFirstOrThrow()).email
    const third = await createSite(t.db, s.admin, { slug: 'third', name: 'Third', host: 'third.example.test', adminEmail: email })
    expect(await principalFor(t.db, third.id, other.principal!.userId)).toMatchObject({ role: 'admin' })
  })

  it('a closed site does not let install accounts walk in; an admin adds them (review)', async () => {
    const outsider = await createUser(t.db, s.site.id, 'learner', 'outsider')
    const closed = await createSite(t.db, s.admin, { slug: 'closed', name: 'Closed', host: 'closed.example.test' })
    expect(await principalFor(t.db, closed.id, outsider.principal!.userId, { autoJoin: false })).toBeNull()
    const email = (await t.db.selectFrom('user').select('email').where('id', '=', outsider.principal!.userId).executeTakeFirstOrThrow()).email
    const closedAdmin = { siteId: closed.id, principal: { userId: s.admin.principal!.userId, role: 'admin' as const } }
    await addMember(t.db, closedAdmin, email, 'learner')
    expect(await principalFor(t.db, closed.id, outsider.principal!.userId, { autoJoin: false })).toMatchObject({ role: 'learner' })
    expect((await listMembers(t.db, closedAdmin)).map((m) => m.email)).toContain(email)
    await expect(addMember(t.db, closedAdmin, 'nobody@example.test', 'learner')).rejects.toMatchObject({ code: 'invalid' })
  })

  it('the default site address cannot be given away, and duplicates are a clear refusal (review)', async () => {
    await expect(createSite(t.db, s.admin, { slug: 'grab', name: 'Grab', host: 'main.example.test', reservedHost: 'main.example.test' })).rejects.toMatchObject({ code: 'invalid' })
    const results = await Promise.allSettled([
      createSite(t.db, s.admin, { slug: 'race-a', name: 'A', host: 'race.example.test' }),
      createSite(t.db, s.admin, { slug: 'race-b', name: 'B', host: 'race.example.test' }),
    ])
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { code: 'invalid' } })
  })

  it('recognises images by their bytes, not their claimed type', () => {
    expect(sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]))).toBe('image/png')
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')]))).toBe('image/webp')
    expect(sniffImage(Buffer.from('<svg onload=alert(1)>'))).toBeNull()
  })

  it('a setup account that lost the claim is removed', async () => {
    const loser = await createUser(t.db, s.site.id, 'learner', 'lost-claim')
    await discardSetupAccount(t.db, loser.principal!.userId)
    expect(await t.db.selectFrom('user').select('id').where('id', '=', loser.principal!.userId).executeTakeFirst()).toBeUndefined()
  })
})
