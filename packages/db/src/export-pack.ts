/**
 * Pack export: the PUBLISHED version of every live challenge in a pack (a
 * challenge never published exports its latest draft, so authoring work can
 * still move), its sections and its assets, in the format `importPack`
 * reads (PLAN.md §3.7). Archived challenges are left out. Data only, never code.
 * Read in one transaction, so the export is a consistent snapshot.
 */
import type { Db } from './client'
import type { LoadedPack, PackManifest } from './import-pack'
import { fromJson } from './json'
import { NotFoundError, requireRole, type Scope } from './scope'

/** Asset files are named by index, never by their stored path, so an export can never write outside its folder. */
const assetFile = (challengeIndex: number, assetIndex: number, path: string): string => {
  const ext = /\.([a-z0-9]{1,8})$/i.exec(path)?.[1] ?? 'bin'
  return `assets/${challengeIndex + 1}-${assetIndex + 1}.${ext.toLowerCase()}`
}

export async function exportPack(db: Db, scope: Scope, packSlug: string): Promise<LoadedPack> {
  requireRole(scope, 'admin')
  return db.transaction().execute((trx) => exportInside(trx, scope, packSlug))
}

async function exportInside(db: Db, scope: Scope, packSlug: string): Promise<LoadedPack> {
  const pack = await db.selectFrom('packs').selectAll().where('site_id', '=', scope.siteId).where('slug', '=', packSlug).executeTakeFirst()
  if (!pack) throw new NotFoundError(`No pack "${packSlug}" on this site.`)
  const sections = await db.selectFrom('pack_sections').selectAll().where('pack_id', '=', pack.id).orderBy('position').execute()
  const challenges = await db
    .selectFrom('challenges')
    .selectAll()
    .where('pack_id', '=', pack.id)
    .where('site_id', '=', scope.siteId)
    .where('status', '!=', 'archived')
    .orderBy('position')
    .execute()

  const json = new Map<string, unknown>()
  const bytes = new Map<string, Buffer>()
  const entries: PackManifest['challenges'] = []
  for (const [i, c] of challenges.entries()) {
    const versionQuery = db.selectFrom('challenge_versions').select('definition').where('challenge_id', '=', c.id)
    const latest = c.published_version_id
      ? await versionQuery.where('id', '=', c.published_version_id).executeTakeFirstOrThrow()
      : await versionQuery.orderBy('version', 'desc').limit(1).executeTakeFirstOrThrow()
    const definitionFile = `challenges/${c.slug}.json`
    json.set(definitionFile, fromJson(latest.definition))
    const assets = await db.selectFrom('assets').select(['path', 'content_type', 'visibility', 'bytes']).where('challenge_id', '=', c.id).orderBy('path').execute()
    const section = sections.find((s) => s.id === c.section_id)
    entries.push({
      slug: c.slug,
      ...(section ? { section: section.slug } : {}),
      type: `${c.type_id}@${c.type_version}`,
      definition: definitionFile,
      assets: assets.map((a, j) => {
        const file = assetFile(i, j, a.path)
        bytes.set(file, a.bytes)
        return { path: a.path, file, content_type: a.content_type, visibility: a.visibility }
      }),
    })
  }

  const manifest: PackManifest = {
    format: 1,
    slug: pack.slug,
    title: pack.title,
    description: pack.description,
    sections: sections.map((s) => ({ slug: s.slug, title: s.title })),
    challenges: entries,
  }
  return {
    manifest,
    readJson: (p) => {
      if (!json.has(p)) throw new Error(`No file ${p} in this export.`)
      return json.get(p)
    },
    readBytes: (p) => {
      const b = bytes.get(p)
      if (!b) throw new Error(`No file ${p} in this export.`)
      return b
    },
  }
}

/** Every file of an export, for writing to disk: `pack.json`, definitions and assets. */
export function exportFiles(pack: LoadedPack): { path: string; contents: Buffer }[] {
  const files: { path: string; contents: Buffer }[] = [{ path: 'pack.json', contents: Buffer.from(`${JSON.stringify(pack.manifest, null, 2)}\n`) }]
  for (const c of pack.manifest.challenges) {
    files.push({ path: c.definition, contents: Buffer.from(`${JSON.stringify(pack.readJson(c.definition), null, 2)}\n`) })
    for (const a of c.assets) files.push({ path: a.file, contents: pack.readBytes(a.file) })
  }
  return files
}
