/**
 * Access and payments (Phase 3, Q4). A pack is open or restricted; access to
 * a restricted pack comes from a grant (admin, payment, LTI) or from being in
 * a cohort that is assigned it. Payments only ever create grants, and every
 * provider event is recorded once, so a repeated webhook is a no-op.
 */
import { sql, type Kysely } from 'kysely'

const TABLE_OPTIONS = sql.raw('ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci')

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE packs ADD COLUMN access ENUM('open','restricted') NOT NULL DEFAULT 'open'`.execute(db)
  await sql`CREATE TABLE IF NOT EXISTS access_grants (
    id CHAR(36) NOT NULL PRIMARY KEY,
    site_id CHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    pack_id CHAR(36) NOT NULL,
    source ENUM('admin','payment','lti') NOT NULL,
    source_ref VARCHAR(64) NOT NULL,
    expires_at DATETIME(3) NULL,
    revoked_at DATETIME(3) NULL,
    created_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_grant_source (site_id, user_id, pack_id, source, source_ref),
    KEY ix_grant_pack (pack_id),
    CONSTRAINT fk_grant_pack FOREIGN KEY (pack_id) REFERENCES packs(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`.execute(db)
  await sql`CREATE TABLE IF NOT EXISTS products (
    id CHAR(36) NOT NULL PRIMARY KEY,
    site_id CHAR(36) NOT NULL,
    pack_id CHAR(36) NOT NULL,
    price_minor INT NOT NULL,
    currency CHAR(3) NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_product_pack (site_id, pack_id),
    CONSTRAINT fk_product_pack FOREIGN KEY (pack_id) REFERENCES packs(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`.execute(db)
  await sql`CREATE TABLE IF NOT EXISTS payments (
    id CHAR(36) NOT NULL PRIMARY KEY,
    site_id CHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    product_id CHAR(36) NOT NULL,
    pack_id CHAR(36) NOT NULL,
    provider VARCHAR(16) NOT NULL,
    provider_ref VARCHAR(128) NULL,
    provider_payment_ref VARCHAR(128) NULL,
    amount_minor INT NOT NULL,
    currency CHAR(3) NOT NULL,
    status ENUM('created','paid','refunded','failed') NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_payment_ref (provider, provider_ref),
    KEY ix_payment_charge (provider, provider_payment_ref),
    KEY ix_payment_user (site_id, user_id)
  ) ${TABLE_OPTIONS}`.execute(db)
  await sql`CREATE TABLE IF NOT EXISTS payment_events (
    provider VARCHAR(16) NOT NULL,
    event_id VARCHAR(128) NOT NULL,
    type VARCHAR(64) NOT NULL,
    received_at DATETIME(3) NOT NULL,
    PRIMARY KEY (provider, event_id)
  ) ${TABLE_OPTIONS}`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of ['payment_events', 'payments', 'products', 'access_grants']) {
    await sql`DROP TABLE IF EXISTS ${sql.table(table)}`.execute(db)
  }
  await sql`ALTER TABLE packs DROP COLUMN access`.execute(db)
}
