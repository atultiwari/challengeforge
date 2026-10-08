import 'server-only'
import { createDb, type Db } from '@challengeforge/db'
import { env } from './env'

/** One pool per process (kept across dev hot reloads). */
const globalForDb = globalThis as unknown as { cfDb?: Db }

export function db(): Db {
  if (!globalForDb.cfDb) {
    const config = env()
    globalForDb.cfDb = createDb({ url: config.DATABASE_URL, connectionLimit: config.DB_CONNECTION_LIMIT }).db
  }
  return globalForDb.cfDb
}
