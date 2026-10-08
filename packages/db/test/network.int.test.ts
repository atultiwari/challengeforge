import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { addSiteDomain, createSite, findSiteByHost, grantNetworkAdminUnchecked, listSites, needsSetup, normaliseHost, primaryHostOf, principalFor } from '../src'
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
})
