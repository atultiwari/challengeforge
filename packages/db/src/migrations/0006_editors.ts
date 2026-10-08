/**
 * Multi-author roles (Phase 3, Q2): an `editor` role between author and
 * admin, and co-authors per challenge.
 */
import { sql, type Kysely } from 'kysely'

const TABLE_OPTIONS = sql.raw('ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci')

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE memberships MODIFY role ENUM('learner','author','editor','admin') NOT NULL`.execute(db)
  await sql`CREATE TABLE IF NOT EXISTS challenge_collaborators (
    challenge_id CHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    site_id CHAR(36) NOT NULL,
    added_by VARCHAR(64) NOT NULL,
    created_at DATETIME(3) NOT NULL,
    PRIMARY KEY (challenge_id, user_id),
    KEY ix_collab_user (site_id, user_id),
    CONSTRAINT fk_collab_challenge FOREIGN KEY (challenge_id) REFERENCES challenges(id) ON DELETE CASCADE
  ) ${TABLE_OPTIONS}`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS challenge_collaborators`.execute(db)
  await sql`UPDATE memberships SET role = 'author' WHERE role = 'editor'`.execute(db)
  await sql`ALTER TABLE memberships MODIFY role ENUM('learner','author','admin') NOT NULL`.execute(db)
}
