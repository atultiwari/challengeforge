/**
 * Retrying transactions that the database aborted for a reason that is safe
 * to retry from the start:
 *   - 1213 deadlock: InnoDB picked this transaction as the victim;
 *   - 1020 "record has changed since last read": MariaDB 11.8 (Hostinger's
 *     version) enables innodb_snapshot_isolation by default, so a
 *     transaction that read a row another transaction then changed is
 *     refused instead of silently using stale data. MySQL never raises it.
 * Lock-wait timeouts (1205) are NOT retried: they already waited ~50 s.
 */
import type { Transaction } from 'kysely'
import type { Database } from './schema'
import type { Db } from './client'

const RETRYABLE = new Set([1213, 1020])
const MAX_TX_ATTEMPTS = 3

export async function withDeadlockRetry<T>(work: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await work()
    } catch (err) {
      if (attempt >= MAX_TX_ATTEMPTS || !RETRYABLE.has((err as { errno?: number }).errno ?? 0)) throw err
      await new Promise((resolve) => setTimeout(resolve, 20 * attempt + Math.floor(Math.random() * 20)))
    }
  }
}

/** One transaction, retried from the start on a deadlock or a snapshot conflict. */
export function transact<T>(db: Db, work: (trx: Transaction<Database>) => Promise<T>): Promise<T> {
  return withDeadlockRetry(() => db.transaction().execute(work))
}
