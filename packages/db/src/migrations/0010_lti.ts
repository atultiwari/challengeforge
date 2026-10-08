/**
 * LTI 1.3 (Phase 3, Q7): ChallengeForge as a tool inside an LMS (Moodle,
 * Canvas, Blackboard, Brightspace). Platforms are registered by an admin;
 * launches are single-use (state + nonce); LMS users are linked by
 * (platform, sub), never by email; scores go back through an outbox.
 */
import { sql, type Kysely } from 'kysely'

const TABLE_OPTIONS = sql.raw('ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci')

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS lti_platforms (
    id CHAR(36) NOT NULL PRIMARY KEY,
    site_id CHAR(36) NOT NULL,
    name VARCHAR(200) NOT NULL,
    issuer VARCHAR(255) NOT NULL,
    client_id VARCHAR(255) NOT NULL,
    auth_login_url VARCHAR(500) NOT NULL,
    auth_token_url VARCHAR(500) NOT NULL,
    jwks_url VARCHAR(500) NOT NULL,
    deployment_ids JSON NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_lti_platform (site_id, issuer, client_id)
  ) ${TABLE_OPTIONS}`.execute(db)
  await sql`CREATE TABLE IF NOT EXISTS lti_keys (
    kid VARCHAR(64) NOT NULL PRIMARY KEY,
    site_id CHAR(36) NOT NULL,
    public_jwk JSON NOT NULL,
    private_jwk_sealed TEXT NOT NULL,
    active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at DATETIME(3) NOT NULL,
    KEY ix_lti_keys_site (site_id, active)
  ) ${TABLE_OPTIONS}`.execute(db)
  await sql`CREATE TABLE IF NOT EXISTS lti_states (
    state VARCHAR(64) NOT NULL PRIMARY KEY,
    site_id CHAR(36) NOT NULL,
    platform_id CHAR(36) NOT NULL,
    nonce VARCHAR(64) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    used_at DATETIME(3) NULL,
    KEY ix_lti_states_expiry (expires_at)
  ) ${TABLE_OPTIONS}`.execute(db)
  await sql`CREATE TABLE IF NOT EXISTS lti_users (
    platform_id CHAR(36) NOT NULL,
    sub VARCHAR(255) NOT NULL,
    site_id CHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (platform_id, sub),
    KEY ix_lti_users_user (user_id),
    CONSTRAINT fk_lti_users_platform FOREIGN KEY (platform_id) REFERENCES lti_platforms(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`.execute(db)
  await sql`CREATE TABLE IF NOT EXISTS lti_tickets (
    ticket VARCHAR(64) NOT NULL PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    used_at DATETIME(3) NULL
  ) ${TABLE_OPTIONS}`.execute(db)
  await sql`CREATE TABLE IF NOT EXISTS lti_links (
    id CHAR(36) NOT NULL PRIMARY KEY,
    site_id CHAR(36) NOT NULL,
    platform_id CHAR(36) NOT NULL,
    deployment_id VARCHAR(255) NOT NULL,
    resource_link_id VARCHAR(255) NOT NULL,
    context_id VARCHAR(255) NULL,
    context_title VARCHAR(300) NULL,
    challenge_id CHAR(36) NOT NULL,
    lineitem_url VARCHAR(500) NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_lti_link (platform_id, deployment_id, resource_link_id),
    KEY ix_lti_links_challenge (challenge_id),
    CONSTRAINT fk_lti_links_platform FOREIGN KEY (platform_id) REFERENCES lti_platforms(id) ON DELETE CASCADE,
    CONSTRAINT fk_lti_links_challenge FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`.execute(db)
  await sql`CREATE TABLE IF NOT EXISTS lti_link_users (
    link_id CHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    sub VARCHAR(255) NOT NULL,
    last_launch_at DATETIME(3) NOT NULL,
    PRIMARY KEY (link_id, user_id),
    KEY ix_lti_link_users_user (user_id),
    CONSTRAINT fk_lti_link_users_link FOREIGN KEY (link_id) REFERENCES lti_links(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`.execute(db)
  await sql`CREATE TABLE IF NOT EXISTS lti_deep_links (
    id CHAR(36) NOT NULL PRIMARY KEY,
    site_id CHAR(36) NOT NULL,
    platform_id CHAR(36) NOT NULL,
    deployment_id VARCHAR(255) NOT NULL,
    return_url VARCHAR(500) NOT NULL,
    data TEXT NULL,
    user_id VARCHAR(36) NOT NULL,
    expires_at DATETIME(3) NOT NULL,
    used_at DATETIME(3) NULL
  ) ${TABLE_OPTIONS}`.execute(db)
  await sql`CREATE TABLE IF NOT EXISTS lti_score_outbox (
    id CHAR(36) NOT NULL PRIMARY KEY,
    site_id CHAR(36) NOT NULL,
    link_id CHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    sub VARCHAR(255) NOT NULL,
    score_given DECIMAL(10,4) NOT NULL,
    score_maximum DECIMAL(10,4) NOT NULL,
    grading_progress VARCHAR(32) NOT NULL,
    status ENUM('pending','sent','failed') NOT NULL,
    failures INT NOT NULL DEFAULT 0,
    next_attempt_at DATETIME(3) NOT NULL,
    last_error VARCHAR(500) NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_lti_score (link_id, user_id),
    KEY ix_lti_score_due (status, next_attempt_at),
    CONSTRAINT fk_lti_score_link FOREIGN KEY (link_id) REFERENCES lti_links(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of ['lti_score_outbox', 'lti_deep_links', 'lti_link_users', 'lti_links', 'lti_tickets', 'lti_users', 'lti_states', 'lti_keys', 'lti_platforms']) {
    await sql`DROP TABLE IF EXISTS ${sql.table(table)}`.execute(db)
  }
}
