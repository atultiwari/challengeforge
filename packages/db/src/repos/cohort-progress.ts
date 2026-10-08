/**
 * What instructors see of their cohorts (Phase 3, Q3): a learners ×
 * assigned-challenges grid built from `progress`, and the rule for which
 * results an instructor may review: those of THEIR cohort's learners, on
 * challenges assigned to that cohort.
 */
import type { Db } from '../client'
import { NotFoundError, requireSignedIn, type Scope } from '../scope'
import { assignmentsOf, cohortAccess, listMyCohorts, requireCohortManager } from './cohorts'

export interface GridColumn {
  challengeId: string
  title: string
  dueAt: Date | null
}

export interface GridCell {
  attempts: number
  bestPoints: number
  passed: boolean
  passedAt: Date | null
  /** Passed after the due date, or not passed and the due date is behind us. */
  late: boolean
}

export interface GridRow {
  userId: string
  name: string
  email: string
  passedCount: number
  cells: Record<string, GridCell>
}

export interface ProgressGrid {
  columns: GridColumn[]
  rows: GridRow[]
}

/** Every challenge a cohort is assigned, with packs expanded to their published challenges, in order. */
export async function assignedChallenges(db: Db, cohortId: string): Promise<GridColumn[]> {
  const columns: GridColumn[] = []
  const seen = new Set<string>()
  for (const a of await assignmentsOf(db, cohortId)) {
    let items: { id: string; title: string }[]
    if (a.challengeId) {
      items = await db
        .selectFrom('challenges')
        .select(['id', 'title'])
        .where('id', '=', a.challengeId)
        .where('published_version_id', 'is not', null)
        .where('status', '!=', 'archived')
        .execute()
    } else {
      items = await db
        .selectFrom('challenges')
        .leftJoin('pack_sections', 'pack_sections.id', 'challenges.section_id')
        .select(['challenges.id as id', 'challenges.title as title'])
        .where('challenges.pack_id', '=', a.packId!)
        .where('challenges.published_version_id', 'is not', null)
        .where('challenges.status', '!=', 'archived')
        .orderBy('pack_sections.position')
        .orderBy('challenges.position')
        .execute()
    }
    for (const item of items) {
      if (seen.has(item.id)) continue
      seen.add(item.id)
      columns.push({ challengeId: item.id, title: item.title, dueAt: a.dueAt })
    }
  }
  return columns
}

const cellOf = (row: { attempts: number; best_points: number; passed_at: Date | null } | undefined, dueAt: Date | null, now: Date): GridCell => {
  const passedAt = row?.passed_at ?? null
  const late = dueAt !== null && (passedAt ? passedAt > dueAt : now > dueAt)
  return { attempts: row?.attempts ?? 0, bestPoints: row?.best_points ?? 0, passed: passedAt !== null, passedAt, late }
}

async function progressFor(db: Db, siteId: string, userIds: string[], challengeIds: string[]) {
  if (userIds.length === 0 || challengeIds.length === 0) return new Map<string, { attempts: number; best_points: number; passed_at: Date | null }>()
  const rows = await db
    .selectFrom('progress')
    .select(['user_id', 'challenge_id', 'attempts', 'best_points', 'passed_at'])
    .where('site_id', '=', siteId)
    .where('user_id', 'in', userIds)
    .where('challenge_id', 'in', challengeIds)
    .execute()
  return new Map(rows.map((r) => [`${r.user_id}:${r.challenge_id}`, r]))
}

/** The cohort's grid, for its instructors. */
export async function cohortProgress(db: Db, scope: Scope, cohortId: string, now: Date = new Date()): Promise<ProgressGrid> {
  await requireCohortManager(db, scope, cohortId)
  const columns = await assignedChallenges(db, cohortId)
  const learners = await db
    .selectFrom('cohort_members')
    .innerJoin('user', 'user.id', 'cohort_members.user_id')
    .select(['user.id as userId', 'user.name as name', 'user.email as email'])
    .where('cohort_members.cohort_id', '=', cohortId)
    .where('cohort_members.role', '=', 'learner')
    .orderBy('user.name')
    .limit(5000)
    .execute()
  const progress = await progressFor(db, scope.siteId, learners.map((l) => l.userId), columns.map((c) => c.challengeId))
  const rows = learners.map((l) => {
    const cells = Object.fromEntries(columns.map((c) => [c.challengeId, cellOf(progress.get(`${l.userId}:${c.challengeId}`), c.dueAt, now)]))
    return { ...l, cells, passedCount: Object.values(cells).filter((c) => c.passed).length }
  })
  return { columns, rows }
}

/** A learner's own view of a cohort they are in: each assigned challenge with their status. */
export async function myCohortAssignments(db: Db, scope: Scope, cohortId: string, now: Date = new Date()): Promise<(GridColumn & GridCell)[]> {
  const p = requireSignedIn(scope)
  if (!(await cohortAccess(db, scope, cohortId))) throw new NotFoundError('Cohort not found.')
  const columns = await assignedChallenges(db, cohortId)
  const progress = await progressFor(db, scope.siteId, [p.userId], columns.map((c) => c.challengeId))
  return columns.map((c) => ({ ...c, ...cellOf(progress.get(`${p.userId}:${c.challengeId}`), c.dueAt, now) }))
}

/** (learner, challenge) pairs the caller may review as an instructor, as "userId:challengeId" keys. */
export async function reviewablePairs(db: Db, scope: Scope): Promise<{ learners: Set<string>; challenges: Set<string>; pairs: Set<string> }> {
  const empty = { learners: new Set<string>(), challenges: new Set<string>(), pairs: new Set<string>() }
  if (!scope.principal) return empty
  const { teaching } = await listMyCohorts(db, scope)
  for (const cohort of teaching.filter((c) => !c.archived)) {
    const challengeIds = (await assignedChallenges(db, cohort.id)).map((c) => c.challengeId)
    const learners = await db.selectFrom('cohort_members').select('user_id').where('cohort_id', '=', cohort.id).where('role', '=', 'learner').execute()
    for (const l of learners) {
      empty.learners.add(l.user_id)
      for (const c of challengeIds) {
        empty.challenges.add(c)
        empty.pairs.add(`${l.user_id}:${c}`)
      }
    }
  }
  return empty
}

/** True when the caller teaches a cohort with this learner in it and this challenge assigned. */
export async function canReviewAsInstructor(db: Db, scope: Scope, learnerId: string, challengeId: string): Promise<boolean> {
  return (await reviewablePairs(db, scope)).pairs.has(`${learnerId}:${challengeId}`)
}
