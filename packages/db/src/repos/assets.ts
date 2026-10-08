/**
 * Challenge assets (datasets, case documents, images) stored in the database:
 * the app directory on shared hosting is replaced on every deploy, so files
 * on disk are not durable (docs/PHASE-1-PLAN.md).
 */
import { createHash } from 'node:crypto'
import type { Db } from '../client'
import { newId } from '../ids'
import type { DatasetLoader, DatasetRow } from '@challengeforge/engine'
import { NotFoundError, hasRole, requireRole, requireSignedIn, type Scope } from '../scope'

/** MEDIUMBLOB limit, less headroom. */
export const MAX_ASSET_BYTES = 15 * 1024 * 1024

const SAFE_PATH = /^[a-z0-9][a-z0-9._/-]{0,299}$/i

/**
 * Types an asset may have. Anything that a browser could run as a page
 * (HTML, SVG, XML) is refused, so a malicious pack cannot plant script on
 * the site's own origin.
 */
export const ALLOWED_ASSET_TYPES: ReadonlySet<string> = new Set([
  'application/json',
  'text/csv',
  'text/plain',
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
])

/** Problems with an asset, in words an operator can act on; empty when it is acceptable. */
export function assetProblems(asset: { path: string; contentType: string; size: number }): string[] {
  const problems: string[] = []
  if (!SAFE_PATH.test(asset.path) || asset.path.includes('..')) problems.push(`Unsafe asset path: ${asset.path}`)
  if (!ALLOWED_ASSET_TYPES.has(asset.contentType)) problems.push(`Asset ${asset.path} has a type that is not allowed: ${asset.contentType}`)
  if (asset.size > MAX_ASSET_BYTES) problems.push(`Asset ${asset.path} is larger than ${MAX_ASSET_BYTES} bytes.`)
  return problems
}

export interface NewAsset {
  challengeId: string
  packId?: string | null
  path: string
  contentType: string
  visibility: 'public' | 'gated'
  bytes: Buffer
}

export async function putAsset(db: Db, scope: Scope, asset: NewAsset): Promise<void> {
  requireRole(scope, 'admin')
  const problems = assetProblems({ path: asset.path, contentType: asset.contentType, size: asset.bytes.length })
  if (problems.length > 0) throw new Error(problems.join(' '))
  const challenge = await db.selectFrom('challenges').select('id').where('id', '=', asset.challengeId).where('site_id', '=', scope.siteId).executeTakeFirst()
  if (!challenge) throw new NotFoundError('Challenge not found.')
  const sha256 = createHash('sha256').update(asset.bytes).digest('hex')
  const existing = await db.selectFrom('assets').select('sha256').where('challenge_id', '=', asset.challengeId).where('path', '=', asset.path).executeTakeFirst()
  // Re-importing an unchanged pack should not rewrite megabytes of data.
  if (existing?.sha256 === sha256) return
  await db
    .insertInto('assets')
    .values({
      id: newId(),
      site_id: scope.siteId,
      pack_id: asset.packId ?? null,
      challenge_id: asset.challengeId,
      path: asset.path,
      content_type: asset.contentType,
      visibility: asset.visibility,
      bytes: asset.bytes,
      sha256,
      created_at: new Date(),
    })
    .onDuplicateKeyUpdate({ content_type: asset.contentType, visibility: asset.visibility, bytes: asset.bytes, sha256 })
    .execute()
}

export interface AssetBody {
  contentType: string
  bytes: Buffer
  sha256: string
}

/**
 * An asset of a PUBLISHED challenge, for a signed-in learner. Gated assets
 * (results revealed by play, Phase 2) are refused. Admins may read any asset
 * on their site; authors may also read every asset of their OWN challenges.
 */
export async function getAssetForPlay(db: Db, scope: Scope, challengeId: string, path: string): Promise<AssetBody> {
  const p = requireSignedIn(scope)
  const row = await db
    .selectFrom('assets')
    .innerJoin('challenges', 'challenges.id', 'assets.challenge_id')
    .select([
      'assets.content_type as contentType',
      'assets.bytes as bytes',
      'assets.sha256 as sha256',
      'assets.visibility as visibility',
      'challenges.published_version_id as publishedVersionId',
      'challenges.status as status',
      'challenges.created_by as createdBy',
    ])
    .where('assets.challenge_id', '=', challengeId)
    .where('assets.path', '=', path)
    .where('challenges.site_id', '=', scope.siteId)
    .executeTakeFirst()
  if (!row) throw new NotFoundError('Asset not found.')
  const editor = hasRole(scope, 'admin') || (hasRole(scope, 'author') && row.createdBy === p.userId)
  const playable = row.publishedVersionId !== null && row.status !== 'archived' && row.visibility === 'public'
  if (!editor && !playable) throw new NotFoundError('Asset not found.')
  return { contentType: row.contentType, bytes: row.bytes, sha256: row.sha256 }
}

/**
 * Dataset rows for the engine's metric rules (e.g. metric_target), read from
 * the challenge's OWN assets, so a definition can never reach another
 * challenge's data. Accepts the Lab's `{ patients: [...] }`, `{ rows: [...] }`
 * or a bare array. Throws on anything else; the rule then fails closed.
 */
export function datasetLoaderFor(db: Db, challengeId: string): DatasetLoader {
  return async (ref) => {
    const row = await db.selectFrom('assets').select('bytes').where('challenge_id', '=', challengeId).where('path', '=', ref).executeTakeFirst()
    if (!row) throw new Error(`Dataset ${ref} is not an asset of this challenge.`)
    const parsed = JSON.parse(row.bytes.toString('utf8')) as unknown
    const rows = Array.isArray(parsed) ? parsed : ((parsed as { patients?: unknown; rows?: unknown }).patients ?? (parsed as { rows?: unknown }).rows)
    if (!Array.isArray(rows) || rows.length === 0) throw new Error(`Dataset ${ref} has no rows.`)
    return rows as DatasetRow[]
  }
}
