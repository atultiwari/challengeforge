/**
 * Pack import (PLAN.md §3.7). A pack is DATA ONLY: a manifest, challenge
 * definitions naming a built-in `type@version`, and assets. It never carries
 * code. Import is idempotent: an unchanged challenge creates no new version,
 * a changed one becomes a new draft version.
 */
import { z } from 'zod'
import type { TypeRegistry } from '@challengeforge/engine'
import type { Db } from './client'
import { canonicalJson, fromJson } from './json'
import { createChallenge, publish, saveDraftVersion, upsertPack, upsertSection } from './repos/content'
import { assetProblems, putAsset } from './repos/assets'
import { recordAudit } from './repos/audit'
import { ValidationError, requireRole, type Scope } from './scope'

const Slug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/, 'Use lowercase letters, digits and hyphens.')
const TypeRef = z.string().regex(/^[a-z0-9-]+@\d+$/, 'Name the type as id@version, e.g. question-set@1.')

export const PackManifestSchema = z.object({
  format: z.literal(1),
  slug: Slug,
  title: z.string().min(1),
  description: z.string().default(''),
  sections: z.array(z.object({ slug: Slug, title: z.string().min(1) })).default([]),
  challenges: z
    .array(
      z.object({
        slug: Slug,
        section: Slug.optional(),
        type: TypeRef,
        /** Path of the definition JSON inside the pack. */
        definition: z.string().min(1),
        assets: z
          .array(
            z.object({
              path: z.string().min(1),
              file: z.string().min(1),
              content_type: z.string().min(1),
              visibility: z.enum(['public', 'gated']).default('public'),
            }),
          )
          .default([]),
      }),
    )
    .min(1),
})
export type PackManifest = z.infer<typeof PackManifestSchema>

/** A pack with its files already read, so the importer itself never touches the filesystem. */
export interface LoadedPack {
  manifest: PackManifest
  readJson(path: string): unknown
  readBytes(path: string): Buffer
}

export interface ImportReport {
  packId: string
  created: string[]
  updated: string[]
  unchanged: string[]
  /** Archived challenges are left alone: un-archive them first to update them. */
  skipped: string[]
  published: string[]
}

function parseTypeRef(ref: string): { typeId: string; typeVersion: number } {
  const [typeId, version] = ref.split('@') as [string, string]
  return { typeId, typeVersion: Number(version) }
}

async function latestDefinition(db: Db, challengeId: string): Promise<unknown> {
  const row = await db
    .selectFrom('challenge_versions')
    .select('definition')
    .where('challenge_id', '=', challengeId)
    .orderBy('version', 'desc')
    .limit(1)
    .executeTakeFirstOrThrow()
  return fromJson(row.definition)
}

/** Stable comparison: parse the incoming definition the same way it would be stored. */
function sameDefinition(registry: TypeRegistry, typeId: string, typeVersion: number, stored: unknown, incoming: unknown): boolean {
  const parsed = registry.parseDefinition(typeId, typeVersion, incoming)
  return parsed.ok && canonicalJson(parsed.definition) === canonicalJson(stored)
}

type Issue = { path: string; severity: string; message: string }

function definitionIssues(registry: TypeRegistry, pack: LoadedPack, entry: PackManifest['challenges'][number]): Issue[] {
  const { typeId, typeVersion } = parseTypeRef(entry.type)
  let raw: unknown
  try {
    raw = pack.readJson(entry.definition)
  } catch (err) {
    return [{ path: entry.slug, severity: 'error', message: `Cannot read ${entry.definition}: ${(err as Error).message}` }]
  }
  const parsed = registry.parseDefinition(typeId, typeVersion, raw)
  return parsed.ok ? [] : parsed.issues.map((issue) => ({ ...issue, path: `${entry.slug}: ${issue.path}` }))
}

function assetIssues(pack: LoadedPack, entry: PackManifest['challenges'][number]): Issue[] {
  return entry.assets.flatMap((asset) => {
    let size: number
    try {
      size = pack.readBytes(asset.file).length
    } catch (err) {
      return [{ path: `${entry.slug}: ${asset.path}`, severity: 'error', message: `Cannot read ${asset.file}: ${(err as Error).message}` }]
    }
    return assetProblems({ path: asset.path, contentType: asset.content_type, size }).map((message) => ({
      path: `${entry.slug}: ${asset.path}`,
      severity: 'error',
      message,
    }))
  })
}

/** Checks every definition, section reference and asset BEFORE anything is written. */
function validateAll(registry: TypeRegistry, manifest: PackManifest, pack: LoadedPack): void {
  const sections = new Set(manifest.sections.map((s) => s.slug))
  const issues = manifest.challenges.flatMap((entry, i): Issue[] => {
    if (entry.section && !sections.has(entry.section)) {
      return [{ path: `challenges.${i}.section`, severity: 'error', message: `Unknown section ${entry.section}.` }]
    }
    return [...definitionIssues(registry, pack, entry), ...assetIssues(pack, entry)]
  })
  if (issues.length > 0) throw new ValidationError('The pack has problems; nothing was imported.', issues)
}

type Entry = PackManifest['challenges'][number]
type Outcome = 'created' | 'updated' | 'unchanged' | 'skipped'

/** Imports one challenge: create, new version, unchanged or (archived) skipped. */
async function importChallenge(
  db: Db,
  scope: Scope,
  registry: TypeRegistry,
  pack: LoadedPack,
  target: { packId: string; sectionId: string | null; position: number },
  entry: Entry,
): Promise<{ challengeId: string; outcome: Outcome }> {
  const { typeId, typeVersion } = parseTypeRef(entry.type)
  const definition = pack.readJson(entry.definition)
  const existing = await db
    .selectFrom('challenges')
    .select(['id', 'type_id', 'type_version', 'pack_id', 'status'])
    .where('site_id', '=', scope.siteId)
    .where('slug', '=', entry.slug)
    .executeTakeFirst()
  if (!existing) {
    const challengeId = await createChallenge(db, scope, registry, { slug: entry.slug, typeId, typeVersion, definition, ...target })
    return { challengeId, outcome: 'created' }
  }
  if (existing.pack_id !== null && existing.pack_id !== target.packId) {
    throw new ValidationError(`Challenge ${entry.slug} belongs to another pack; rename it in this pack.`)
  }
  if (existing.type_id !== typeId || existing.type_version !== typeVersion) {
    throw new ValidationError(`Challenge ${entry.slug} already exists as ${existing.type_id}@${existing.type_version}; a pack cannot change its type.`)
  }
  if (existing.status === 'archived') return { challengeId: existing.id, outcome: 'skipped' }
  await db
    .updateTable('challenges')
    .set({ pack_id: target.packId, section_id: target.sectionId, position: target.position })
    .where('id', '=', existing.id)
    .execute()
  if (sameDefinition(registry, typeId, typeVersion, await latestDefinition(db, existing.id), definition)) {
    return { challengeId: existing.id, outcome: 'unchanged' }
  }
  await saveDraftVersion(db, scope, registry, existing.id, definition)
  return { challengeId: existing.id, outcome: 'updated' }
}

/** True when the latest version is not the published one. */
async function hasUnpublishedVersion(db: Db, challengeId: string): Promise<boolean> {
  const row = await db
    .selectFrom('challenges')
    .innerJoin('challenge_versions', 'challenge_versions.challenge_id', 'challenges.id')
    .select(['challenges.published_version_id as published', 'challenge_versions.id as latest'])
    .where('challenges.id', '=', challengeId)
    .orderBy('challenge_versions.version', 'desc')
    .limit(1)
    .executeTakeFirstOrThrow()
  return row.published !== row.latest
}

export async function importPack(
  db: Db,
  scope: Scope,
  registry: TypeRegistry,
  pack: LoadedPack,
  options: { publish?: boolean } = {},
): Promise<ImportReport> {
  requireRole(scope, 'admin')
  const manifest = PackManifestSchema.parse(pack.manifest)
  validateAll(registry, manifest, pack)
  const packId = await upsertPack(db, scope, { slug: manifest.slug, title: manifest.title, description: manifest.description })
  const sectionIds = new Map<string, string>()
  for (const [position, section] of manifest.sections.entries()) {
    sectionIds.set(section.slug, await upsertSection(db, scope, packId, { ...section, position }))
  }

  const report: ImportReport = { packId, created: [], updated: [], unchanged: [], skipped: [], published: [] }
  for (const [position, entry] of manifest.challenges.entries()) {
    const sectionId = entry.section ? (sectionIds.get(entry.section) ?? null) : null
    const { challengeId, outcome } = await importChallenge(db, scope, registry, pack, { packId, sectionId, position }, entry)
    report[outcome].push(entry.slug)
    if (outcome === 'skipped') continue
    for (const asset of entry.assets) {
      const bytes = pack.readBytes(asset.file)
      await putAsset(db, scope, { challengeId, packId, path: asset.path, contentType: asset.content_type, visibility: asset.visibility, bytes })
    }
    if (options.publish && (await hasUnpublishedVersion(db, challengeId))) {
      await publish(db, scope, challengeId)
      report.published.push(entry.slug)
    }
  }
  const { packId: _id, ...counts } = report
  await recordAudit(db, scope, { action: 'pack.imported', targetType: 'pack', targetId: packId, details: { slug: manifest.slug, ...counts } }, 'cli')
  return report
}
