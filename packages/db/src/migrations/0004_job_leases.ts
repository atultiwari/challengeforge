/**
 * A lease token per job claim, so a worker whose lease expired (and was taken
 * over) can never write stale progress or apply a stale result.
 */
import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE jobs ADD COLUMN lease_token CHAR(36) NULL`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE jobs DROP COLUMN lease_token`.execute(db)
}
