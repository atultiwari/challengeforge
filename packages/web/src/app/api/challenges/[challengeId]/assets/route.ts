import { getAssetForPlay } from '@challengeforge/db'
import { db } from '@/server/db'
import { fail, toResponse } from '@/server/http'
import { withinLimit } from '@/server/limits'
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
    if (!withinLimit('asset', scope, request)) return fail(429, 'rate_limited', 'Too many requests. Wait a minute and try again.')
    const asset = await getAssetForPlay(db(), scope, challengeId, path)
    return new Response(new Uint8Array(asset.bytes), {
      headers: {
        'content-type': asset.contentType,
        'cache-control': 'private, max-age=3600',
        etag: `"${asset.sha256}"`,
        'x-content-type-options': 'nosniff',
        'content-disposition': 'inline',
        // Even if a browser rendered an asset as a document, it could run nothing.
        'content-security-policy': "default-src 'none'; sandbox",
      },
    })
  } catch (err) {
    return toResponse(err)
  }
}
