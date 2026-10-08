/**
 * Resumable background jobs (PLAN.md §7): long work such as a prompt-battery
 * evaluation runs in bounded slices, advanced by the learner's page polling
 * or by cron, so it never depends on the host's request timeout or on a
 * persistent worker process.
 */
import { sql, type Kysely } from 'kysely'

const TABLE_OPTIONS = sql.raw('ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci')

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS jobs (
    id CHAR(36) NOT NULL PRIMARY KEY,
    site_id CHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    attempt_id CHAR(36) NOT NULL,
    kind VARCHAR(64) NOT NULL,
    status ENUM('queued','running','done','failed') NOT NULL,
    request JSON NOT NULL,
    action JSON NOT NULL,
    idempotency_key VARCHAR(64) NULL,
    progress JSON NULL,
    error VARCHAR(500) NULL,
    failures INT NOT NULL DEFAULT 0,
    lease_until DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    KEY ix_jobs_runnable (status, lease_until),
    KEY ix_jobs_attempt (attempt_id),
    CONSTRAINT fk_jobs_attempt FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS jobs`.execute(db)
}
