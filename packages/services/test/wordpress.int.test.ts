import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SignJWT } from 'jose'
import { linkWpUser, saveWpConnection, spendSsoJti } from '@challengeforge/db'
import { verifyWordPressToken } from '../src'
import { freshDb, setupSite, type TestDb } from '../../db/test/harness'

// Synthetic values only.
const SECRET = 'test-only-wordpress-secret-0123456789abcdef'
const WP = 'https://blog.example.test'
const CF = 'https://challenges.example.test'
const TOKEN_PHP = path.resolve(import.meta.dirname, '../../../integrations/wordpress/challengeforge/includes/token.php')

function phpAvailable(): boolean {
  try {
    execFileSync('php', ['-v'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/** The plugin's own PHP builds the token, exactly as WordPress would. */
const phpToken = (userId: string, now?: number) =>
  execFileSync('php', ['-r', `require '${TOKEN_PHP}'; echo challengeforge_build_token('${SECRET}', '${WP}', '${CF}', '${userId}', 'Wendy Press', '/play/abc', ${now ?? 'null'});`]).toString()

let t: TestDb
let s: Awaited<ReturnType<typeof setupSite>>
beforeAll(async () => {
  t = await freshDb()
  s = await setupSite(t.db)
})
afterAll(async () => t.close())

describe('WordPress sign-on', () => {
  it.runIf(phpAvailable())('verifies a token made by the real plugin code (PHP)', async () => {
    const signOn = await verifyWordPressToken(phpToken('42'), { secret: SECRET, issuer: WP, audience: CF })
    expect(signOn).toMatchObject({ wpUserId: '42', name: 'Wendy Press', next: '/play/abc' })
    expect(signOn.jti).toMatch(/^[0-9a-f]{32}$/)
  })

  it.runIf(phpAvailable())('refuses the wrong secret, issuer or audience, and an expired token', async () => {
    const token = phpToken('42')
    await expect(verifyWordPressToken(token, { secret: `${SECRET}x`, issuer: WP, audience: CF })).rejects.toThrow(/not accepted/)
    await expect(verifyWordPressToken(token, { secret: SECRET, issuer: 'https://evil.example.test', audience: CF })).rejects.toThrow(/not accepted/)
    await expect(verifyWordPressToken(token, { secret: SECRET, issuer: WP, audience: 'https://other.example.test' })).rejects.toThrow(/not accepted/)
    const old = phpToken('42', Math.floor(Date.now() / 1000) - 3600)
    await expect(verifyWordPressToken(old, { secret: SECRET, issuer: WP, audience: CF })).rejects.toThrow(/not accepted/)
  })

  it('refuses tokens that live too long or lack an id', async () => {
    const key = new TextEncoder().encode(SECRET)
    const long = await new SignJWT({ name: 'x' }).setProtectedHeader({ alg: 'HS256' }).setIssuer(WP).setAudience(CF).setSubject('1').setJti('long-lived-token-id').setIssuedAt().setExpirationTime('2h').sign(key)
    await expect(verifyWordPressToken(long, { secret: SECRET, issuer: WP, audience: CF })).rejects.toThrow(/too long/)
    const noJti = await new SignJWT({}).setProtectedHeader({ alg: 'HS256' }).setIssuer(WP).setAudience(CF).setSubject('1').setIssuedAt().setExpirationTime('2m').sign(key)
    await expect(verifyWordPressToken(noJti, { secret: SECRET, issuer: WP, audience: CF })).rejects.toThrow()
  })

  it('a token id works once; WordPress users are linked by id, never by email', async () => {
    const exp = new Date(Date.now() + 60_000)
    expect(await spendSsoJti(t.db, 'jti-once-0001', exp)).toBe(true)
    expect(await spendSsoJti(t.db, 'jti-once-0001', exp)).toBe(false)
    const a = await linkWpUser(t.db, s.site.id, '42', 'Wendy Press')
    expect(await linkWpUser(t.db, s.site.id, '42', 'Renamed')).toBe(a)
    expect(await linkWpUser(t.db, s.site.id, '43', 'Other')).not.toBe(a)
    const user = await t.db.selectFrom('user').select('email').where('id', '=', a).executeTakeFirstOrThrow()
    expect(user.email).toMatch(/@wp\.invalid$/)
  })

  it('a different WordPress address unlinks the old members, and its user 42 gets a new account', async () => {
    const { site, admin } = await setupSite(t.db, 'wp-move')
    await saveWpConnection(t.db, admin, WP, 'sealed-test-secret')
    const before = await linkWpUser(t.db, site.id, '42', 'Old blog user')
    await saveWpConnection(t.db, admin, WP, 'sealed-test-secret-2')
    expect(await linkWpUser(t.db, site.id, '42', 'Same')).toBe(before)
    await saveWpConnection(t.db, admin, 'https://other-blog.example.test', 'sealed-test-secret-3')
    const after = await linkWpUser(t.db, site.id, '42', 'New blog user')
    expect(after).not.toBe(before)
  })

  it('removing a linked member is not undone by their next sign-on', async () => {
    const userId = await linkWpUser(t.db, s.site.id, '77', 'Removed later')
    await t.db.deleteFrom('memberships').where('site_id', '=', s.site.id).where('user_id', '=', userId).execute()
    expect(await linkWpUser(t.db, s.site.id, '77', 'Removed later')).toBe(userId)
    const membership = await t.db.selectFrom('memberships').select('role').where('site_id', '=', s.site.id).where('user_id', '=', userId).executeTakeFirst()
    expect(membership).toBeUndefined()
  })
})
