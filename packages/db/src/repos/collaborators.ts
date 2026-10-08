/**
 * Who may edit a challenge (Phase 3, Q2): its creator, its co-authors, and
 * editors and admins. Every edit path asks `canEdit`, so the rule lives in
 * one place.
 */
import { transact } from '../tx'
import type { Db } from '../client'
import { ForbiddenError, NotFoundError, ValidationError, hasRole, requireRole, type Scope } from '../scope'
import { recordAudit } from './audit'
import { normaliseEmail, type EmailLookup } from './people'

const MAX_COLLABORATORS = 20

export interface Collaborator {
  userId: string
  name: string
  email: string
}

/** True when the caller may edit a challenge with this creator. */
export async function canEdit(db: Db, scope: Scope, challenge: { id: string; created_by: string | null }): Promise<boolean> {
  if (!hasRole(scope, 'author') || !scope.principal) return false
  if (hasRole(scope, 'editor') || challenge.created_by === scope.principal.userId) return true
  const row = await db
    .selectFrom('challenge_collaborators')
    .select('user_id')
    .where('challenge_id', '=', challenge.id)
    .where('user_id', '=', scope.principal.userId)
    .where('site_id', '=', scope.siteId)
    .executeTakeFirst()
  return row !== undefined
}

/** Loads the challenge and checks the caller may manage its co-authors (the creator, or an editor). */
async function loadManaged(db: Db, scope: Scope, challengeId: string) {
  const p = requireRole(scope, 'author')
  const row = await db
    .selectFrom('challenges')
    .select(['id', 'created_by'])
    .where('id', '=', challengeId)
    .where('site_id', '=', scope.siteId)
    .executeTakeFirst()
  if (!row) throw new NotFoundError('Challenge not found.')
  if (!hasRole(scope, 'editor') && row.created_by !== p.userId) throw new ForbiddenError('Only the challenge\'s creator or an editor can change its co-authors.')
  return row
}

export async function listCollaborators(db: Db, scope: Scope, challengeId: string): Promise<Collaborator[]> {
  const row = await db.selectFrom('challenges').select(['id', 'created_by']).where('id', '=', challengeId).where('site_id', '=', scope.siteId).executeTakeFirst()
  if (!row || !(await canEdit(db, scope, row))) throw new NotFoundError('Challenge not found.')
  return db
    .selectFrom('challenge_collaborators')
    .innerJoin('user', 'user.id', 'challenge_collaborators.user_id')
    .select(['user.id as userId', 'user.name as name', 'user.email as email'])
    .where('challenge_collaborators.challenge_id', '=', challengeId)
    .orderBy('user.email')
    .execute()
}

/** Adds a co-author by email. They must already have an author (or higher) role on this site. */
export async function addCollaborator(db: Db, scope: Scope, challengeId: string, email: string, lookup: EmailLookup = {}): Promise<Collaborator> {
  const challenge = await loadManaged(db, scope, challengeId)
  const person = await db
    .selectFrom('user')
    .innerJoin('memberships', 'memberships.user_id', 'user.id')
    .select(['user.id as userId', 'user.name as name', 'user.email as email', 'memberships.role as role'])
    .where('memberships.site_id', '=', scope.siteId)
    .where('user.email', '=', normaliseEmail(email))
    .$if(lookup.verifiedOnly === true, (q) => q.where('user.emailVerified', '=', true))
    .executeTakeFirst()
  // One message for "no such person" and "not an author", so emails cannot be probed.
  if (!person || person.role === 'learner') throw new ValidationError('No author on this site has that email. An admin can make them an author first.')
  if (person.userId === challenge.created_by) throw new ValidationError('That person created this challenge.')
  const count = await db.selectFrom('challenge_collaborators').select((eb) => eb.fn.countAll<string>().as('n')).where('challenge_id', '=', challengeId).executeTakeFirst()
  if (Number(count?.n ?? 0) >= MAX_COLLABORATORS) throw new ValidationError(`A challenge can have at most ${MAX_COLLABORATORS} co-authors.`)
  await transact(db, async (trx) => {
    const result = await trx
      .insertInto('challenge_collaborators')
      .values({ challenge_id: challengeId, user_id: person.userId, site_id: scope.siteId, added_by: scope.principal!.userId, created_at: new Date() })
      .ignore()
      .executeTakeFirst()
    if (Number(result.numInsertedOrUpdatedRows ?? 0) > 0) {
      await recordAudit(trx, scope, { action: 'collaborator.added', targetType: 'challenge', targetId: challengeId, details: { userId: person.userId } })
    }
  })
  return { userId: person.userId, name: person.name, email: person.email }
}

export async function removeCollaborator(db: Db, scope: Scope, challengeId: string, userId: string): Promise<void> {
  await loadManaged(db, scope, challengeId)
  await transact(db, async (trx) => {
    const result = await trx.deleteFrom('challenge_collaborators').where('challenge_id', '=', challengeId).where('user_id', '=', userId).executeTakeFirst()
    if (Number(result.numDeletedRows) > 0) {
      await recordAudit(trx, scope, { action: 'collaborator.removed', targetType: 'challenge', targetId: challengeId, details: { userId } })
    }
  })
}
