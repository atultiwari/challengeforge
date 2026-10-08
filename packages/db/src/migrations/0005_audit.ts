/**
 * An append-only record of who changed what (Phase 3): role changes,
 * publishes, review overrides, access grants, refunds, LTI registrations.
 */
import { sql, type Kysely } from 'kysely'

const TABLE_OPTIONS = sql.raw('ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci')

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS audit_log (
    id CHAR(36) NOT NULL PRIMARY KEY,
    site_id CHAR(36) NOT NULL,
    actor_id VARCHAR(64) NOT NULL,
    action VARCHAR(64) NOT NULL,
    target_type VARCHAR(32) NOT NULL,
    target_id VARCHAR(64) NOT NULL,
    details JSON NULL,
    created_at DATETIME(3) NOT NULL,
    KEY ix_audit_site_time (site_id, created_at),
    KEY ix_audit_target (site_id, target_type, target_id)
  ) ${TABLE_OPTIONS}`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS audit_log`.execute(db)
}
