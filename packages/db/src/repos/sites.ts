import { transact } from '../tx'
import type { Db } from '../client'
import { newId } from '../ids'
import { ForbiddenError, NotFoundError, ValidationError, requireRole, type Principal, type Scope } from '../scope'
import type { Role } from '../schema'
import { recordAudit } from './audit'

export interface Site {
  id: string
  slug: string
  name: string
}

/** Idempotent: returns the existing site or creates it. Used by the CLI and tests, not by requests. */
export async function ensureSite(db: Db, slug: string, name: string): Promise<Site> {
  const existing = await db.selectFrom('sites').select(['id', 'slug', 'name']).where('slug', '=', slug).executeTakeFirst()
  if (existing) return existing
  const site = { id: newId(), slug, name }
  await db.insertInto('sites').values({ ...site, created_at: new Date() }).execute()
  return site
}

export async function findSiteBySlug(db: Db, slug: string): Promise<Site | null> {
  return (await db.selectFrom('sites').select(['id', 'slug', 'name']).where('slug', '=', slug).executeTakeFirst()) ?? null
}

/**
 * Resolves who a signed-in user is on this site. Accounts are install-wide:
 * someone with no membership here joins as a learner on first visit, unless
 * the site is closed to new people (`autoJoin: false`), in which case they
 * are not a member (null) until an admin adds them.
 */
export async function principalFor(db: Db, siteId: string, userId: string, options: { autoJoin?: boolean } = {}): Promise<Principal | null> {
  const row = await db
    .selectFrom('memberships')
    .select('role')
    .where('site_id', '=', siteId)
    .where('user_id', '=', userId)
    .executeTakeFirst()
  if (row) return { userId, role: row.role }
  if (options.autoJoin === false) return null
  await db
    .insertInto('memberships')
    .values({ site_id: siteId, user_id: userId, role: 'learner', created_at: new Date() })
    .onDuplicateKeyUpdate({ role: (eb) => eb.ref('role') })
    .execute()
  return { userId, role: 'learner' }
}

/** Bootstrap only (CLI `create-admin`): bypasses the scope check on purpose. */
export async function grantRoleUnchecked(db: Db, siteId: string, userId: string, role: Role): Promise<void> {
  await db
    .insertInto('memberships')
    .values({ site_id: siteId, user_id: userId, role, created_at: new Date() })
    .onDuplicateKeyUpdate({ role })
    .execute()
}

export interface Member {
  userId: string
  name: string
  email: string
  role: Role
}

export async function listMembers(db: Db, scope: Scope): Promise<Member[]> {
  requireRole(scope, 'admin')
  const rows = await db
    .selectFrom('memberships')
    .innerJoin('user', 'user.id', 'memberships.user_id')
    .select(['memberships.user_id as userId', 'user.name as name', 'user.email as email', 'memberships.role as role'])
    .where('memberships.site_id', '=', scope.siteId)
    .orderBy('user.email')
    .limit(1000)
    .execute()
  return rows
}

export async function setRole(db: Db, scope: Scope, userId: string, role: Role): Promise<void> {
  const admin = requireRole(scope, 'admin')
  if (admin.userId === userId && role !== 'admin') {
    throw new ForbiddenError('You cannot remove your own admin role.')
  }
  await transact(db, async (trx) => {
    const current = await trx
      .selectFrom('memberships')
      .select('role')
      .where('site_id', '=', scope.siteId)
      .where('user_id', '=', userId)
      .forUpdate()
      .executeTakeFirst()
    if (!current) throw new NotFoundError('That person is not a member of this site.')
    if (current.role === role) return
    await trx.updateTable('memberships').set({ role }).where('site_id', '=', scope.siteId).where('user_id', '=', userId).execute()
    await recordAudit(trx, scope, { action: 'role.changed', targetType: 'user', targetId: userId, details: { from: current.role, to: role } })
  })
}

/** An admin adds an existing account (by email) to this site with a role: how people join a closed site. */
export async function addMember(db: Db, scope: Scope, email: string, role: Role): Promise<Member> {
  requireRole(scope, 'admin')
  const person = await db.selectFrom('user').select(['id', 'name', 'email']).where('email', '=', email.trim().toLowerCase()).executeTakeFirst()
  if (!person) throw new ValidationError('No account has that email. Ask them to create one (on any site of this installation) first.')
  await transact(db, async (trx) => {
    await trx.insertInto('memberships').values({ site_id: scope.siteId, user_id: person.id, role, created_at: new Date() }).onDuplicateKeyUpdate({ role }).execute()
    await recordAudit(trx, scope, { action: 'role.changed', targetType: 'user', targetId: person.id, details: { from: null, to: role, added: true } })
  })
  return { userId: person.id, name: person.name, email: person.email, role }
}
