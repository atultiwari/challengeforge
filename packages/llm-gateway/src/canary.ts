import { createHmac } from 'node:crypto'

export const CANARY_PREFIX = 'CF-CANARY-'

/**
 * Per-learner canary planted in a challenge system prompt.
 *
 * Deriving it per user means a learner who posts their canary in a study group
 * chat does not hand anyone else the flag - the string only matches for them.
 */
export function deriveCanary(userId: string, challengeId: string, secret: string): string {
  if (secret === '') throw new Error('deriveCanary needs a non-empty secret.')
  const digest = createHmac('sha256', secret).update(`${userId}:${challengeId}`).digest('hex')
  return `${CANARY_PREFIX}${digest.slice(0, 16)}`
}
