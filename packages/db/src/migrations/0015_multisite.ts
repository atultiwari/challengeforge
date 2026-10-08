/**
 * Multi-site (Phase 4, R4): hostnames that serve a site, and the install's
 * network admins (who create sites and attach domains).
 */
import { sql, type Kysely } from 'kysely'

const TABLE_OPTIONS = sql.raw('ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci')

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS site_domains (
    host VARCHAR(255) NOT NULL PRIMARY KEY,
    site_id CHAR(36) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    KEY ix_site_domains_site (site_id),
    CONSTRAINT fk_site_domains_site FOREIGN KEY (site_id) REFERENCES sites(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`.execute(db)
  await sql`CREATE TABLE IF NOT EXISTS network_admins (
    user_id VARCHAR(36) NOT NULL PRIMARY KEY,
    created_at DATETIME(3) NOT NULL
  ) ${TABLE_OPTIONS}`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS network_admins`.execute(db)
  await sql`DROP TABLE IF EXISTS site_domains`.execute(db)
}
