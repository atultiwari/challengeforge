/**
 * Notifications (Phase 4, R3): an outbox of emails to send (certificate
 * issued, review decided, cohort joined), filled in the same transaction as
 * the event and sent by cron; and each person's choice to receive them.
 */
import { sql, type Kysely } from 'kysely'

const TABLE_OPTIONS = sql.raw('ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci')

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS notifications (
    id CHAR(36) NOT NULL PRIMARY KEY,
    site_id CHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    kind VARCHAR(32) NOT NULL,
    payload JSON NOT NULL,
    status ENUM('pending','sent','skipped','failed') NOT NULL,
    failures INT NOT NULL DEFAULT 0,
    next_attempt_at DATETIME(3) NOT NULL,
    last_error VARCHAR(500) NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    KEY ix_notifications_due (status, next_attempt_at)
  ) ${TABLE_OPTIONS}`.execute(db)
  await sql`CREATE TABLE IF NOT EXISTS mail_preferences (
    site_id CHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    updates BOOLEAN NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (site_id, user_id)
  ) ${TABLE_OPTIONS}`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS mail_preferences`.execute(db)
  await sql`DROP TABLE IF EXISTS notifications`.execute(db)
}
