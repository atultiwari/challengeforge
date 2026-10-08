import { getAssetForPlay } from '@challengeforge/db'
import { db } from '@/server/db'
import { fail, toResponse } from '@/server/http'
import { currentScope } from '@/server/scope'

/**
 * A challenge asset (dataset, case document) for a signed-in learner. Only
 * assets of published challenges; gated assets are refused (repository rule).
 */
export async function GET(request: Request, ctx: { params: Promise<{ challengeId: string }> }) {
  try {
    const { challengeId } = await ctx.params
    const path = new URL(request.url).searchParams.get('path')
    if (!path) return fail(400, 'no_path', 'No asset requested.')
    const { scope } = await currentScope()
    const asset = await getAssetForPlay(db(), scope, challengeId, path)
    return new Response(new Uint8Array(asset.bytes), {
      headers: {
        'content-type': asset.contentType,
        'cache-control': 'private, max-age=3600',
        etag: `"${asset.sha256}"`,
        'x-content-type-options': 'nosniff',
        'content-disposition': 'inline',
      },
    })
  } catch (err) {
    return toResponse(err)
  }
}
