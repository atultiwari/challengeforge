/**
 * Initial schema. Written to the MySQL 8.0 ∩ MariaDB 10.6+ subset
 * (PLAN.md §6.1): JSON columns, DATETIME(3) in UTC, InnoDB, utf8mb4, and
 * app-generated CHAR(36) ids. Every content and play table carries site_id.
 */
import { sql, type Kysely } from 'kysely'

const TABLE_OPTIONS = sql.raw('ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci')

const STATEMENTS = [
  sql`CREATE TABLE sites (
    id CHAR(36) NOT NULL PRIMARY KEY,
    slug VARCHAR(64) NOT NULL,
    name VARCHAR(200) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_sites_slug (slug)
  ) ${TABLE_OPTIONS}`,

  // Better Auth core tables (its column names).
  sql`CREATE TABLE \`user\` (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    name TEXT NOT NULL,
    email VARCHAR(255) NOT NULL,
    emailVerified BOOLEAN NOT NULL DEFAULT FALSE,
    image TEXT NULL,
    createdAt DATETIME(3) NOT NULL,
    updatedAt DATETIME(3) NOT NULL,
    UNIQUE KEY uq_user_email (email)
  ) ${TABLE_OPTIONS}`,
  sql`CREATE TABLE session (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    expiresAt DATETIME(3) NOT NULL,
    token VARCHAR(255) NOT NULL,
    createdAt DATETIME(3) NOT NULL,
    updatedAt DATETIME(3) NOT NULL,
    ipAddress TEXT NULL,
    userAgent TEXT NULL,
    userId VARCHAR(36) NOT NULL,
    UNIQUE KEY uq_session_token (token),
    KEY ix_session_user (userId),
    CONSTRAINT fk_session_user FOREIGN KEY (userId) REFERENCES \`user\`(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`,
  sql`CREATE TABLE account (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    accountId TEXT NOT NULL,
    providerId TEXT NOT NULL,
    userId VARCHAR(36) NOT NULL,
    accessToken TEXT NULL,
    refreshToken TEXT NULL,
    idToken TEXT NULL,
    accessTokenExpiresAt DATETIME(3) NULL,
    refreshTokenExpiresAt DATETIME(3) NULL,
    scope TEXT NULL,
    password TEXT NULL,
    createdAt DATETIME(3) NOT NULL,
    updatedAt DATETIME(3) NOT NULL,
    KEY ix_account_user (userId),
    CONSTRAINT fk_account_user FOREIGN KEY (userId) REFERENCES \`user\`(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`,
  sql`CREATE TABLE verification (
    id VARCHAR(36) NOT NULL PRIMARY KEY,
    identifier VARCHAR(255) NOT NULL,
    value TEXT NOT NULL,
    expiresAt DATETIME(3) NOT NULL,
    createdAt DATETIME(3) NOT NULL,
    updatedAt DATETIME(3) NOT NULL,
    KEY ix_verification_identifier (identifier)
  ) ${TABLE_OPTIONS}`,

  sql`CREATE TABLE memberships (
    site_id CHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    role ENUM('learner','author','admin') NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (site_id, user_id),
    KEY ix_memberships_user (user_id),
    CONSTRAINT fk_memberships_site FOREIGN KEY (site_id) REFERENCES sites(id),
    CONSTRAINT fk_memberships_user FOREIGN KEY (user_id) REFERENCES \`user\`(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`,

  sql`CREATE TABLE packs (
    id CHAR(36) NOT NULL PRIMARY KEY,
    site_id CHAR(36) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    title VARCHAR(200) NOT NULL,
    description TEXT NOT NULL,
    created_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_packs_site_slug (site_id, slug),
    CONSTRAINT fk_packs_site FOREIGN KEY (site_id) REFERENCES sites(id)
  ) ${TABLE_OPTIONS}`,
  sql`CREATE TABLE pack_sections (
    id CHAR(36) NOT NULL PRIMARY KEY,
    pack_id CHAR(36) NOT NULL,
    slug VARCHAR(100) NOT NULL,
    title VARCHAR(200) NOT NULL,
    position INT NOT NULL,
    UNIQUE KEY uq_sections_pack_slug (pack_id, slug),
    CONSTRAINT fk_sections_pack FOREIGN KEY (pack_id) REFERENCES packs(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`,

  sql`CREATE TABLE challenges (
    id CHAR(36) NOT NULL PRIMARY KEY,
    site_id CHAR(36) NOT NULL,
    pack_id CHAR(36) NULL,
    section_id CHAR(36) NULL,
    slug VARCHAR(100) NOT NULL,
    type_id VARCHAR(64) NOT NULL,
    type_version INT NOT NULL,
    title VARCHAR(300) NOT NULL,
    status ENUM('draft','in_review','published','archived') NOT NULL,
    position INT NOT NULL DEFAULT 0,
    published_version_id CHAR(36) NULL,
    created_by VARCHAR(36) NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_challenges_site_slug (site_id, slug),
    KEY ix_challenges_section (section_id, position),
    CONSTRAINT fk_challenges_site FOREIGN KEY (site_id) REFERENCES sites(id),
    CONSTRAINT fk_challenges_pack FOREIGN KEY (pack_id) REFERENCES packs(id),
    CONSTRAINT fk_challenges_section FOREIGN KEY (section_id) REFERENCES pack_sections(id)
  ) ${TABLE_OPTIONS}`,
  sql`CREATE TABLE challenge_versions (
    id CHAR(36) NOT NULL PRIMARY KEY,
    challenge_id CHAR(36) NOT NULL,
    version INT NOT NULL,
    definition JSON NOT NULL,
    created_by VARCHAR(36) NULL,
    created_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_versions_challenge_version (challenge_id, version),
    CONSTRAINT fk_versions_challenge FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`,

  sql`CREATE TABLE assets (
    id CHAR(36) NOT NULL PRIMARY KEY,
    site_id CHAR(36) NOT NULL,
    pack_id CHAR(36) NULL,
    challenge_id CHAR(36) NULL,
    path VARCHAR(300) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    visibility ENUM('public','gated') NOT NULL,
    bytes MEDIUMBLOB NOT NULL,
    sha256 CHAR(64) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_assets_challenge_path (challenge_id, path),
    CONSTRAINT fk_assets_site FOREIGN KEY (site_id) REFERENCES sites(id),
    CONSTRAINT fk_assets_challenge FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`,

  sql`CREATE TABLE attempts (
    id CHAR(36) NOT NULL PRIMARY KEY,
    site_id CHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    challenge_id CHAR(36) NOT NULL,
    challenge_version_id CHAR(36) NOT NULL,
    type_id VARCHAR(64) NOT NULL,
    type_version INT NOT NULL,
    is_preview BOOLEAN NOT NULL DEFAULT FALSE,
    seed INT NOT NULL,
    seq INT NOT NULL,
    status ENUM('open','terminal') NOT NULL,
    state JSON NOT NULL,
    started_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    ended_at DATETIME(3) NULL,
    KEY ix_attempts_user_challenge (user_id, challenge_id, status),
    CONSTRAINT fk_attempts_site FOREIGN KEY (site_id) REFERENCES sites(id),
    CONSTRAINT fk_attempts_user FOREIGN KEY (user_id) REFERENCES \`user\`(id) ON DELETE CASCADE,
    CONSTRAINT fk_attempts_challenge FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE,
    CONSTRAINT fk_attempts_version FOREIGN KEY (challenge_version_id) REFERENCES challenge_versions(id)
  ) ${TABLE_OPTIONS}`,
  sql`CREATE TABLE attempt_events (
    attempt_id CHAR(36) NOT NULL,
    seq INT NOT NULL,
    action JSON NOT NULL,
    effects JSON NULL,
    at DATETIME(3) NOT NULL,
    idempotency_key VARCHAR(64) NULL,
    PRIMARY KEY (attempt_id, seq),
    UNIQUE KEY uq_events_idempotency (attempt_id, idempotency_key),
    CONSTRAINT fk_events_attempt FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`,
  sql`CREATE TABLE assessments (
    attempt_id CHAR(36) NOT NULL PRIMARY KEY,
    criteria JSON NOT NULL,
    score DOUBLE NOT NULL,
    max DOUBLE NOT NULL,
    passed BOOLEAN NOT NULL,
    critical_failure BOOLEAN NOT NULL,
    status ENUM('auto','pending_review','overridden') NOT NULL,
    points INT NOT NULL,
    reviewer_id VARCHAR(36) NULL,
    created_at DATETIME(3) NOT NULL,
    updated_at DATETIME(3) NOT NULL,
    CONSTRAINT fk_assessments_attempt FOREIGN KEY (attempt_id) REFERENCES attempts(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`,
  sql`CREATE TABLE progress (
    site_id CHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    challenge_id CHAR(36) NOT NULL,
    attempts INT NOT NULL,
    best_points INT NOT NULL,
    best_score_fraction DOUBLE NOT NULL,
    passed_at DATETIME(3) NULL,
    updated_at DATETIME(3) NOT NULL,
    PRIMARY KEY (site_id, user_id, challenge_id),
    CONSTRAINT fk_progress_user FOREIGN KEY (user_id) REFERENCES \`user\`(id) ON DELETE CASCADE,
    CONSTRAINT fk_progress_challenge FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`,
]

const TABLES_IN_DROP_ORDER = [
  'progress', 'assessments', 'attempt_events', 'attempts', 'assets', 'challenge_versions', 'challenges',
  'pack_sections', 'packs', 'memberships', 'verification', 'account', 'session', 'user', 'sites',
]

export async function up(db: Kysely<unknown>): Promise<void> {
  for (const statement of STATEMENTS) await statement.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of TABLES_IN_DROP_ORDER) await sql`DROP TABLE IF EXISTS ${sql.table(table)}`.execute(db)
}
