import { Kysely, MysqlDialect } from 'kysely'
import { createPool, type Pool, type PoolOptions } from 'mysql2'
import type { Database } from './schema'

export type Db = Kysely<Database>

export interface DbConfig {
  url: string
  /** Shared hosting caps connections; keep the pool small. */
  connectionLimit?: number
}

/** Parses mysql://user:pass@host:port/database into pool options. */
export function poolOptionsFromUrl(url: string, connectionLimit = 5): PoolOptions {
  const u = new URL(url)
  if (u.protocol !== 'mysql:' && u.protocol !== 'mariadb:') {
    throw new Error('DATABASE_URL must start with mysql:// or mariadb://')
  }
  const database = decodeURIComponent(u.pathname.replace(/^\//, ''))
  if (!database) throw new Error('DATABASE_URL must name a database, e.g. mysql://user:pass@host:3306/challengeforge')
  return {
    host: u.hostname,
    port: u.port ? Number(u.port) : 3306,
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database,
    connectionLimit,
    // All timestamps are stored and read as UTC.
    timezone: 'Z',
    charset: 'utf8mb4',
    // Never let a big number silently lose precision.
    supportBigNumbers: true,
  }
}

export function createDb(config: DbConfig): { db: Db; pool: Pool } {
  const pool = createPool(poolOptionsFromUrl(config.url, config.connectionLimit))
  const db = new Kysely<Database>({ dialect: new MysqlDialect({ pool }) })
  return { db, pool }
}
