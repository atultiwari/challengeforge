import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { claimSite, createSetupToken, ensureSite, needsSetup, setupTokenValid, userIdByEmail } from '../src'
import { createUser, freshDb, type TestDb } from './harness'

let t: TestDb
let siteId: string
beforeAll(async () => {
  t = await freshDb()
  siteId = (await ensureSite(t.db, 'fresh', 'Fresh install')).id
})
afterAll(async () => t.close())

describe('first-run setup', () => {
  it('a site with no admin needs setup; tokens come from the environment or the CLI', async () => {
    expect(await needsSetup(t.db, siteId)).toBe(true)
    const envToken = 'a-long-enough-environment-token-0001'
    expect(await setupTokenValid(t.db, siteId, envToken, envToken)).toBe(true)
    expect(await setupTokenValid(t.db, siteId, 'short', 'short')).toBe(false)
    expect(await setupTokenValid(t.db, siteId, 'wrong-token-of-a-decent-length', envToken)).toBe(false)
    const cliToken = await createSetupToken(t.db, siteId)
    expect(await setupTokenValid(t.db, siteId, cliToken, undefined)).toBe(true)
    expect(await setupTokenValid(t.db, siteId, cliToken, undefined, new Date(Date.now() + 2 * 60 * 60_000))).toBe(false)
  })

  it('the first claim makes an admin and spends every token; a second claim fails', async () => {
    const cliToken = await createSetupToken(t.db, siteId)
    const first = await createUser(t.db, siteId, 'learner', 'first-owner')
    const second = await createUser(t.db, siteId, 'learner', 'second-owner')
    const [a, b] = await Promise.all([claimSite(t.db, siteId, first.principal!.userId), claimSite(t.db, siteId, second.principal!.userId)])
    expect([a, b].filter(Boolean)).toHaveLength(1)
    expect(await needsSetup(t.db, siteId)).toBe(false)
    expect(await setupTokenValid(t.db, siteId, cliToken, undefined)).toBe(false)
    const email = (await t.db.selectFrom('user').select('email').where('id', '=', first.principal!.userId).executeTakeFirstOrThrow()).email
    expect(await userIdByEmail(t.db, email.toUpperCase())).toBe(first.principal!.userId)
  })
})
