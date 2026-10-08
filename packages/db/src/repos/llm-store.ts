/**
 * The LLM gateway's storage (its `LlmStore` interface), on MySQL/MariaDB.
 *
 * Call caps are claimed atomically: a per-(user, challenge, purpose) counter
 * row is locked, checked and bumped in one transaction, so parallel requests
 * can never both take the last slot (the Lab did this in a Postgres function).
 */
import type { Db } from '../client'
import { newId } from '../ids'
import type { CredentialSource } from '../schema'
import { withDeadlockRetry } from '../tx'

export interface ReserveArgs {
  userId: string
  challengeId: string
  purpose: string
  cap: number
  provider: string
  model: string
  credentialSource: CredentialSource
}

export interface UsageRecord {
  userId: string
  challengeId: string
  provider: string
  model: string
  credentialSource: CredentialSource
  purpose: string
  inputTokens: number
  outputTokens: number
  costEstimateUsd: number | null
  requestId: string | null
}

export interface SealedSecret {
  ciphertext: string
  iv: string
  authTag: string
}

export interface StoredCredential extends SealedSecret {
  provider: string
}

export interface MysqlLlmStore {
  reserveCall(args: ReserveArgs): Promise<{ reservationId: string | null; callsUsed: number }>
  completeCall(reservationId: string, record: UsageRecord): Promise<void>
  releaseCall(reservationId: string): Promise<void>
  sumPlatformCostUsd(userId: string): Promise<number>
  getCredential(userId: string, provider: string): Promise<StoredCredential | null>
  saveCredential(userId: string, provider: string, sealed: SealedSecret, last4: string): Promise<void>
  deleteCredential(userId: string, provider: string): Promise<void>
  listCredentials(userId: string): Promise<{ provider: string; last4: string }[]>
}

/** Server-internal: the caller has already authorised the user (the gateway acts for them). */
export function mysqlLlmStore(db: Db, siteId: string): MysqlLlmStore {
  return {
    async reserveCall(args) {
      // Make sure the counter row exists in its own statement, so the transaction
      // below only ever locks an existing row (creating it inside the lock lets
      // concurrent first calls deadlock on gap locks).
      const key = { site_id: siteId, user_id: args.userId, challenge_id: args.challengeId, purpose: args.purpose }
      await db.insertInto('llm_call_counters').values({ ...key, used: 0 }).ignore().execute()
      return withDeadlockRetry(() =>
        db.transaction().execute(async (trx) => {
          const counter = await trx
            .selectFrom('llm_call_counters')
            .select('used')
            .where('site_id', '=', siteId)
            .where('user_id', '=', args.userId)
            .where('challenge_id', '=', args.challengeId)
            .where('purpose', '=', args.purpose)
            .forUpdate()
            .executeTakeFirstOrThrow()
          if (counter.used >= args.cap) return { reservationId: null, callsUsed: counter.used }
          const id = newId()
          const now = new Date()
          await trx
            .updateTable('llm_call_counters')
            .set({ used: counter.used + 1 })
            .where('site_id', '=', siteId)
            .where('user_id', '=', args.userId)
            .where('challenge_id', '=', args.challengeId)
            .where('purpose', '=', args.purpose)
            .execute()
          await trx
            .insertInto('llm_usage')
            .values({
              id,
              site_id: siteId,
              user_id: args.userId,
              challenge_id: args.challengeId,
              purpose: args.purpose,
              provider: args.provider,
              model: args.model,
              credential_source: args.credentialSource,
              status: 'reserved',
              input_tokens: 0,
              output_tokens: 0,
              cost_estimate_usd: null,
              request_id: null,
              created_at: now,
              updated_at: now,
            })
            .execute()
          return { reservationId: id, callsUsed: counter.used + 1 }
        }),
      )
    },

    async completeCall(reservationId, record) {
      await db
        .updateTable('llm_usage')
        .set({
          model: record.model.slice(0, 120),
          input_tokens: record.inputTokens,
          output_tokens: record.outputTokens,
          cost_estimate_usd: record.costEstimateUsd,
          request_id: record.requestId?.slice(0, 200) ?? null,
          status: 'completed',
          updated_at: new Date(),
        })
        .where('id', '=', reservationId)
        .where('site_id', '=', siteId)
        .execute()
    },

    /** A failed call costs no attempt: the reservation is removed and its slot returned. */
    releaseCall: (reservationId) =>
      withDeadlockRetry(() =>
        db.transaction().execute(async (trx) => {
          const row = await trx
            .selectFrom('llm_usage')
            .select(['user_id', 'challenge_id', 'purpose'])
            .where('id', '=', reservationId)
            .where('site_id', '=', siteId)
            .where('status', '=', 'reserved')
            .forUpdate()
            .executeTakeFirst()
          if (!row) return
          await trx.deleteFrom('llm_usage').where('id', '=', reservationId).execute()
          await trx
            .updateTable('llm_call_counters')
            .set((eb) => ({ used: eb('used', '-', 1) }))
            .where('site_id', '=', siteId)
            .where('user_id', '=', row.user_id)
            .where('challenge_id', '=', row.challenge_id)
            .where('purpose', '=', row.purpose)
            .where('used', '>', 0)
            .execute()
        }),
      ),

    async sumPlatformCostUsd(userId) {
      const row = await db
        .selectFrom('llm_usage')
        .select((eb) => eb.fn.sum<string | null>('cost_estimate_usd').as('total'))
        .where('site_id', '=', siteId)
        .where('user_id', '=', userId)
        .where('credential_source', '=', 'platform')
        .executeTakeFirst()
      return Number(row?.total ?? 0)
    },

    async getCredential(userId, provider) {
      const row = await db
        .selectFrom('llm_credentials')
        .select(['provider', 'ciphertext', 'iv', 'auth_tag'])
        .where('site_id', '=', siteId)
        .where('user_id', '=', userId)
        .where('provider', '=', provider)
        .executeTakeFirst()
      return row ? { provider: row.provider, ciphertext: row.ciphertext, iv: row.iv, authTag: row.auth_tag } : null
    },

    async saveCredential(userId, provider, sealed, last4) {
      const now = new Date()
      const values = { ciphertext: sealed.ciphertext, iv: sealed.iv, auth_tag: sealed.authTag, last4: last4.slice(-4), updated_at: now }
      await db
        .insertInto('llm_credentials')
        .values({ site_id: siteId, user_id: userId, provider, ...values, created_at: now })
        .onDuplicateKeyUpdate(values)
        .execute()
    },

    async deleteCredential(userId, provider) {
      await db.deleteFrom('llm_credentials').where('site_id', '=', siteId).where('user_id', '=', userId).where('provider', '=', provider).execute()
    },

    async listCredentials(userId) {
      return db
        .selectFrom('llm_credentials')
        .select(['provider', 'last4'])
        .where('site_id', '=', siteId)
        .where('user_id', '=', userId)
        .orderBy('provider')
        .execute()
    },
  }
}

/** A reservation this old is from a call that never reported back (a crash or a killed request). */
export const STALE_RESERVATION_MS = 15 * 60_000

/**
 * Closes reservations whose call never completed, across all sites. The slot
 * stays used (the provider may have been charged), so a crash never hands out
 * a free call; the row just stops looking in-flight. Returns how many closed.
 */
export async function closeStaleReservations(db: Db, now: Date = new Date()): Promise<number> {
  const result = await db
    .updateTable('llm_usage')
    .set({ status: 'completed', updated_at: now })
    .where('status', '=', 'reserved')
    .where('created_at', '<', new Date(now.getTime() - STALE_RESERVATION_MS))
    .executeTakeFirst()
  return Number(result.numUpdatedRows)
}
