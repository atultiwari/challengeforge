/**
 * Organisations and cohorts (Phase 3, Q3). An organisation is a school or
 * department on a site; a cohort is a class within it, joined by code, with
 * assignments (packs or single challenges) and optional due dates.
 */
import { sql, type Kysely } from 'kysely'

const TABLE_OPTIONS = sql.raw('ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci')

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`CREATE TABLE IF NOT EXISTS organisations (
    id CHAR(36) NOT NULL PRIMARY KEY,
    site_id CHAR(36) NOT NULL,
    slug VARCHAR(64) NOT NULL,
    name VARCHAR(200) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_org_slug (site_id, slug)
  ) ${TABLE_OPTIONS}`.execute(db)
  await sql`CREATE TABLE IF NOT EXISTS org_members (
    org_id CHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    site_id CHAR(36) NOT NULL,
    role ENUM('member','instructor','org_admin') NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (org_id, user_id),
    KEY ix_org_members_user (site_id, user_id),
    CONSTRAINT fk_org_members_org FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`.execute(db)
  await sql`CREATE TABLE IF NOT EXISTS cohorts (
    id CHAR(36) NOT NULL PRIMARY KEY,
    site_id CHAR(36) NOT NULL,
    org_id CHAR(36) NOT NULL,
    name VARCHAR(200) NOT NULL,
    join_code VARCHAR(16) NOT NULL,
    joining_open BOOLEAN NOT NULL DEFAULT TRUE,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_by VARCHAR(36) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    UNIQUE KEY uq_cohort_code (join_code),
    KEY ix_cohorts_org (org_id),
    CONSTRAINT fk_cohorts_org FOREIGN KEY (org_id) REFERENCES organisations(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`.execute(db)
  await sql`CREATE TABLE IF NOT EXISTS cohort_members (
    cohort_id CHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    site_id CHAR(36) NOT NULL,
    role ENUM('learner','instructor') NOT NULL,
    joined_at DATETIME(3) NOT NULL,
    PRIMARY KEY (cohort_id, user_id),
    KEY ix_cohort_members_user (site_id, user_id),
    CONSTRAINT fk_cohort_members_cohort FOREIGN KEY (cohort_id) REFERENCES cohorts(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`.execute(db)
  await sql`CREATE TABLE IF NOT EXISTS cohort_assignments (
    id CHAR(36) NOT NULL PRIMARY KEY,
    cohort_id CHAR(36) NOT NULL,
    site_id CHAR(36) NOT NULL,
    pack_id CHAR(36) NULL,
    challenge_id CHAR(36) NULL,
    due_at DATETIME(3) NULL,
    position INT NOT NULL DEFAULT 0,
    created_at DATETIME(3) NOT NULL,
    KEY ix_assignments_cohort (cohort_id, position),
    CONSTRAINT fk_assignments_cohort FOREIGN KEY (cohort_id) REFERENCES cohorts(id) ON DELETE CASCADE,
    CONSTRAINT fk_assignments_pack FOREIGN KEY (pack_id) REFERENCES packs(id) ON DELETE CASCADE,
    CONSTRAINT fk_assignments_challenge FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  for (const table of ['cohort_assignments', 'cohort_members', 'cohorts', 'org_members', 'organisations']) {
    await sql`DROP TABLE IF EXISTS ${sql.table(table)}`.execute(db)
  }
}
