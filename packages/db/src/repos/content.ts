/**
 * Packs, challenges and their immutable versions, with the draft → in review
 * → published workflow (PLAN.md §3.8). Authors edit their own challenges and
 * those they co-author; editors and admins edit any and publish. Learners only ever see the published version.
 */
import type { TypeRegistry } from '@challengeforge/engine'
import type { Db } from '../client'
import { newId } from '../ids'
import { fromJson, toJson } from '../json'
import { ForbiddenError, NotFoundError, ValidationError, hasRole, requireRole, type Scope } from '../scope'
import type { ChallengeStatus, PackAccess } from '../schema'
import { withDeadlockRetry } from '../tx'
import { recordAudit } from './audit'
import { canEdit } from './collaborators'

export interface ChallengeSummary {
  id: string
  packId: string | null
  slug: string
  title: string
  typeId: string
  status: ChallengeStatus
  packTitle: string | null
  sectionTitle: string | null
  sectionPosition: number
  position: number
}

export interface PlayableChallenge {
  id: string
  packId: string | null
  slug: string
  title: string
  typeId: string
  typeVersion: number
  versionId: string
  definition: unknown
}

const titleOf = (definition: unknown, fallback: string): string => {
  const t = (definition as { title?: unknown } | null)?.title
  return typeof t === 'string' && t.trim() !== '' ? t.trim().slice(0, 300) : fallback
}

function validated(registry: TypeRegistry, typeId: string, typeVersion: number, raw: unknown): unknown {
  const parsed = registry.parseDefinition(typeId, typeVersion, raw)
  if (!parsed.ok) throw new ValidationError('The challenge has problems that must be fixed first.', parsed.issues)
  return parsed.definition
}

export async function upsertPack(db: Db, scope: Scope, input: { slug: string; title: string; description: string }): Promise<string> {
  requireRole(scope, 'admin')
  const existing = await db.selectFrom('packs').select('id').where('site_id', '=', scope.siteId).where('slug', '=', input.slug).executeTakeFirst()
  if (existing) {
    await db.updateTable('packs').set({ title: input.title, description: input.description }).where('id', '=', existing.id).execute()
    return existing.id
  }
  const id = newId()
  await db.insertInto('packs').values({ id, site_id: scope.siteId, ...input, created_at: new Date() }).execute()
  return id
}

export async function upsertSection(
  db: Db,
  scope: Scope,
  packId: string,
  input: { slug: string; title: string; position: number },
): Promise<string> {
  requireRole(scope, 'admin')
  const pack = await db.selectFrom('packs').select('id').where('id', '=', packId).where('site_id', '=', scope.siteId).executeTakeFirst()
  if (!pack) throw new NotFoundError('Pack not found.')
  const existing = await db.selectFrom('pack_sections').select('id').where('pack_id', '=', packId).where('slug', '=', input.slug).executeTakeFirst()
  if (existing) {
    await db.updateTable('pack_sections').set({ title: input.title, position: input.position }).where('id', '=', existing.id).execute()
    return existing.id
  }
  const id = newId()
  await db.insertInto('pack_sections').values({ id, pack_id: packId, ...input }).execute()
  return id
}

export interface NewChallenge {
  slug: string
  typeId: string
  typeVersion: number
  definition: unknown
  packId?: string | null
  sectionId?: string | null
  position?: number
}

/** Creates a challenge as a draft with version 1. Authors and admins only. */
export async function createChallenge(db: Db, scope: Scope, registry: TypeRegistry, input: NewChallenge): Promise<string> {
  const author = requireRole(scope, 'author')
  const definition = validated(registry, input.typeId, input.typeVersion, input.definition)
  const now = new Date()
  const id = newId()
  await db.transaction().execute(async (trx) => {
    await trx
      .insertInto('challenges')
      .values({
        id,
        site_id: scope.siteId,
        pack_id: input.packId ?? null,
        section_id: input.sectionId ?? null,
        slug: input.slug,
        type_id: input.typeId,
        type_version: input.typeVersion,
        title: titleOf(definition, input.slug),
        status: 'draft',
        position: input.position ?? 0,
        published_version_id: null,
        created_by: author.userId,
        created_at: now,
        updated_at: now,
      })
      .execute()
    await trx
      .insertInto('challenge_versions')
      .values({ id: newId(), challenge_id: id, version: 1, definition: toJson(definition), created_by: author.userId, created_at: now })
      .execute()
  })
  return id
}

interface OwnedChallenge {
  id: string
  type_id: string
  type_version: number
  status: ChallengeStatus
  created_by: string | null
}

/** Loads a challenge the caller may EDIT: their own or co-authored as an author, any as an editor. */
async function loadEditable(db: Db, scope: Scope, challengeId: string): Promise<OwnedChallenge> {
  requireRole(scope, 'author')
  const row = await db
    .selectFrom('challenges')
    .select(['id', 'type_id', 'type_version', 'status', 'created_by'])
    .where('id', '=', challengeId)
    .where('site_id', '=', scope.siteId)
    .executeTakeFirst()
  if (!row) throw new NotFoundError('Challenge not found.')
  if (!(await canEdit(db, scope, row))) throw new ForbiddenError()
  return row
}

/** Saves an edit as a NEW immutable version; learners keep the published one until it is re-published. */
export async function saveDraftVersion(db: Db, scope: Scope, registry: TypeRegistry, challengeId: string, raw: unknown): Promise<number> {
  const challenge = await loadEditable(db, scope, challengeId)
  if (challenge.status === 'archived') throw new ForbiddenError('Archived challenges cannot be edited.')
  const definition = validated(registry, challenge.type_id, challenge.type_version, raw)
  const now = new Date()
  return withDeadlockRetry(() => db.transaction().execute(async (trx) => {
    // Lock the challenge row first: concurrent saves then queue here instead
    // of racing (and deadlocking) on the version gap lock.
    await trx.selectFrom('challenges').select('id').where('id', '=', challengeId).forUpdate().executeTakeFirst()
    const latest = await trx
      .selectFrom('challenge_versions')
      .select((eb) => eb.fn.max('version').as('v'))
      .where('challenge_id', '=', challengeId)
      .executeTakeFirst()
    const version = Number(latest?.v ?? 0) + 1
    await trx
      .insertInto('challenge_versions')
      .values({ id: newId(), challenge_id: challengeId, version, definition: toJson(definition), created_by: scope.principal?.userId ?? null, created_at: now })
      .execute()
    await trx
      .updateTable('challenges')
      .set({ status: 'draft', title: titleOf(definition, 'Untitled'), updated_at: now })
      .where('id', '=', challengeId)
      .execute()
    return version
  }))
}

export async function submitForReview(db: Db, scope: Scope, challengeId: string): Promise<void> {
  const challenge = await loadEditable(db, scope, challengeId)
  if (challenge.status !== 'draft') throw new ForbiddenError('Only a draft can be sent for review.')
  await db.updateTable('challenges').set({ status: 'in_review', updated_at: new Date() }).where('id', '=', challengeId).execute()
}

/**
 * Publishes the LATEST version. Editors and admins only: they are the
 * reviewers, so they may also publish a draft directly. Locked, so a save in flight cannot
 * leave the challenge pointing at an older version.
 */
export async function publish(db: Db, scope: Scope, challengeId: string): Promise<void> {
  requireRole(scope, 'editor')
  await withDeadlockRetry(() =>
    db.transaction().execute(async (trx) => {
      const challenge = await trx
        .selectFrom('challenges')
        .select('status')
        .where('id', '=', challengeId)
        .where('site_id', '=', scope.siteId)
        .forUpdate()
        .executeTakeFirst()
      if (!challenge || challenge.status === 'archived') throw new NotFoundError('Challenge not found.')
      const latest = await trx
        .selectFrom('challenge_versions')
        .select('id')
        .where('challenge_id', '=', challengeId)
        .orderBy('version', 'desc')
        .limit(1)
        .executeTakeFirstOrThrow()
      await trx
        .updateTable('challenges')
        .set({ status: 'published', published_version_id: latest.id, updated_at: new Date() })
        .where('id', '=', challengeId)
        .execute()
      await recordAudit(trx, scope, { action: 'challenge.published', targetType: 'challenge', targetId: challengeId, details: { versionId: latest.id } }, 'cli')
    }),
  )
}

export async function archive(db: Db, scope: Scope, challengeId: string): Promise<void> {
  requireRole(scope, 'editor')
  const result = await db
    .updateTable('challenges')
    .set({ status: 'archived', updated_at: new Date() })
    .where('id', '=', challengeId)
    .where('site_id', '=', scope.siteId)
    .executeTakeFirst()
  if (Number(result.numUpdatedRows) === 0) throw new NotFoundError('Challenge not found.')
  await recordAudit(db, scope, { action: 'challenge.archived', targetType: 'challenge', targetId: challengeId }, 'cli')
}

const summaryColumns = [
  'challenges.id as id',
  'challenges.pack_id as packId',
  'challenges.slug as slug',
  'challenges.title as title',
  'challenges.type_id as typeId',
  'challenges.status as status',
  'challenges.position as position',
  'packs.title as packTitle',
  'pack_sections.title as sectionTitle',
  'pack_sections.position as sectionPosition',
] as const

export interface PackSummary {
  id: string
  slug: string
  title: string
  access: PackAccess
}

/** The site's packs, for choosing what to assign. */
export async function listPacks(db: Db, scope: Scope): Promise<PackSummary[]> {
  return db.selectFrom('packs').select(['id', 'slug', 'title', 'access']).where('site_id', '=', scope.siteId).orderBy('title').limit(500).execute()
}

/** What learners can play: published, not archived, on this site. Titles only. */
export async function listPlayable(db: Db, scope: Scope): Promise<ChallengeSummary[]> {
  const rows = await db
    .selectFrom('challenges')
    .leftJoin('packs', 'packs.id', 'challenges.pack_id')
    .leftJoin('pack_sections', 'pack_sections.id', 'challenges.section_id')
    .select(summaryColumns)
    .where('challenges.site_id', '=', scope.siteId)
    .where('challenges.published_version_id', 'is not', null)
    .where('challenges.status', '!=', 'archived')
    .orderBy('pack_sections.position')
    .orderBy('challenges.position')
    .limit(500)
    .execute()
  return rows.map((r) => ({ ...r, sectionPosition: r.sectionPosition ?? 0 }))
}

/** What an author may edit: their own and co-authored ones (all of them for an editor). */
export async function listForAuthoring(db: Db, scope: Scope): Promise<ChallengeSummary[]> {
  const p = requireRole(scope, 'author')
  let query = db
    .selectFrom('challenges')
    .leftJoin('packs', 'packs.id', 'challenges.pack_id')
    .leftJoin('pack_sections', 'pack_sections.id', 'challenges.section_id')
    .select(summaryColumns)
    .where('challenges.site_id', '=', scope.siteId)
  if (!hasRole(scope, 'editor')) {
    query = query.where((eb) =>
      eb.or([
        eb('challenges.created_by', '=', p.userId),
        eb.exists(eb.selectFrom('challenge_collaborators').select('challenge_collaborators.user_id').whereRef('challenge_collaborators.challenge_id', '=', 'challenges.id').where('challenge_collaborators.user_id', '=', p.userId)),
      ]),
    )
  }
  const rows = await query.orderBy('challenges.updated_at', 'desc').limit(500).execute()
  return rows.map((r) => ({ ...r, sectionPosition: r.sectionPosition ?? 0 }))
}

/** The published version, for play. Anyone on the site may read it; acting needs sign-in. */
export async function getPlayable(db: Db, scope: Scope, challengeId: string): Promise<PlayableChallenge> {
  const row = await db
    .selectFrom('challenges')
    .innerJoin('challenge_versions', 'challenge_versions.id', 'challenges.published_version_id')
    .select([
      'challenges.id as id',
      'challenges.pack_id as packId',
      'challenges.slug as slug',
      'challenges.title as title',
      'challenges.type_id as typeId',
      'challenges.type_version as typeVersion',
      'challenge_versions.id as versionId',
      'challenge_versions.definition as definition',
    ])
    .where('challenges.id', '=', challengeId)
    .where('challenges.site_id', '=', scope.siteId)
    .where('challenges.status', '!=', 'archived')
    .executeTakeFirst()
  if (!row) throw new NotFoundError('Challenge not found.')
  return { ...row, definition: fromJson(row.definition) }
}

export interface AuthoringView extends PlayableChallenge {
  status: ChallengeStatus
  version: number
  publishedVersionId: string | null
  createdBy: string | null
  canPublish: boolean
}

/** The latest version, for editing and preview. */
export async function getForAuthoring(db: Db, scope: Scope, challengeId: string): Promise<AuthoringView> {
  await loadEditable(db, scope, challengeId)
  const row = await db
    .selectFrom('challenges')
    .innerJoin('challenge_versions', 'challenge_versions.challenge_id', 'challenges.id')
    .select([
      'challenges.id as id',
      'challenges.pack_id as packId',
      'challenges.slug as slug',
      'challenges.title as title',
      'challenges.type_id as typeId',
      'challenges.type_version as typeVersion',
      'challenges.status as status',
      'challenges.published_version_id as publishedVersionId',
      'challenges.created_by as createdBy',
      'challenge_versions.id as versionId',
      'challenge_versions.version as version',
      'challenge_versions.definition as definition',
    ])
    .where('challenges.id', '=', challengeId)
    .where('challenges.site_id', '=', scope.siteId)
    .orderBy('challenge_versions.version', 'desc')
    .limit(1)
    .executeTakeFirstOrThrow()
  return { ...row, definition: fromJson(row.definition), canPublish: hasRole(scope, 'editor') }
}

/** Internal: a version by id, after the caller has authorised access to its challenge. */
export async function loadVersionDefinition(db: Db, versionId: string): Promise<unknown> {
  const row = await db.selectFrom('challenge_versions').select('definition').where('id', '=', versionId).executeTakeFirst()
  if (!row) throw new NotFoundError('Challenge version not found.')
  return fromJson(row.definition)
}
