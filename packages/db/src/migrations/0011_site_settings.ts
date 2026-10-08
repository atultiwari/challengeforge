/**
 * Site settings and site files (Phase 4, R1): name, tagline, footer, theme
 * and switches per site, and small site-wide files such as the logo.
 */
import { sql, type Kysely } from 'kysely'

const TABLE_OPTIONS = sql.raw('ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci')

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS site_settings (
    site_id CHAR(36) NOT NULL PRIMARY KEY,
    settings JSON NOT NULL,
    updated_at DATETIME(3) NOT NULL
  ) ${TABLE_OPTIONS}`.execute(db)
  await sql`CREATE TABLE IF NOT EXISTS site_files (
    site_id CHAR(36) NOT NULL,
    name VARCHAR(32) NOT NULL,
    content_type VARCHAR(64) NOT NULL,
    bytes MEDIUMBLOB NOT NULL,
    sha256 CHAR(64) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (site_id, name)
  ) ${TABLE_OPTIONS}`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS site_files`.execute(db)
  await sql`DROP TABLE IF EXISTS site_settings`.execute(db)
}
