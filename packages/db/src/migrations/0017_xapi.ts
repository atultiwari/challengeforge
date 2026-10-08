/** xAPI (Phase 5, S2): a site's connection to a Learning Record Store, and how far it has been sent. */
import { sql, type Kysely } from 'kysely'

const TABLE_OPTIONS = sql.raw('ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci')

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS lrs_endpoints (
    site_id CHAR(36) NOT NULL PRIMARY KEY,
    endpoint VARCHAR(500) NOT NULL,
    username VARCHAR(200) NOT NULL,
    secret_sealed TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    attempts_cursor_at DATETIME(3) NULL,
    attempts_cursor_id CHAR(36) NULL,
    results_cursor_at DATETIME(3) NULL,
    results_cursor_id CHAR(36) NULL,
    last_error VARCHAR(500) NULL,
    last_sent_at DATETIME(3) NULL,
    updated_at DATETIME(3) NOT NULL
  ) ${TABLE_OPTIONS}`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS lrs_endpoints`.execute(db)
}
