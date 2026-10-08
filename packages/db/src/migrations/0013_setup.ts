/** First-run setup (Phase 4, R2): one-time tokens that let the first admin be created in the browser. */
import { sql, type Kysely } from 'kysely'

const TABLE_OPTIONS = sql.raw('ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci')

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS setup_tokens (
    token_hash CHAR(64) NOT NULL PRIMARY KEY,
    site_id CHAR(36) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    KEY ix_setup_tokens_site (site_id)
  ) ${TABLE_OPTIONS}`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS setup_tokens`.execute(db)
}
