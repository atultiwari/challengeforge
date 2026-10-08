import type { SealedSecret } from './credentials/crypto'

/**
 * Everything the gateway needs from the database, behind one interface so the
 * gateway can be tested without a running database.
 */
export type CredentialSource = 'platform' | 'byok' | 'oauth'

export interface UsageRecord {
  readonly userId: string
  readonly challengeId: string
  readonly provider: string
  readonly model: string
  readonly credentialSource: CredentialSource
  readonly purpose: string
  readonly inputTokens: number
  readonly outputTokens: number
  readonly costEstimateUsd: number | null
  readonly requestId: string | null
}

export interface StoredCredential extends SealedSecret {
  readonly provider: string
}

export interface ReserveArgs {
  readonly userId: string
  readonly challengeId: string
  readonly purpose: string
  readonly cap: number
  readonly provider: string
  readonly model: string
  readonly credentialSource: CredentialSource
}

/** reservationId is null when the cap is already used up. */
export interface CallReservation {
  readonly reservationId: string | null
  readonly callsUsed: number
}

export interface LlmStore {
  /**
   * Atomically claims one call against the cap BEFORE the provider is
   * contacted, so parallel requests cannot both take the last slot.
   */
  reserveCall(args: ReserveArgs): Promise<CallReservation>
  /** Fills in the reserved row once the provider has answered. */
  completeCall(reservationId: string, record: UsageRecord): Promise<void>
  /** Returns the slot when the provider failed: a failed call costs no attempt. */
  releaseCall(reservationId: string): Promise<void>
  /** Platform-funded spend so far for this learner, for the budget cap. */
  sumPlatformCostUsd(userId: string): Promise<number>
  getCredential(userId: string, provider: string): Promise<StoredCredential | null>
}
