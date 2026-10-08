/**
 * LTI Advantage Assignment and Grade Services: sends queued scores to the
 * LMS grade book. Access tokens come from the platform's token URL with the
 * OAuth 2 client-credentials grant and a JWT signed by our tool key.
 */
import { randomBytes } from 'node:crypto'
import { SignJWT } from 'jose'
import { dueLtiScores, getPlatform, markLtiScoreFailed, markLtiScoreSent, type Db, type DueScore, type LtiPlatform } from '@challengeforge/db'
import { OUTBOUND_TIMEOUT_MS, type FetchLike } from '../payments/types'
import { AGS_SCORE_SCOPE } from './claims'
import { ensureToolKey, LTI_ALG } from './keys'

const BATCH = 50

interface CachedToken {
  token: string
  expiresAt: number
}

export async function fetchAccessToken(platform: LtiPlatform, key: Awaited<ReturnType<typeof ensureToolKey>>, fetchImpl: FetchLike, now: Date = new Date()): Promise<CachedToken> {
  const assertion = await new SignJWT({})
    .setProtectedHeader({ alg: LTI_ALG, kid: key.kid, typ: 'JWT' })
    .setIssuer(platform.clientId)
    .setSubject(platform.clientId)
    .setAudience(platform.authTokenUrl)
    .setIssuedAt(Math.floor(now.getTime() / 1000))
    .setExpirationTime(Math.floor(now.getTime() / 1000) + 300)
    .setJti(randomBytes(16).toString('base64url'))
    .sign(key.privateKey)
  const res = await fetchImpl(platform.authTokenUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_assertion_type: 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
      client_assertion: assertion,
      scope: AGS_SCORE_SCOPE,
    }).toString(),
    signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
  })
  const json = (await res.json().catch(() => ({}))) as { access_token?: unknown; expires_in?: unknown }
  if (!res.ok || typeof json.access_token !== 'string') throw new Error(`Token request refused (HTTP ${res.status}).`)
  const ttl = typeof json.expires_in === 'number' ? json.expires_in : 3600
  return { token: json.access_token, expiresAt: now.getTime() + Math.max(60, ttl - 60) * 1000 }
}

/** The score endpoint of a line item: `/scores` appended to its path, query kept. */
export function scoresUrl(lineitem: string): string {
  const url = new URL(lineitem)
  url.pathname = `${url.pathname.replace(/\/$/, '')}/scores`
  return url.href
}

async function postScore(score: DueScore, token: string, fetchImpl: FetchLike, now: Date): Promise<void> {
  const res = await fetchImpl(scoresUrl(score.lineitemUrl), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/vnd.ims.lis.v1.score+json' },
    body: JSON.stringify({
      userId: score.sub,
      scoreGiven: score.scoreGiven,
      scoreMaximum: score.scoreMaximum,
      activityProgress: 'Completed',
      gradingProgress: score.gradingProgress,
      timestamp: now.toISOString(),
    }),
    signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
  })
  if (!res.ok) throw new Error(`Score refused (HTTP ${res.status}).`)
}

/** Sends every due score once; failures back off and are retried later. Returns counts. */
export async function sendDueLtiScores(db: Db, secret: string, options: { fetchImpl?: FetchLike; now?: Date; limit?: number } = {}): Promise<{ sent: number; failed: number }> {
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike)
  const now = options.now ?? new Date()
  const tokens = new Map<string, CachedToken>()
  let sent = 0
  let failed = 0
  for (const score of await dueLtiScores(db, options.limit ?? BATCH, now)) {
    try {
      const platform = await getPlatform(db, score.siteId, score.platformId)
      if (!platform) throw new Error('Platform no longer registered.')
      let token = tokens.get(platform.id)
      if (!token || token.expiresAt <= now.getTime()) {
        token = await fetchAccessToken(platform, await ensureToolKey(db, score.siteId, secret), fetchImpl, now)
        tokens.set(platform.id, token)
      }
      await postScore(score, token.token, fetchImpl, now)
      await markLtiScoreSent(db, score)
      sent += 1
    } catch (err) {
      await markLtiScoreFailed(db, score, err instanceof Error ? err.message : 'Unknown error', now)
      failed += 1
    }
  }
  return { sent, failed }
}
