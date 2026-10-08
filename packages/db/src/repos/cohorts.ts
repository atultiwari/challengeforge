/**
 * Cohorts (Phase 3, Q3): a class inside an organisation. Learners join with
 * a code; instructors set assignments (whole packs or single challenges)
 * with optional due dates. Org admins (and site admins) manage every cohort
 * of their organisation; an instructor manages the cohorts they teach.
 */
import { randomInt } from 'node:crypto'
import type { Db } from '../client'
import { newId } from '../ids'
import { toBool } from '../json'
import { ForbiddenError, NotFoundError, ValidationError, hasRole, requireSignedIn, type Scope } from '../scope'
import type { CohortRole } from '../schema'
import { recordAudit } from './audit'
import { queueNotification } from './notifications'
import { normaliseEmail, type EmailLookup } from './people'
import { orgRoleOf, requireOrgRole } from './orgs'

export interface Cohort {
  id: string
  orgId: string
  orgName: string
  name: string
  joinCode: string
  joiningOpen: boolean
  archived: boolean
}

export interface Assignment {
  id: string
  packId: string | null
  challengeId: string | null
  title: string
  dueAt: Date | null
}

/** No 0/O or 1/I/L: codes are read aloud and typed from slides. */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const CODE_LENGTH = 8
const MAX_ASSIGNMENTS = 200

export const newJoinCode = (): string => Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')

/** Codes are typed by people: ignore case, spaces and dashes. */
export const normaliseJoinCode = (code: string): string => code.toUpperCase().replace(/[\s-]/g, '')

type CohortRow = { id: string; org_id: string; org_name: string; name: string; join_code: string; joining_open: number | boolean; archived: number | boolean }

const toCohort = (r: CohortRow): Cohort => ({
  id: r.id,
  orgId: r.org_id,
  orgName: r.org_name,
  name: r.name,
  joinCode: r.join_code,
  joiningOpen: toBool(r.joining_open),
  archived: toBool(r.archived),
})

const cohortQuery = (db: Db, siteId: string) =>
  db
    .selectFrom('cohorts')
    .innerJoin('organisations', 'organisations.id', 'cohorts.org_id')
    .select(['cohorts.id as id', 'cohorts.org_id as org_id', 'organisations.name as org_name', 'cohorts.name as name', 'cohorts.join_code as join_code', 'cohorts.joining_open as joining_open', 'cohorts.archived as archived'])
    .where('cohorts.site_id', '=', siteId)

/**
 * The caller's access to a cohort: 'manage' (org admin, site admin, or the
 * cohort's instructor), 'learner', or null.
 */
export async function cohortAccess(db: Db, scope: Scope, cohortId: string): Promise<{ access: 'manage' | 'learner'; cohort: Cohort } | null> {
  if (!scope.principal) return null
  const row = await cohortQuery(db, scope.siteId).where('cohorts.id', '=', cohortId).executeTakeFirst()
  if (!row) return null
  const cohort = toCohort(row)
  if ((await orgRoleOf(db, scope, cohort.orgId)) === 'org_admin') return { access: 'manage', cohort }
  const member = await db.selectFrom('cohort_members').select('role').where('cohort_id', '=', cohortId).where('user_id', '=', scope.principal.userId).executeTakeFirst()
  if (!member) return null
  if (member.role === 'learner') return { access: 'learner', cohort }
  // An instructor seat counts only while they are still an instructor of the organisation.
  const orgRole = await orgRoleOf(db, scope, cohort.orgId)
  return orgRole === 'instructor' ? { access: 'manage', cohort } : null
}

export async function requireCohortManager(db: Db, scope: Scope, cohortId: string): Promise<Cohort> {
  requireSignedIn(scope)
  const found = await cohortAccess(db, scope, cohortId)
  if (!found) throw new NotFoundError('Cohort not found.')
  if (found.access !== 'manage') throw new ForbiddenError()
  return found.cohort
}

/** An instructor (or org admin) creates a cohort and becomes its instructor. */
export async function createCohort(db: Db, scope: Scope, orgId: string, name: string): Promise<Cohort> {
  const p = requireSignedIn(scope)
  await requireOrgRole(db, scope, orgId, 'instructor')
  const clean = name.trim()
  if (clean === '' || clean.length > 200) throw new ValidationError('Give the cohort a name (up to 200 characters).')
  const id = newId()
  const now = new Date()
  for (let tries = 0; ; tries += 1) {
    try {
      await db.transaction().execute(async (trx) => {
        await trx
          .insertInto('cohorts')
          .values({ id, site_id: scope.siteId, org_id: orgId, name: clean, join_code: newJoinCode(), joining_open: true, archived: false, created_by: p.userId, created_at: now })
          .execute()
        await trx.insertInto('cohort_members').values({ cohort_id: id, user_id: p.userId, site_id: scope.siteId, role: 'instructor', joined_at: now }).execute()
        await recordAudit(trx, scope, { action: 'cohort.created', targetType: 'cohort', targetId: id, details: { orgId, name: clean } })
      })
      break
    } catch (err) {
      // A join-code collision (31^8 codes) is astronomically rare; retry with a new one.
      if ((err as { code?: string }).code !== 'ER_DUP_ENTRY' || tries >= 3) throw err
    }
  }
  return (await cohortAccess(db, scope, id))!.cohort
}

export interface CohortUpdate {
  name?: string
  joiningOpen?: boolean
  archived?: boolean
  rotateCode?: boolean
}

export async function updateCohort(db: Db, scope: Scope, cohortId: string, update: CohortUpdate): Promise<Cohort> {
  await requireCohortManager(db, scope, cohortId)
  const name = update.name?.trim()
  if (name !== undefined && (name === '' || name.length > 200)) throw new ValidationError('Give the cohort a name (up to 200 characters).')
  await db.transaction().execute(async (trx) => {
    await trx
      .updateTable('cohorts')
      .set({
        ...(name !== undefined ? { name } : {}),
        ...(update.joiningOpen !== undefined ? { joining_open: update.joiningOpen } : {}),
        ...(update.archived !== undefined ? { archived: update.archived } : {}),
        // A leaked code is fixed by rotating it; people already in stay in.
        ...(update.rotateCode ? { join_code: newJoinCode() } : {}),
      })
      .where('id', '=', cohortId)
      .execute()
    await recordAudit(trx, scope, { action: 'cohort.updated', targetType: 'cohort', targetId: cohortId, details: { ...update } })
  })
  return (await cohortAccess(db, scope, cohortId))!.cohort
}

/** A signed-in person joins with a code: they become a learner in the cohort and a member of its organisation. */
export async function joinCohort(db: Db, scope: Scope, code: string): Promise<Cohort> {
  const p = requireSignedIn(scope)
  const row = await cohortQuery(db, scope.siteId).where('cohorts.join_code', '=', normaliseJoinCode(code)).executeTakeFirst()
  // One message for "no such code" and "closed", so codes cannot be probed.
  if (!row || !toBool(row.joining_open) || toBool(row.archived)) throw new ValidationError('That code is not valid, or the cohort is not taking new people.')
  const now = new Date()
  await db.transaction().execute(async (trx) => {
    const joined = await trx
      .insertInto('cohort_members')
      .values({ cohort_id: row.id, user_id: p.userId, site_id: scope.siteId, role: 'learner', joined_at: now })
      .ignore()
      .executeTakeFirst()
    if (Number(joined.numInsertedOrUpdatedRows ?? 0) > 0) {
      await queueNotification(trx, scope.siteId, p.userId, 'cohort_joined', { cohortId: row.id, cohortName: row.name, orgName: row.org_name }, now)
    }
    await trx
      .insertInto('org_members')
      .values({ org_id: row.org_id, user_id: p.userId, site_id: scope.siteId, role: 'member', created_at: now })
      .ignore()
      .execute()
  })
  return toCohort(row)
}

/** Cohorts the caller manages (as instructor or org admin) and those they learn in. */
export async function listMyCohorts(db: Db, scope: Scope): Promise<{ teaching: Cohort[]; learning: Cohort[] }> {
  const p = requireSignedIn(scope)
  const memberships = await db.selectFrom('cohort_members').select(['cohort_id', 'role']).where('site_id', '=', scope.siteId).where('user_id', '=', p.userId).execute()
  const adminOrgs = await db.selectFrom('org_members').select('org_id').where('site_id', '=', scope.siteId).where('user_id', '=', p.userId).where('role', '=', 'org_admin').execute()
  const roleOf = new Map<string, CohortRole>(memberships.map((m) => [m.cohort_id, m.role]))
  const ids = [...roleOf.keys()]
  const orgIds = adminOrgs.map((o) => o.org_id)
  const siteAdmin = scope.principal?.role === 'admin'
  if (ids.length === 0 && orgIds.length === 0 && !siteAdmin) return { teaching: [], learning: [] }
  let query = cohortQuery(db, scope.siteId)
  if (!siteAdmin) {
    query = query.where((eb) =>
      eb.or([...(ids.length > 0 ? [eb('cohorts.id', 'in', ids)] : []), ...(orgIds.length > 0 ? [eb('cohorts.org_id', 'in', orgIds)] : [])]),
    )
  }
  const rows = await query.orderBy('cohorts.created_at', 'desc').limit(500).execute()
  const cohorts = rows.map(toCohort)
  const manages = (c: Cohort) => siteAdmin || orgIds.includes(c.orgId) || roleOf.get(c.id) === 'instructor'
  return {
    teaching: cohorts.filter(manages),
    learning: cohorts.filter((c) => roleOf.get(c.id) === 'learner' && !c.archived),
  }
}

export interface CohortPerson {
  userId: string
  name: string
  email: string
  role: CohortRole
}

export async function listCohortMembers(db: Db, scope: Scope, cohortId: string): Promise<CohortPerson[]> {
  await requireCohortManager(db, scope, cohortId)
  return db
    .selectFrom('cohort_members')
    .innerJoin('user', 'user.id', 'cohort_members.user_id')
    .select(['user.id as userId', 'user.name as name', 'user.email as email', 'cohort_members.role as role'])
    .where('cohort_members.cohort_id', '=', cohortId)
    .orderBy('cohort_members.role', 'desc')
    .orderBy('user.name')
    .limit(5000)
    .execute()
}

export async function removeCohortMember(db: Db, scope: Scope, cohortId: string, userId: string): Promise<void> {
  await requireCohortManager(db, scope, cohortId)
  if (userId === scope.principal?.userId) throw new ValidationError('You cannot remove yourself from a cohort you teach.')
  await db.transaction().execute(async (trx) => {
    const result = await trx.deleteFrom('cohort_members').where('cohort_id', '=', cohortId).where('user_id', '=', userId).executeTakeFirst()
    if (Number(result.numDeletedRows) > 0) await recordAudit(trx, scope, { action: 'cohort.member_removed', targetType: 'cohort', targetId: cohortId, details: { userId } })
  })
}

/** Adds a co-instructor by email; they must belong to the organisation as an instructor or org admin. */
export async function addCohortInstructor(db: Db, scope: Scope, cohortId: string, email: string, lookup: EmailLookup = {}): Promise<CohortPerson> {
  const cohort = await requireCohortManager(db, scope, cohortId)
  const person = await db
    .selectFrom('org_members')
    .innerJoin('user', 'user.id', 'org_members.user_id')
    .select(['user.id as userId', 'user.name as name', 'user.email as email'])
    .where('org_members.org_id', '=', cohort.orgId)
    .where('org_members.role', 'in', ['instructor', 'org_admin'])
    .where('user.email', '=', normaliseEmail(email))
    .$if(lookup.verifiedOnly === true, (q) => q.where('user.emailVerified', '=', true))
    .executeTakeFirst()
  if (!person) throw new ValidationError('No instructor in this organisation has that email.')
  await db
    .insertInto('cohort_members')
    .values({ cohort_id: cohortId, user_id: person.userId, site_id: scope.siteId, role: 'instructor', joined_at: new Date() })
    .onDuplicateKeyUpdate({ role: 'instructor' })
    .execute()
  return { ...person, role: 'instructor' }
}

/** Assignments, oldest first; anyone in the cohort may read them. */
export async function listAssignments(db: Db, scope: Scope, cohortId: string): Promise<Assignment[]> {
  requireSignedIn(scope)
  if (!(await cohortAccess(db, scope, cohortId))) throw new NotFoundError('Cohort not found.')
  return assignmentsOf(db, cohortId)
}

/** @internal (no access check) */
export async function assignmentsOf(db: Db, cohortId: string): Promise<Assignment[]> {
  const rows = await db
    .selectFrom('cohort_assignments')
    .leftJoin('packs', 'packs.id', 'cohort_assignments.pack_id')
    .leftJoin('challenges', 'challenges.id', 'cohort_assignments.challenge_id')
    .select([
      'cohort_assignments.id as id',
      'cohort_assignments.pack_id as packId',
      'cohort_assignments.challenge_id as challengeId',
      'packs.title as packTitle',
      'challenges.title as challengeTitle',
      'cohort_assignments.due_at as dueAt',
    ])
    .where('cohort_assignments.cohort_id', '=', cohortId)
    .orderBy('cohort_assignments.position')
    .orderBy('cohort_assignments.created_at')
    .execute()
  return rows.map((r) => ({ id: r.id, packId: r.packId, challengeId: r.challengeId, title: r.packTitle ?? r.challengeTitle ?? 'Untitled', dueAt: r.dueAt }))
}

export async function addAssignment(db: Db, scope: Scope, cohortId: string, target: { packId?: string; challengeId?: string; dueAt?: Date | null }): Promise<Assignment> {
  await requireCohortManager(db, scope, cohortId)
  if (Boolean(target.packId) === Boolean(target.challengeId)) throw new ValidationError('Assign either a pack or a challenge.')
  let restricted: boolean
  if (target.packId) {
    const pack = await db.selectFrom('packs').select('access').where('id', '=', target.packId).where('site_id', '=', scope.siteId).executeTakeFirst()
    if (!pack) throw new NotFoundError('Pack not found.')
    restricted = pack.access === 'restricted'
  } else {
    const challenge = await db
      .selectFrom('challenges')
      .leftJoin('packs', 'packs.id', 'challenges.pack_id')
      .select('packs.access as access')
      .where('challenges.id', '=', target.challengeId!)
      .where('challenges.site_id', '=', scope.siteId)
      .where('challenges.published_version_id', 'is not', null)
      .where('challenges.status', '!=', 'archived')
      .executeTakeFirst()
    if (!challenge) throw new NotFoundError('Only published challenges can be assigned.')
    restricted = challenge.access === 'restricted'
  }
  // Assigning opens the content to everyone who joins: restricted (paid) content is the site's to give, not an instructor's.
  if (restricted && !hasRole(scope, 'editor')) throw new ForbiddenError('This content is restricted. Ask a site editor or admin to assign it to your cohort.')
  const existing = await assignmentsOf(db, cohortId)
  if (existing.length >= MAX_ASSIGNMENTS) throw new ValidationError(`A cohort can have at most ${MAX_ASSIGNMENTS} assignments.`)
  if (existing.some((a) => (target.packId && a.packId === target.packId) || (target.challengeId && a.challengeId === target.challengeId))) {
    throw new ValidationError('That is already assigned.')
  }
  const id = newId()
  try {
    await db
      .insertInto('cohort_assignments')
    .values({
      id,
      cohort_id: cohortId,
      site_id: scope.siteId,
      pack_id: target.packId ?? null,
      challenge_id: target.challengeId ?? null,
      due_at: target.dueAt ?? null,
      position: existing.length,
      created_at: new Date(),
    })
      .execute()
  } catch (err) {
    if ((err as { code?: string }).code === 'ER_DUP_ENTRY') throw new ValidationError('That is already assigned.')
    throw err
  }
  return (await assignmentsOf(db, cohortId)).find((a) => a.id === id)!
}

export async function removeAssignment(db: Db, scope: Scope, cohortId: string, assignmentId: string): Promise<void> {
  await requireCohortManager(db, scope, cohortId)
  await db.deleteFrom('cohort_assignments').where('id', '=', assignmentId).where('cohort_id', '=', cohortId).execute()
}
