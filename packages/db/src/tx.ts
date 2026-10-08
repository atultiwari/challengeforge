/**
 * Retries a whole transaction when InnoDB picks it as a deadlock victim
 * (errno 1213), which is expected under concurrency and safe to retry.
 * Lock-wait timeouts (1205) are NOT retried: they already waited ~50 s.
 */
const DEADLOCK = 1213
const MAX_TX_ATTEMPTS = 3

export async function withDeadlockRetry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work()
    } catch (err) {
      if (attempt >= MAX_TX_ATTEMPTS || (err as { errno?: number }).errno !== DEADLOCK) throw err
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt))
    }
  }
}
