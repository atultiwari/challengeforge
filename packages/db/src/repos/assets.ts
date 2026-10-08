/**
 * Challenge assets (datasets, case documents, images) stored in the database:
 * the app directory on shared hosting is replaced on every deploy, so files
 * on disk are not durable (docs/PHASE-1-PLAN.md).
 */
import { createHash } from 'node:crypto'
import type { Db } from '../client'
import { newId } from '../ids'
import { NotFoundError, hasRole, requireRole, requireSignedIn, type Scope } from '../scope'

/** MEDIUMBLOB limit, less headroom. */
export const MAX_ASSET_BYTES = 15 * 1024 * 1024

const SAFE_PATH = /^[a-z0-9][a-z0-9._/-]{0,299}$/i

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
  if (!SAFE_PATH.test(asset.path) || asset.path.includes('..')) throw new Error(`Unsafe asset path: ${asset.path}`)
  if (asset.bytes.length > MAX_ASSET_BYTES) throw new Error(`Asset ${asset.path} is larger than ${MAX_ASSET_BYTES} bytes.`)
  const challenge = await db.selectFrom('challenges').select('id').where('id', '=', asset.challengeId).where('site_id', '=', scope.siteId).executeTakeFirst()
  if (!challenge) throw new NotFoundError('Challenge not found.')
  const sha256 = createHash('sha256').update(asset.bytes).digest('hex')
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
 * (results revealed by play, Phase 2) are refused here; authors and admins
 * may read any asset of a challenge on their site.
 */
export async function getAssetForPlay(db: Db, scope: Scope, challengeId: string, path: string): Promise<AssetBody> {
  requireSignedIn(scope)
  const author = hasRole(scope, 'author')
  let query = db
    .selectFrom('assets')
    .innerJoin('challenges', 'challenges.id', 'assets.challenge_id')
    .select(['assets.content_type as contentType', 'assets.bytes as bytes', 'assets.sha256 as sha256', 'assets.visibility as visibility'])
    .where('assets.challenge_id', '=', challengeId)
    .where('assets.path', '=', path)
    .where('challenges.site_id', '=', scope.siteId)
  if (!author) query = query.where('challenges.published_version_id', 'is not', null).where('challenges.status', '!=', 'archived')
  const row = await query.executeTakeFirst()
  if (!row || (row.visibility === 'gated' && !author)) throw new NotFoundError('Asset not found.')
  return { contentType: row.contentType, bytes: row.bytes, sha256: row.sha256 }
}
