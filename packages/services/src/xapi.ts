/**
 * xAPI 1.0.3 statements from learning facts (Phase 5, S2), and pushing them
 * to a site's Learning Record Store from `run-jobs`.
 *
 * - Learners are identified by account ({homePage: site URL, name: user id}),
 *   never by email, so exports carry no addresses.
 * - Statement ids are derived from the fact, so sending one twice is
 *   harmless (an LRS accepts an identical statement it already has).
 * - Results waiting for review are not sent until a reviewer decides.
 */
import { createHash } from 'node:crypto'
import { enabledLrsEndpoints, learningFacts, recordLrsProgress, siteBaseUrl, type Db, type LearningFact } from '@challengeforge/db'
import { open } from './lti/keys'
import { assertPublicDestination } from './outbound'
import { OUTBOUND_TIMEOUT_MS, type FetchLike } from './payments/types'

const VERBS = {
  attempted: { id: 'http://adlnet.gov/expapi/verbs/attempted', display: { 'en-US': 'attempted' } },
  passed: { id: 'http://adlnet.gov/expapi/verbs/passed', display: { 'en-US': 'passed' } },
  failed: { id: 'http://adlnet.gov/expapi/verbs/failed', display: { 'en-US': 'failed' } },
} as const

export interface Statement {
  id: string
  actor: { objectType: 'Agent'; account: { homePage: string; name: string } }
  verb: (typeof VERBS)[keyof typeof VERBS]
  object: { objectType: 'Activity'; id: string; definition: { name: Record<string, string>; type: string } }
  result?: { success: boolean; completion: true; score: { scaled: number; raw: number; min: 0; max: number } }
  context: { platform: string; contextActivities?: { grouping: { objectType: 'Activity'; id: string }[] } }
  timestamp: string
}

/** A UUID (v5 layout) derived from the fact: the same fact always gives the same statement id. */
function statementId(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex')
  const variant = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`
}

export function statementFor(fact: LearningFact, baseUrl: string): Statement {
  const verb = fact.kind === 'attempted' ? VERBS.attempted : fact.passed ? VERBS.passed : VERBS.failed
  const max = fact.max && fact.max > 0 ? fact.max : 1
  const raw = Math.max(0, Math.min(max, fact.score ?? 0))
  return {
    id: statementId(`${baseUrl}|${fact.kind}|${fact.attemptId}|${fact.at.getTime()}`),
    actor: { objectType: 'Agent', account: { homePage: baseUrl, name: fact.userId } },
    verb,
    object: {
      objectType: 'Activity',
      id: `${baseUrl}/play/${fact.challengeId}`,
      definition: { name: { en: fact.challengeTitle }, type: 'http://adlnet.gov/expapi/activities/assessment' },
    },
    ...(fact.kind === 'result' ? { result: { success: fact.passed === true, completion: true as const, score: { scaled: Math.round((raw / max) * 10_000) / 10_000, raw, min: 0 as const, max } } } : {}),
    context: {
      platform: 'ChallengeForge',
      ...(fact.packSlug ? { contextActivities: { grouping: [{ objectType: 'Activity' as const, id: `${baseUrl}/packs/${fact.packSlug}` }] } } : {}),
    },
    timestamp: fact.at.toISOString(),
  }
}

const BATCH = 200
/** Facts younger than this wait for the next run: a transaction may commit a little after the time it recorded. */
const LAG_MS = 60_000

type Post = (statements: readonly Statement[]) => Promise<{ ok: boolean; status: number }>

/**
 * Sends a batch. If the LRS refuses the batch as invalid (400), each
 * statement is sent on its own, so one bad statement cannot block the
 * stream forever: the ones still refused are skipped and reported.
 */
async function postBatch(post: Post, statements: readonly Statement[]): Promise<{ sent: number; refused: number }> {
  const res = await post(statements)
  if (res.ok) return { sent: statements.length, refused: 0 }
  if (res.status !== 400 || statements.length === 1) throw new Error(`The LRS answered HTTP ${res.status}.`)
  let sent = 0
  let refused = 0
  for (const st of statements) {
    const one = await post([st])
    if (one.ok) sent += 1
    else if (one.status === 400) refused += 1
    else throw new Error(`The LRS answered HTTP ${one.status}.`)
  }
  return { sent, refused }
}

/**
 * Sends new statements to every enabled LRS, a batch per stream per run, and
 * remembers how far it got. A failure is recorded and retried next run.
 */
export async function pushToLrs(db: Db, secret: string, appUrl: string, options: { fetchImpl?: FetchLike; now?: Date } = {}): Promise<{ sent: number; failed: number }> {
  const fetchImpl = options.fetchImpl ?? (fetch as unknown as FetchLike)
  const counts = { sent: 0, failed: 0 }
  let endpoints: Awaited<ReturnType<typeof enabledLrsEndpoints>>
  try {
    endpoints = await enabledLrsEndpoints(db)
  } catch {
    return counts
  }
  for (const lrs of endpoints) {
    try {
      if (!options.fetchImpl) await assertPublicDestination(lrs.endpoint)
      const baseUrl = await siteBaseUrl(db, lrs.siteId, appUrl)
      const before = new Date((options.now ?? new Date()).getTime() - LAG_MS)
      const { attempts, results } = await learningFacts(db, lrs.siteId, { attemptsAfter: lrs.attemptsAfter, resultsAfter: lrs.resultsAfter, before, limit: BATCH })
      if (attempts.length + results.length === 0) continue
      const statements = [...attempts, ...results].map((f) => statementFor(f, baseUrl))
      const auth = `Basic ${Buffer.from(`${lrs.username}:${open(lrs.secretSealed, secret)}`).toString('base64')}`
      const post: Post = (batch) =>
        fetchImpl(`${lrs.endpoint}statements`, {
          method: 'POST',
          headers: { authorization: auth, 'content-type': 'application/json', 'x-experience-api-version': '1.0.3' },
          body: JSON.stringify(batch),
          signal: AbortSignal.timeout(OUTBOUND_TIMEOUT_MS),
          redirect: 'error',
        })
      const outcome = await postBatch(post, statements)
      const last = (list: LearningFact[]) => (list.length > 0 ? { at: list[list.length - 1]!.at, id: list[list.length - 1]!.attemptId } : null)
      const error = outcome.refused > 0 ? `The LRS refused ${outcome.refused} statement(s) as invalid; they were skipped.` : null
      await recordLrsProgress(db, lrs.siteId, { attemptsAfter: last(attempts), resultsAfter: last(results), error }, options.now)
      counts.sent += outcome.sent
    } catch (err) {
      counts.failed += 1
      await recordLrsProgress(db, lrs.siteId, { error: err instanceof Error ? err.message : 'Unknown error' }, options.now).catch(() => undefined)
    }
  }
  return counts
}
