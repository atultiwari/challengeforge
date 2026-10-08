/** Phase 4 review: an LTI session ticket is redeemable only on the site that issued it. */
import { sql, type Kysely } from 'kysely'

export async function up(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE lti_tickets ADD COLUMN site_id CHAR(36) NULL`.execute(db)
}

export async function down(db: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE lti_tickets DROP COLUMN site_id`.execute(db)
}
