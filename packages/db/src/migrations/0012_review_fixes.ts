/**
 * Phase 3 review fixes:
 *   - an LMS platform grants access to restricted packs only when an admin says so;
 *   - a cohort cannot be assigned the same pack or challenge twice, even under a race.
 */
import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE lti_platforms ADD COLUMN grants_access BOOLEAN NOT NULL DEFAULT FALSE`.execute(db)
  // NULLs never collide in a unique key, so these allow one pack row and one challenge row per target.
  await sql`ALTER TABLE cohort_assignments ADD UNIQUE KEY uq_assignment_pack (cohort_id, pack_id), ADD UNIQUE KEY uq_assignment_challenge (cohort_id, challenge_id)`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE cohort_assignments DROP INDEX uq_assignment_pack, DROP INDEX uq_assignment_challenge`.execute(db)
  await sql`ALTER TABLE lti_platforms DROP COLUMN grants_access`.execute(db)
}
