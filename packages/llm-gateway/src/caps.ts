import { LlmUserFacingError } from './errors'
import type { LlmStore, ReserveArgs } from './store'

/**
 * Two independent caps, because BYOK separates "who pays" from "how much
 * practice is allowed":
 *
 *   Challenge cap - pedagogical. A chat challenge may allow, say, 30 messages
 *     because unlimited attempts would destroy the challenge. Enforced even
 *     when the learner is paying with their own key. Claimed atomically in the
 *     database.
 *
 *   Platform budget - financial. Applies only to learner-driven calls the site
 *     pays for, so one enthusiastic learner cannot burn the whole budget.
 */
export async function reserveChallengeCall(
  store: LlmStore,
  args: ReserveArgs,
): Promise<{ reservationId: string; callsRemaining: number }> {
  const { reservationId, callsUsed } = await store.reserveCall(args)
  if (reservationId === null) {
    throw new LlmUserFacingError(`You have used all ${args.cap} attempts for this challenge.`, 'call_cap_reached')
  }
  return { reservationId, callsRemaining: Math.max(0, args.cap - callsUsed) }
}

/**
 * Only meaningful when prices are filled into the providers config; a model
 * with null prices logs a null cost, and the challenge call cap is then the
 * only bound on its spend.
 */
export async function assertPlatformBudget(store: LlmStore, userId: string, budgetUsd: number): Promise<void> {
  if (budgetUsd <= 0) return
  const spent = await store.sumPlatformCostUsd(userId)
  if (spent >= budgetUsd) {
    throw new LlmUserFacingError(
      'This account has reached its usage allowance. Add your own API key in AI Settings to continue.',
      'budget_reached',
    )
  }
}
