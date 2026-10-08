/**
 * What an LTI launch leaves behind (Phase 3, Q7): single-use login states,
 * LMS users linked by (platform, sub), one-time session tickets, resource
 * links (an LMS placement → a challenge, with its grade column), pending
 * deep-link requests, and an outbox of scores to send back.
 *
 * Protocol checks (signatures, claims) live in packages/services; this
 * module only records what a verified launch established.
 */
import { createHash, randomBytes } from 'node:crypto'
import { transact } from '../tx'
import type { Db } from '../client'
import { newId } from '../ids'
import { ValidationError } from '../scope'

const STATE_TTL_MS = 10 * 60_000
const TICKET_TTL_MS = 60_000
const DEEP_LINK_TTL_MS = 30 * 60_000

const randomToken = (): string => randomBytes(32).toString('base64url')

/** A login state and nonce, used once within ten minutes. */
export async function createLtiState(db: Db, siteId: string, platformId: string, now: Date = new Date()): Promise<{ state: string; nonce: string }> {
  const state = randomToken()
  const nonce = randomToken()
  await db.insertInto('lti_states').values({ state, site_id: siteId, platform_id: platformId, nonce, expires_at: new Date(now.getTime() + STATE_TTL_MS), used_at: null }).execute()
  return { state, nonce }
}

/** Spends a state: returns its platform and nonce once, then never again. */
export async function consumeLtiState(db: Db, siteId: string, state: string, now: Date = new Date()): Promise<{ platformId: string; nonce: string } | null> {
  if (state.length === 0 || state.length > 64) return null
  const spent = await db
    .updateTable('lti_states')
    .set({ used_at: now })
    .where('state', '=', state)
    .where('site_id', '=', siteId)
    .where('used_at', 'is', null)
    .where('expires_at', '>', now)
    .executeTakeFirst()
  if (Number(spent.numUpdatedRows) !== 1) return null
  const row = await db.selectFrom('lti_states').select(['platform_id', 'nonce']).where('state', '=', state).executeTakeFirstOrThrow()
  return { platformId: row.platform_id, nonce: row.nonce }
}

/**
 * The local account for an LMS user. Linked by (platform, sub) only: the
 * email claim is never trusted to take over an existing account, so a new
 * LMS user gets an account of their own with a placeholder address.
 */
export async function linkLtiUser(db: Db, siteId: string, platformId: string, sub: string, name: string, now: Date = new Date()): Promise<string> {
  if (sub === '' || sub.length > 255) throw new ValidationError('The launch has no usable user id.')
  const find = () => db.selectFrom('lti_users').select('user_id').where('platform_id', '=', platformId).where('sub', '=', sub).executeTakeFirst()
  const existing = await find()
  if (existing) return existing.user_id
  const userId = newId()
  const handle = createHash('sha256').update(`${platformId}:${sub}`).digest('hex').slice(0, 24)
  try {
    await transact(db, async (trx) => {
      await trx
        .insertInto('user')
        .values({ id: userId, name: (name.trim() || 'LMS learner').slice(0, 100), email: `lti-${handle}@lti.invalid`, emailVerified: false, image: null, createdAt: now, updatedAt: now })
        .execute()
      await trx.insertInto('memberships').values({ site_id: siteId, user_id: userId, role: 'learner', created_at: now }).execute()
      await trx.insertInto('lti_users').values({ platform_id: platformId, sub, site_id: siteId, user_id: userId, created_at: now }).execute()
    })
    return userId
  } catch (err) {
    // Two first launches at once: the other one won; use its account.
    const winner = await find()
    if (winner) return winner.user_id
    throw err
  }
}

/** A one-time ticket the web app redeems for a session (a minute to live). */
export async function createLtiTicket(db: Db, siteId: string, userId: string, now: Date = new Date()): Promise<string> {
  const ticket = randomToken()
  await db.insertInto('lti_tickets').values({ ticket, user_id: userId, site_id: siteId, expires_at: new Date(now.getTime() + TICKET_TTL_MS), used_at: null }).execute()
  return ticket
}

/** Spends a ticket on the site that issued it (a ticket from one site never signs anyone in on another). */
export async function redeemLtiTicket(db: Db, siteId: string, ticket: string, now: Date = new Date()): Promise<string | null> {
  if (ticket.length === 0 || ticket.length > 64) return null
  const spent = await db
    .updateTable('lti_tickets')
    .set({ used_at: now })
    .where('ticket', '=', ticket)
    .where('site_id', '=', siteId)
    .where('used_at', 'is', null)
    .where('expires_at', '>', now)
    .executeTakeFirst()
  if (Number(spent.numUpdatedRows) !== 1) return null
  return (await db.selectFrom('lti_tickets').select('user_id').where('ticket', '=', ticket).executeTakeFirstOrThrow()).user_id
}

export interface LinkInput {
  siteId: string
  platformId: string
  deploymentId: string
  resourceLinkId: string
  contextId: string | null
  contextTitle: string | null
  challengeId: string
  lineitemUrl: string | null
}

/**
 * Records (or refreshes) the LMS placement for a challenge and returns its
 * id. The challenge a placement points at is fixed by its first launch.
 */
export async function upsertLtiLink(db: Db, input: LinkInput, now: Date = new Date()): Promise<{ linkId: string; challengeId: string }> {
  const challenge = await db
    .selectFrom('challenges')
    .select('id')
    .where('id', '=', input.challengeId)
    .where('site_id', '=', input.siteId)
    .where('published_version_id', 'is not', null)
    .where('status', '!=', 'archived')
    .executeTakeFirst()
  const existing = await db
    .selectFrom('lti_links')
    .select(['id', 'challenge_id'])
    .where('platform_id', '=', input.platformId)
    .where('deployment_id', '=', input.deploymentId)
    .where('resource_link_id', '=', input.resourceLinkId)
    .executeTakeFirst()
  const lineitem = input.lineitemUrl && input.lineitemUrl.length <= 500 ? input.lineitemUrl : null
  if (existing) {
    await db
      .updateTable('lti_links')
      .set({ context_id: input.contextId, context_title: input.contextTitle?.slice(0, 300) ?? null, ...(lineitem ? { lineitem_url: lineitem } : {}), updated_at: now })
      .where('id', '=', existing.id)
      .execute()
    return { linkId: existing.id, challengeId: existing.challenge_id }
  }
  if (!challenge) throw new ValidationError('This LMS link points at a challenge that is not published here.')
  const linkId = newId()
  await db
    .insertInto('lti_links')
    .values({
      id: linkId,
      site_id: input.siteId,
      platform_id: input.platformId,
      deployment_id: input.deploymentId.slice(0, 255),
      resource_link_id: input.resourceLinkId.slice(0, 255),
      context_id: input.contextId?.slice(0, 255) ?? null,
      context_title: input.contextTitle?.slice(0, 300) ?? null,
      challenge_id: input.challengeId,
      lineitem_url: lineitem,
      created_at: now,
      updated_at: now,
    })
    .ignore()
    .execute()
  // A concurrent first launch may have created it; read back the winner.
  const row = await db.selectFrom('lti_links').select(['id', 'challenge_id']).where('platform_id', '=', input.platformId).where('deployment_id', '=', input.deploymentId).where('resource_link_id', '=', input.resourceLinkId).executeTakeFirstOrThrow()
  return { linkId: row.id, challengeId: row.challenge_id }
}

export async function recordLinkUser(db: Db, linkId: string, userId: string, sub: string, now: Date = new Date()): Promise<void> {
  await db.insertInto('lti_link_users').values({ link_id: linkId, user_id: userId, sub, last_launch_at: now }).onDuplicateKeyUpdate({ last_launch_at: now, sub }).execute()
}

export interface DeepLinkRequest {
  id: string
  platformId: string
  deploymentId: string
  returnUrl: string
  data: string | null
}

export async function createDeepLinkRequest(db: Db, siteId: string, input: Omit<DeepLinkRequest, 'id'> & { userId: string }, now: Date = new Date()): Promise<string> {
  const id = newId()
  await db
    .insertInto('lti_deep_links')
    .values({ id, site_id: siteId, platform_id: input.platformId, deployment_id: input.deploymentId, return_url: input.returnUrl, data: input.data, user_id: input.userId, expires_at: new Date(now.getTime() + DEEP_LINK_TTL_MS), used_at: null })
    .execute()
  return id
}

/** An unused, unexpired deep-link request belonging to this user. */
export async function getDeepLinkRequest(db: Db, siteId: string, id: string, userId: string, now: Date = new Date()): Promise<DeepLinkRequest | null> {
  const row = await db
    .selectFrom('lti_deep_links')
    .select(['id', 'platform_id', 'deployment_id', 'return_url', 'data'])
    .where('id', '=', id)
    .where('site_id', '=', siteId)
    .where('user_id', '=', userId)
    .where('used_at', 'is', null)
    .where('expires_at', '>', now)
    .executeTakeFirst()
  return row ? { id: row.id, platformId: row.platform_id, deploymentId: row.deployment_id, returnUrl: row.return_url, data: row.data } : null
}

export async function consumeDeepLinkRequest(db: Db, id: string, now: Date = new Date()): Promise<boolean> {
  const result = await db.updateTable('lti_deep_links').set({ used_at: now }).where('id', '=', id).where('used_at', 'is', null).executeTakeFirst()
  return Number(result.numUpdatedRows) === 1
}

/** Removes spent or expired login states, tickets and deep-link requests older than a day (run from cron). */
export async function purgeExpiredLti(db: Db, now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - 24 * 60 * 60_000)
  let removed = 0
  for (const table of ['lti_states', 'lti_tickets', 'lti_deep_links'] as const) {
    const result = await db.deleteFrom(table).where('expires_at', '<', cutoff).executeTakeFirst()
    removed += Number(result.numDeletedRows)
  }
  return removed
}
