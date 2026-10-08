/**
 * Model calls (PLAN.md §6.3, Phase 2): per-purpose call counters for atomic
 * caps, the usage log, learners' encrypted API keys, and the columns that let
 * an attempt wait for a model without holding a lock.
 */
import { sql, type Kysely } from 'kysely'

const TABLE_OPTIONS = sql.raw('ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci')

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS llm_call_counters (
    site_id CHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    challenge_id VARCHAR(64) NOT NULL,
    purpose VARCHAR(32) NOT NULL,
    used INT NOT NULL,
    PRIMARY KEY (site_id, user_id, challenge_id, purpose)
  ) ${TABLE_OPTIONS}`.execute(db)

  await sql`CREATE TABLE IF NOT EXISTS llm_usage (
    id CHAR(36) NOT NULL PRIMARY KEY,
    site_id CHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    challenge_id VARCHAR(64) NOT NULL,
    purpose VARCHAR(32) NOT NULL,
    provider VARCHAR(32) NOT NULL,
    model VARCHAR(120) NOT NULL,
    credential_source ENUM('platform','byok','oauth') NOT NULL,
    status ENUM('reserved','completed') NOT NULL,
    input_tokens INT NOT NULL DEFAULT 0,
    output_tokens INT NOT NULL DEFAULT 0,
    cost_estimate_usd DECIMAL(12,6) NULL,
    request_id VARCHAR(200) NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    KEY ix_llm_usage_budget (site_id, user_id, credential_source)
  ) ${TABLE_OPTIONS}`.execute(db)

  await sql`CREATE TABLE IF NOT EXISTS llm_credentials (
    site_id CHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    provider VARCHAR(32) NOT NULL,
    ciphertext TEXT NOT NULL,
    iv VARCHAR(64) NOT NULL,
    auth_tag VARCHAR(64) NOT NULL,
    last4 VARCHAR(8) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (site_id, user_id, provider),
    CONSTRAINT fk_llm_credentials_user FOREIGN KEY (user_id) REFERENCES \`user\`(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`.execute(db)

  // An attempt waiting on a model: the action is parked here while the call runs outside any transaction.
  await sql`ALTER TABLE attempts
    ADD COLUMN pending_action JSON NULL,
    ADD COLUMN pending_key VARCHAR(64) NULL,
    ADD COLUMN pending_since DATETIME(3) NULL`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE attempts DROP COLUMN pending_action, DROP COLUMN pending_key, DROP COLUMN pending_since`.execute(db)
  for (const table of ['llm_credentials', 'llm_usage', 'llm_call_counters']) await sql`DROP TABLE IF EXISTS ${sql.table(table)}`.execute(db)
}
