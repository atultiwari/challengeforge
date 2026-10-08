/**
 * WordPress connector (Phase 5, S4): a site's connection to one WordPress
 * site (shared secret, sealed), WordPress users linked by their WordPress id,
 * and spent single-sign-on token ids.
 */
import { sql, type Kysely } from 'kysely'

const TABLE_OPTIONS = sql.raw('ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci')

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS wp_connections (
    site_id CHAR(36) NOT NULL PRIMARY KEY,
    wp_url VARCHAR(500) NOT NULL,
    secret_sealed TEXT NOT NULL,
    enabled BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL
  ) ${TABLE_OPTIONS}`.execute(db)
  await sql`CREATE TABLE IF NOT EXISTS wp_users (
    site_id CHAR(36) NOT NULL,
    wp_user_id VARCHAR(64) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (site_id, wp_user_id)
  ) ${TABLE_OPTIONS}`.execute(db)
  await sql`CREATE TABLE IF NOT EXISTS sso_jtis (
    jti VARCHAR(64) NOT NULL PRIMARY KEY,
    expires_at DATETIME(3) NOT NULL,
    KEY ix_sso_jtis_expiry (expires_at)
  ) ${TABLE_OPTIONS}`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of ['sso_jtis', 'wp_users', 'wp_connections']) await sql`DROP TABLE IF EXISTS ${sql.table(table)}`.execute(db)
}
