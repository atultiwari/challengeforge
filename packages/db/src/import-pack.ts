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
import { putAsset } from './repos/assets'
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

/** Checks every definition and section reference BEFORE anything is written. */
function validateAll(registry: TypeRegistry, manifest: PackManifest, pack: LoadedPack): void {
  const sections = new Set(manifest.sections.map((s) => s.slug))
  const issues = manifest.challenges.flatMap((entry, i) => {
    if (entry.section && !sections.has(entry.section)) {
      return [{ path: `challenges.${i}.section`, severity: 'error', message: `Unknown section ${entry.section}.` }]
    }
    const { typeId, typeVersion } = parseTypeRef(entry.type)
    const parsed = registry.parseDefinition(typeId, typeVersion, pack.readJson(entry.definition))
    return parsed.ok ? [] : parsed.issues.map((issue) => ({ ...issue, path: `${entry.slug}: ${issue.path}` }))
  })
  if (issues.length > 0) throw new ValidationError('The pack has problems; nothing was imported.', issues)
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

  const report: ImportReport = { packId, created: [], updated: [], unchanged: [], published: [] }
  for (const [position, entry] of manifest.challenges.entries()) {
    const { typeId, typeVersion } = parseTypeRef(entry.type)
    const definition = pack.readJson(entry.definition)
    const sectionId = entry.section ? sectionIds.get(entry.section) : undefined

    const existing = await db
      .selectFrom('challenges')
      .select(['id', 'type_id', 'type_version'])
      .where('site_id', '=', scope.siteId)
      .where('slug', '=', entry.slug)
      .executeTakeFirst()

    let challengeId: string
    if (!existing) {
      challengeId = await createChallenge(db, scope, registry, { slug: entry.slug, typeId, typeVersion, definition, packId, sectionId: sectionId ?? null, position })
      report.created.push(entry.slug)
    } else {
      if (existing.type_id !== typeId || existing.type_version !== typeVersion) {
        throw new Error(`Challenge ${entry.slug} already exists as ${existing.type_id}@${existing.type_version}; a pack cannot change its type.`)
      }
      challengeId = existing.id
      await db.updateTable('challenges').set({ pack_id: packId, section_id: sectionId ?? null, position }).where('id', '=', challengeId).execute()
      if (sameDefinition(registry, typeId, typeVersion, await latestDefinition(db, challengeId), definition)) {
        report.unchanged.push(entry.slug)
      } else {
        await saveDraftVersion(db, scope, registry, challengeId, definition)
        report.updated.push(entry.slug)
      }
    }

    for (const asset of entry.assets) {
      await putAsset(db, scope, {
        challengeId,
        packId,
        path: asset.path,
        contentType: asset.content_type,
        visibility: asset.visibility,
        bytes: pack.readBytes(asset.file),
      })
    }
    if (options.publish) {
      await publish(db, scope, challengeId)
      report.published.push(entry.slug)
    }
  }
  return report
}
