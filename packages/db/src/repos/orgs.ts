/**
 * Organisations (Phase 3, Q3): a school or department inside a site.
 * Site admins create organisations and name their org admins; org admins
 * manage the organisation's instructors; instructors run cohorts.
 */
import type { Db } from '../client'
import { newId } from '../ids'
import { ForbiddenError, NotFoundError, ValidationError, hasRole, requireRole, requireSignedIn, type Scope } from '../scope'
import type { OrgRole } from '../schema'
import { recordAudit } from './audit'
import { normaliseEmail, type EmailLookup } from './people'

export interface Organisation {
  id: string
  slug: string
  name: string
}

export interface OrgMembership extends Organisation {
  /** The caller's role here; site admins act as `org_admin` everywhere. */
  role: OrgRole
}

export interface OrgMember {
  userId: string
  name: string
  email: string
  role: OrgRole
}

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/

/**
 * Takes away cohort roles in an organisation's cohorts: instructor seats when
 * someone stops being an instructor, every seat when they leave it.
 */
async function dropCohortSeats(trx: Db, orgId: string, userId: string, which: 'instructor' | 'all'): Promise<void> {
  let query = trx
    .deleteFrom('cohort_members')
    .where('user_id', '=', userId)
    .where('cohort_id', 'in', (eb) => eb.selectFrom('cohorts').select('id').where('org_id', '=', orgId))
  if (which === 'instructor') query = query.where('role', '=', 'instructor')
  await query.execute()
}
const RANK: Record<OrgRole, number> = { member: 1, instructor: 2, org_admin: 3 }

/** The caller's role in an organisation, or null. Site admins are org admins of every organisation. */
export async function orgRoleOf(db: Db, scope: Scope, orgId: string): Promise<OrgRole | null> {
  if (!scope.principal) return null
  const org = await db.selectFrom('organisations').select('id').where('id', '=', orgId).where('site_id', '=', scope.siteId).executeTakeFirst()
  if (!org) return null
  if (hasRole(scope, 'admin')) return 'org_admin'
  const row = await db
    .selectFrom('org_members')
    .select('role')
    .where('org_id', '=', orgId)
    .where('user_id', '=', scope.principal.userId)
    .where('site_id', '=', scope.siteId)
    .executeTakeFirst()
  return row?.role ?? null
}

/** Throws unless the caller holds at least `minimum` in the organisation; an unrelated caller gets "not found". */
export async function requireOrgRole(db: Db, scope: Scope, orgId: string, minimum: OrgRole): Promise<OrgRole> {
  requireSignedIn(scope)
  const role = await orgRoleOf(db, scope, orgId)
  if (role === null) throw new NotFoundError('Organisation not found.')
  if (RANK[role] < RANK[minimum]) throw new ForbiddenError()
  return role
}

export async function createOrganisation(db: Db, scope: Scope, input: { slug: string; name: string }): Promise<Organisation> {
  requireRole(scope, 'admin')
  const slug = input.slug.trim().toLowerCase()
  const name = input.name.trim()
  if (!SLUG.test(slug)) throw new ValidationError('The short name must be 2–63 lowercase letters, digits or hyphens.')
  if (name === '' || name.length > 200) throw new ValidationError('Give the organisation a name (up to 200 characters).')
  const taken = await db.selectFrom('organisations').select('id').where('site_id', '=', scope.siteId).where('slug', '=', slug).executeTakeFirst()
  if (taken) throw new ValidationError('That short name is already used.')
  const org = { id: newId(), slug, name }
  await db.transaction().execute(async (trx) => {
    await trx.insertInto('organisations').values({ ...org, site_id: scope.siteId, created_at: new Date() }).execute()
    await recordAudit(trx, scope, { action: 'org.created', targetType: 'org', targetId: org.id, details: { slug, name } })
  })
  return org
}

/** Organisations the caller belongs to (all of them for a site admin), with their role in each. */
export async function listMyOrganisations(db: Db, scope: Scope): Promise<OrgMembership[]> {
  const p = requireSignedIn(scope)
  if (hasRole(scope, 'admin')) {
    const all = await db.selectFrom('organisations').select(['id', 'slug', 'name']).where('site_id', '=', scope.siteId).orderBy('name').limit(500).execute()
    return all.map((o) => ({ ...o, role: 'org_admin' as const }))
  }
  return db
    .selectFrom('org_members')
    .innerJoin('organisations', 'organisations.id', 'org_members.org_id')
    .select(['organisations.id as id', 'organisations.slug as slug', 'organisations.name as name', 'org_members.role as role'])
    .where('org_members.site_id', '=', scope.siteId)
    .where('org_members.user_id', '=', p.userId)
    .orderBy('organisations.name')
    .limit(500)
    .execute()
}

/** True when the caller teaches anywhere: a site admin, or an instructor or org admin of some organisation. */
export async function isTeacher(db: Db, scope: Scope): Promise<boolean> {
  if (!scope.principal) return false
  if (hasRole(scope, 'admin')) return true
  const row = await db
    .selectFrom('org_members')
    .select('org_id')
    .where('site_id', '=', scope.siteId)
    .where('user_id', '=', scope.principal.userId)
    .where('role', 'in', ['instructor', 'org_admin'])
    .executeTakeFirst()
  return row !== undefined
}

export async function getOrganisation(db: Db, scope: Scope, orgId: string): Promise<OrgMembership> {
  const role = await requireOrgRole(db, scope, orgId, 'member')
  const org = await db.selectFrom('organisations').select(['id', 'slug', 'name']).where('id', '=', orgId).executeTakeFirstOrThrow()
  return { ...org, role }
}

export async function listOrgMembers(db: Db, scope: Scope, orgId: string): Promise<OrgMember[]> {
  await requireOrgRole(db, scope, orgId, 'instructor')
  return db
    .selectFrom('org_members')
    .innerJoin('user', 'user.id', 'org_members.user_id')
    .select(['user.id as userId', 'user.name as name', 'user.email as email', 'org_members.role as role'])
    .where('org_members.org_id', '=', orgId)
    .orderBy('org_members.role', 'desc')
    .orderBy('user.email')
    .limit(2000)
    .execute()
}

/**
 * Gives someone a role in the organisation, by email. Only an org admin may
 * do this, and only a site admin may create or remove other org admins.
 */
export async function setOrgMember(db: Db, scope: Scope, orgId: string, email: string, role: OrgRole, lookup: EmailLookup = {}): Promise<OrgMember> {
  await requireOrgRole(db, scope, orgId, 'org_admin')
  if (role === 'org_admin' && !hasRole(scope, 'admin')) throw new ForbiddenError('Only a site admin can name organisation admins.')
  const person = await db
    .selectFrom('user')
    .innerJoin('memberships', 'memberships.user_id', 'user.id')
    .select(['user.id as userId', 'user.name as name', 'user.email as email'])
    .where('memberships.site_id', '=', scope.siteId)
    .where('user.email', '=', normaliseEmail(email))
    .$if(lookup.verifiedOnly === true, (q) => q.where('user.emailVerified', '=', true))
    .executeTakeFirst()
  if (!person) throw new ValidationError('Nobody on this site has that email. Ask them to create an account first.')
  await db.transaction().execute(async (trx) => {
    const current = await trx.selectFrom('org_members').select('role').where('org_id', '=', orgId).where('user_id', '=', person.userId).forUpdate().executeTakeFirst()
    if (current?.role === 'org_admin' && role !== 'org_admin' && !hasRole(scope, 'admin')) throw new ForbiddenError('Only a site admin can change an organisation admin.')
    if (current?.role === role) return
    await trx
      .insertInto('org_members')
      .values({ org_id: orgId, user_id: person.userId, site_id: scope.siteId, role, created_at: new Date() })
      .onDuplicateKeyUpdate({ role })
      .execute()
    // Demoted to member: they no longer run any of this organisation's cohorts.
    if (role === 'member') await dropCohortSeats(trx, orgId, person.userId, 'instructor')
    await recordAudit(trx, scope, { action: 'org.member_set', targetType: 'org', targetId: orgId, details: { userId: person.userId, from: current?.role ?? null, to: role } })
  })
  return { ...person, role }
}

export async function removeOrgMember(db: Db, scope: Scope, orgId: string, userId: string): Promise<void> {
  await requireOrgRole(db, scope, orgId, 'org_admin')
  await db.transaction().execute(async (trx) => {
    const current = await trx.selectFrom('org_members').select('role').where('org_id', '=', orgId).where('user_id', '=', userId).forUpdate().executeTakeFirst()
    if (!current) return
    if (current.role === 'org_admin' && !hasRole(scope, 'admin')) throw new ForbiddenError('Only a site admin can remove an organisation admin.')
    await trx.deleteFrom('org_members').where('org_id', '=', orgId).where('user_id', '=', userId).execute()
    await dropCohortSeats(trx, orgId, userId, 'all')
    await recordAudit(trx, scope, { action: 'org.member_removed', targetType: 'org', targetId: orgId, details: { userId, role: current.role } })
  })
}
