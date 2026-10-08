import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { verifyPassword } from 'better-auth/crypto'
import { freshDb, type TestDb } from '../../../packages/db/test/harness'
import { createUserWithPassword, resetPassword } from '../src/users'

let t: TestDb
beforeAll(async () => {
  t = await freshDb()
  process.env['BETTER_AUTH_SECRET'] = 'test-secret-for-cli-users-0123456789abcdef'
})
afterAll(async () => t.close())

const credentialHash = async (userId: string) =>
  (await t.db.selectFrom('account').select('password').where('userId', '=', userId).where('providerId', '=', 'credential').executeTakeFirstOrThrow()).password ?? ''

describe('operator account commands', () => {
  it('creates an account whose password verifies the way the website checks it', async () => {
    const id = await createUserWithPassword(t.db, 'ops@example.test', 'Ops', 'first-password-123')
    expect(await verifyPassword({ hash: await credentialHash(id), password: 'first-password-123' })).toBe(true)
  })

  it('resets a password and signs the person out everywhere', async () => {
    const user = await t.db.selectFrom('user').select('id').where('email', '=', 'ops@example.test').executeTakeFirstOrThrow()
    const now = new Date()
    await t.db.insertInto('session').values({ id: 's1', token: 'tok-1', userId: user.id, expiresAt: new Date(Date.now() + 86_400_000), createdAt: now, updatedAt: now, ipAddress: null, userAgent: null }).execute()
    await resetPassword(t.db, 'OPS@example.test', 'second-password-456')
    expect(await verifyPassword({ hash: await credentialHash(user.id), password: 'second-password-456' })).toBe(true)
    expect(await t.db.selectFrom('session').select('id').where('userId', '=', user.id).execute()).toEqual([])
  })

  it('refuses short passwords and unknown people', async () => {
    await expect(resetPassword(t.db, 'ops@example.test', 'short')).rejects.toThrow(/at least/)
    await expect(resetPassword(t.db, 'nobody@example.test', 'long-enough-password')).rejects.toThrow(/No account/)
  })
})
