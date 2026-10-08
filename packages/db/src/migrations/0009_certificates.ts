/**
 * Certificates (Phase 3, Q5). A pack may award one when a learner has a
 * FINAL pass (not waiting for review) on every published challenge in it.
 * A certificate is a snapshot: later renames never rewrite it.
 */
import { sql, type Kysely } from 'kysely'

const TABLE_OPTIONS = sql.raw('ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci')

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE packs ADD COLUMN certificates_enabled BOOLEAN NOT NULL DEFAULT FALSE`.execute(db)
  await sql`CREATE TABLE IF NOT EXISTS certificates (
    id VARCHAR(32) NOT NULL PRIMARY KEY,
    site_id CHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    pack_id CHAR(36) NOT NULL,
    recipient_name VARCHAR(200) NOT NULL,
    pack_title VARCHAR(300) NOT NULL,
    site_name VARCHAR(200) NOT NULL,
    challenge_count INT NOT NULL,
    issued_at DATETIME(3) NOT NULL,
    revoked_at DATETIME(3) NULL,
    revoke_reason VARCHAR(500) NULL,
    UNIQUE KEY uq_certificate (site_id, user_id, pack_id),
    KEY ix_certificate_pack (pack_id)
  ) ${TABLE_OPTIONS}`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS certificates`.execute(db)
  await sql`ALTER TABLE packs DROP COLUMN certificates_enabled`.execute(db)
}
