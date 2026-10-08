import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createLocalJWKSet, exportJWK, generateKeyPair, jwtVerify, SignJWT, type CryptoKey, type JWK } from 'jose'
import {
  claimLtiScore,
  dueLtiScores,
  grantFromSource,
  isAllowedOutboundUrl,
  upsertPack,
  createChallenge,
  createLtiTicket,
  linkLtiUser,
  performAction,
  publish,
  recordLinkUser,
  redeemLtiTicket,
  savePlatform,
  startOrResume,
  toolPublicJwks,
  upsertLtiLink,
  type LtiPlatform,
  type Scope,
} from '@challengeforge/db'
import { CLAIM, deepLinkResponse, ensureToolKey, open, seal, scoresUrl, sendDueLtiScores, startLogin, verifyLaunch, type FetchLike } from '../src'
import { freshDb, registry, setupSite, type TestDb } from '../../db/test/harness'

// Synthetic values only: a simulated LMS on example.test.
const SECRET = 'test-only-secret-for-lti-sealing-0123456789'
const APP = 'https://tool.example.test'
const quiz = {
  title: 'Synthetic LTI quiz',
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
let platform: LtiPlatform
let platformKey: CryptoKey
let platformJwk: JWK
let challengeId: string
const jwksFor = () => createLocalJWKSet({ keys: [platformJwk] })

async function idToken(claims: Record<string, unknown>, options: { key?: CryptoKey; kid?: string; expiresIn?: string } = {}) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'RS256', kid: options.kid ?? 'platform-key' })
    .setIssuer(platform.issuer)
    .setAudience(platform.clientId)
    .setIssuedAt()
    .setExpirationTime(options.expiresIn ?? '5m')
    .sign(options.key ?? platformKey)
}

/** Runs the login step and returns what the platform would receive. */
async function login() {
  const { redirectUrl, state } = await startLogin(t.db, s.site.id, APP, { iss: platform.issuer, login_hint: 'u-1', target_link_uri: `${APP}/lti/launch`, client_id: platform.clientId })
  const nonce = new URL(redirectUrl).searchParams.get('nonce')!
  return { redirectUrl, state, nonce }
}

const resourceLaunch = (nonce: string, extra: Record<string, unknown> = {}) => ({
  sub: 'lms-user-1',
  name: 'Lena Learner',
  email: 'attacker-chosen@example.test',
  nonce,
  [CLAIM.messageType]: 'LtiResourceLinkRequest',
  [CLAIM.version]: '1.3.0',
  [CLAIM.deploymentId]: 'dep-1',
  [CLAIM.resourceLink]: { id: 'rl-1' },
  [CLAIM.context]: { id: 'course-1', title: 'Pathology 101' },
  [CLAIM.roles]: ['http://purl.imsglobal.org/vocab/lis/v2/membership#Learner'],
  [CLAIM.custom]: { challenge_id: challengeId },
  [CLAIM.ags]: { scope: ['https://purl.imsglobal.org/spec/lti-ags/scope/score'], lineitem: 'https://lms.example.test/api/lineitems/42?course=1' },
  ...extra,
})

beforeAll(async () => {
  t = await freshDb()
  s = await setupSite(t.db)
  const pair = await generateKeyPair('RS256', { extractable: true })
  platformKey = pair.privateKey
  platformJwk = { ...(await exportJWK(pair.publicKey)), kid: 'platform-key', alg: 'RS256' }
  platform = await savePlatform(t.db, s.admin, {
    name: 'Simulated LMS',
    issuer: 'https://lms.example.test',
    clientId: 'tool-client-1',
    authLoginUrl: 'https://lms.example.test/auth',
    authTokenUrl: 'https://lms.example.test/token',
    jwksUrl: 'https://lms.example.test/jwks',
    deploymentIds: ['dep-1'],
  })
  challengeId = await createChallenge(t.db, s.admin, registry, { slug: 'lti-quiz', typeId: 'lab-legacy', typeVersion: 1, definition: quiz })
  await publish(t.db, s.admin, challengeId)
})
afterAll(async () => t.close())

describe('platform registration', () => {
  it('needs https URLs (localhost excepted) and at least one deployment', async () => {
    const base = { name: 'X', issuer: 'https://x.test', clientId: 'c', authLoginUrl: 'https://x.test/a', authTokenUrl: 'https://x.test/t', jwksUrl: 'https://x.test/k', deploymentIds: ['d'] }
    await expect(savePlatform(t.db, s.admin, { ...base, jwksUrl: 'http://x.test/k' })).rejects.toMatchObject({ code: 'invalid' })
    await expect(savePlatform(t.db, s.admin, { ...base, deploymentIds: [' '] })).rejects.toMatchObject({ code: 'invalid' })
    await expect(savePlatform(t.db, s.author, base)).rejects.toMatchObject({ code: 'forbidden' })
    expect((await savePlatform(t.db, s.admin, { ...base, jwksUrl: 'http://localhost:3299/jwks' })).jwksUrl).toBe('http://localhost:3299/jwks')
  })
})

describe('outbound URL policy (review)', () => {
  it('allows public https only; localhost http only outside production; never private addresses', () => {
    expect(isAllowedOutboundUrl('https://lms.example.test/jwks', true)).toBe(true)
    expect(isAllowedOutboundUrl('http://lms.example.test/jwks', true)).toBe(false)
    expect(isAllowedOutboundUrl('http://localhost:3299/jwks', false)).toBe(true)
    expect(isAllowedOutboundUrl('http://localhost:3299/jwks', true)).toBe(false)
    for (const host of ['10.0.0.5', '192.168.1.1', '172.20.0.1', '169.254.169.254', '127.0.0.1', '[::1]', '100.64.0.1']) {
      expect({ host, ok: isAllowedOutboundUrl(`https://${host}/x`, true) }).toEqual({ host, ok: false })
    }
    expect(isAllowedOutboundUrl('not a url', false)).toBe(false)
  })

  it('an LTI grant an admin revoked stays revoked when the next launch comes in', async () => {
    const packId = await upsertPack(t.db, s.admin, { slug: 'lti-pack', title: 'LTI pack', description: '' })
    const userId = await linkLtiUser(t.db, s.site.id, platform.id, 'lms-grant-user', 'Grant User')
    await grantFromSource(t.db, s.site.id, userId, packId, 'lti', 'p:course', new Date(Date.now() + 60_000), { revive: false })
    await t.db.updateTable('access_grants').set({ revoked_at: new Date() }).where('user_id', '=', userId).execute()
    await grantFromSource(t.db, s.site.id, userId, packId, 'lti', 'p:course', new Date(Date.now() + 120_000), { revive: false })
    const row = await t.db.selectFrom('access_grants').select('revoked_at').where('user_id', '=', userId).executeTakeFirstOrThrow()
    expect(row.revoked_at).not.toBeNull()
  })
})

describe('tool keys', () => {
  it('seals with AES-GCM and refuses tampering or the wrong secret', () => {
    const sealed = seal('{"k":1}', SECRET)
    expect(open(sealed, SECRET)).toBe('{"k":1}')
    expect(() => open(sealed, `${SECRET}x`)).toThrow()
    const [iv, tag, body] = sealed.split('.')
    expect(() => open([iv, tag, Buffer.from('tampered').toString('base64')].join('.'), SECRET)).toThrow()
    void body
  })

  it('creates one key on first use and publishes only its public half', async () => {
    const first = await ensureToolKey(t.db, s.site.id, SECRET)
    const again = await ensureToolKey(t.db, s.site.id, SECRET)
    expect(again.kid).toBe(first.kid)
    const published = await toolPublicJwks(t.db, s.site.id)
    expect(published).toEqual([expect.objectContaining({ kid: first.kid, kty: 'RSA', alg: 'RS256', use: 'sig' })])
    expect(published[0]).not.toHaveProperty('d')
  })
})

describe('launch', () => {
  it('login redirects to the platform with state, nonce and our launch URL', async () => {
    const { redirectUrl } = await login()
    const url = new URL(redirectUrl)
    expect(url.origin + url.pathname).toBe('https://lms.example.test/auth')
    expect(Object.fromEntries(url.searchParams)).toMatchObject({ scope: 'openid', response_type: 'id_token', response_mode: 'form_post', prompt: 'none', client_id: 'tool-client-1', redirect_uri: `${APP}/lti/launch`, login_hint: 'u-1' })
    await expect(startLogin(t.db, s.site.id, APP, { iss: 'https://unknown.test', login_hint: 'x', target_link_uri: APP })).rejects.toMatchObject({ code: 'unknown_platform' })
  })

  it('accepts a genuine launch exactly once', async () => {
    const { state, nonce } = await login()
    const token = await idToken(resourceLaunch(nonce))
    const launch = await verifyLaunch(t.db, s.site.id, { idToken: token, state, cookieState: state }, { jwksFor })
    expect(launch.platform.id).toBe(platform.id)
    expect(launch.payload.sub).toBe('lms-user-1')
    await expect(verifyLaunch(t.db, s.site.id, { idToken: token, state, cookieState: state }, { jwksFor })).rejects.toMatchObject({ code: 'bad_state' })
  })

  it('refuses a missing or different state cookie (login CSRF)', async () => {
    const { state, nonce } = await login()
    const token = await idToken(resourceLaunch(nonce))
    await expect(verifyLaunch(t.db, s.site.id, { idToken: token, state, cookieState: undefined }, { jwksFor })).rejects.toMatchObject({ code: 'bad_state' })
    await expect(verifyLaunch(t.db, s.site.id, { idToken: token, state, cookieState: 'other' }, { jwksFor })).rejects.toMatchObject({ code: 'bad_state' })
  })

  it('refuses a forged signature, a wrong nonce, an expired token, or an unknown deployment', async () => {
    const attacker = await generateKeyPair('RS256')
    for (const [build, code] of [
      [(n: string) => idToken(resourceLaunch(n), { key: attacker.privateKey }), 'bad_token'],
      [(_n: string) => idToken(resourceLaunch('not-the-nonce')), 'bad_token'],
      [(n: string) => idToken(resourceLaunch(n), { expiresIn: '-5m' }), 'bad_token'],
      [(n: string) => idToken(resourceLaunch(n, { [CLAIM.deploymentId]: 'dep-unknown' })), 'bad_deployment'],
      [(n: string) => idToken(resourceLaunch(n, { [CLAIM.version]: '1.1' })), 'bad_claims'],
    ] as const) {
      const { state, nonce } = await login()
      await expect(verifyLaunch(t.db, s.site.id, { idToken: await build(nonce), state, cookieState: state }, { jwksFor })).rejects.toMatchObject({ code })
    }
  })
})

describe('accounts and tickets', () => {
  it('links LMS users by (platform, sub), never by the email claim', async () => {
    const a = await linkLtiUser(t.db, s.site.id, platform.id, 'lms-user-1', 'Lena Learner')
    expect(await linkLtiUser(t.db, s.site.id, platform.id, 'lms-user-1', 'Renamed')).toBe(a)
    expect(await linkLtiUser(t.db, s.site.id, platform.id, 'lms-user-2', 'Other')).not.toBe(a)
    const user = await t.db.selectFrom('user').select(['email', 'name']).where('id', '=', a).executeTakeFirstOrThrow()
    expect(user.email).toMatch(/^lti-[0-9a-f]{24}@lti\.invalid$/)
    expect(user.name).toBe('Lena Learner')
  })

  it('a session ticket works once, within its minute, and only on the site that issued it', async () => {
    const userId = await linkLtiUser(t.db, s.site.id, platform.id, 'lms-user-1', 'Lena Learner')
    const ticket = await createLtiTicket(t.db, s.site.id, userId)
    expect(await redeemLtiTicket(t.db, 'another-site-id', ticket)).toBeNull()
    expect(await redeemLtiTicket(t.db, s.site.id, ticket)).toBe(userId)
    expect(await redeemLtiTicket(t.db, s.site.id, ticket)).toBeNull()
    const late = await createLtiTicket(t.db, s.site.id, userId, new Date(Date.now() - 120_000))
    expect(await redeemLtiTicket(t.db, s.site.id, late)).toBeNull()
  })
})

describe('deep linking', () => {
  it('signs a response the platform can verify with our published keys', async () => {
    const key = await ensureToolKey(t.db, s.site.id, SECRET)
    const jwt = await deepLinkResponse(key, platform, { deploymentId: 'dep-1', data: 'opaque', appUrl: APP, items: [{ id: challengeId, title: 'Synthetic LTI quiz' }], scoreMaximum: 100 })
    const { payload } = await jwtVerify(jwt, createLocalJWKSet({ keys: (await toolPublicJwks(t.db, s.site.id)) as JWK[] }), { issuer: platform.clientId, audience: platform.issuer })
    expect(payload[CLAIM.messageType]).toBe('LtiDeepLinkingResponse')
    expect(payload[CLAIM.deepLinkData]).toBe('opaque')
    expect(payload[CLAIM.contentItems]).toEqual([
      expect.objectContaining({ type: 'ltiResourceLink', url: `${APP}/lti/launch`, custom: { challenge_id: challengeId }, lineItem: expect.objectContaining({ scoreMaximum: 100 }) }),
    ])
  })
})

describe('grade passback', () => {
  it('a final result is sent to the LMS grade column, once, with a signed token request', async () => {
    expect(scoresUrl('https://lms.example.test/api/lineitems/42?course=1')).toBe('https://lms.example.test/api/lineitems/42/scores?course=1')
    const userId = await linkLtiUser(t.db, s.site.id, platform.id, 'lms-user-1', 'Lena Learner')
    const { linkId } = await upsertLtiLink(t.db, { siteId: s.site.id, platformId: platform.id, deploymentId: 'dep-1', resourceLinkId: 'rl-1', contextId: 'course-1', contextTitle: 'Pathology 101', challengeId, lineitemUrl: 'https://lms.example.test/api/lineitems/42?course=1' })
    await recordLinkUser(t.db, linkId, userId, 'lms-user-1')
    const learner: Scope = { siteId: s.site.id, principal: { userId, role: 'learner' } }
    const { attemptId } = await startOrResume(t.db, learner, { registry }, challengeId)
    await performAction(t.db, learner, { registry }, attemptId, { kind: 'submit', payload: { answer: 'b' } })

    const toolKeys = createLocalJWKSet({ keys: (await toolPublicJwks(t.db, s.site.id)) as JWK[] })
    const calls: { url: string; body: string; headers: Record<string, string> }[] = []
    const lms: FetchLike = async (url, init) => {
      calls.push({ url, body: init.body, headers: init.headers })
      if (url === platform.authTokenUrl) {
        const form = new URLSearchParams(init.body)
        await jwtVerify(form.get('client_assertion')!, toolKeys, { issuer: platform.clientId, subject: platform.clientId, audience: platform.authTokenUrl })
        expect(form.get('scope')).toBe('https://purl.imsglobal.org/spec/lti-ags/scope/score')
        return { ok: true, status: 200, json: async () => ({ access_token: 'lms-token', expires_in: 3600 }) }
      }
      return { ok: true, status: 200, json: async () => ({}) }
    }
    expect(await sendDueLtiScores(t.db, SECRET, { fetchImpl: lms })).toEqual({ sent: 1, failed: 0 })
    const scoreCall = calls.find((c) => c.url.includes('/scores'))!
    expect(scoreCall.url).toBe('https://lms.example.test/api/lineitems/42/scores?course=1')
    expect(scoreCall.headers['authorization']).toBe('Bearer lms-token')
    expect(JSON.parse(scoreCall.body)).toMatchObject({ userId: 'lms-user-1', scoreGiven: 100, scoreMaximum: 100, activityProgress: 'Completed', gradingProgress: 'FullyGraded' })
    expect(await sendDueLtiScores(t.db, SECRET, { fetchImpl: lms })).toEqual({ sent: 0, failed: 0 })
  })

  it('only one run can claim a due score', async () => {
    const userId = await linkLtiUser(t.db, s.site.id, platform.id, 'lms-user-claim', 'Claimer')
    const { linkId } = await upsertLtiLink(t.db, { siteId: s.site.id, platformId: platform.id, deploymentId: 'dep-1', resourceLinkId: 'rl-1', contextId: null, contextTitle: null, challengeId, lineitemUrl: null })
    await recordLinkUser(t.db, linkId, userId, 'lms-user-claim')
    const learner: Scope = { siteId: s.site.id, principal: { userId, role: 'learner' } }
    const { attemptId } = await startOrResume(t.db, learner, { registry }, challengeId)
    await performAction(t.db, learner, { registry }, attemptId, { kind: 'submit', payload: { answer: 'b' } })
    const due = (await dueLtiScores(t.db, 50)).find((d) => d.sub === 'lms-user-claim')!
    expect(await claimLtiScore(t.db, due)).toBe(true)
    expect(await claimLtiScore(t.db, due)).toBe(false)
    expect((await dueLtiScores(t.db, 50)).some((d) => d.sub === 'lms-user-claim')).toBe(false)
  })

  it('a refused score backs off and is retried later, not immediately', async () => {
    const userId = await linkLtiUser(t.db, s.site.id, platform.id, 'lms-user-3', 'Third')
    const { linkId } = await upsertLtiLink(t.db, { siteId: s.site.id, platformId: platform.id, deploymentId: 'dep-1', resourceLinkId: 'rl-1', contextId: null, contextTitle: null, challengeId, lineitemUrl: null })
    await recordLinkUser(t.db, linkId, userId, 'lms-user-3')
    const learner: Scope = { siteId: s.site.id, principal: { userId, role: 'learner' } }
    const { attemptId } = await startOrResume(t.db, learner, { registry }, challengeId)
    await performAction(t.db, learner, { registry }, attemptId, { kind: 'submit', payload: { answer: 'b' } })
    const down: FetchLike = async () => ({ ok: false, status: 503, json: async () => ({}) })
    expect(await sendDueLtiScores(t.db, SECRET, { fetchImpl: down })).toEqual({ sent: 0, failed: 1 })
    expect(await sendDueLtiScores(t.db, SECRET, { fetchImpl: down })).toEqual({ sent: 0, failed: 0 })
    const row = await t.db.selectFrom('lti_score_outbox').select(['status', 'failures', 'last_error']).where('user_id', '=', userId).executeTakeFirstOrThrow()
    expect(row).toMatchObject({ status: 'pending', failures: 1, last_error: 'Token request refused (HTTP 503).' })
  })
})
