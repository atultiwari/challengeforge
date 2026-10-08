import { NotFoundError, getSiteFile } from '@challengeforge/db'
import { db } from '@/server/db'
import { currentSite } from '@/server/scope'

const NAMES = new Set(['logo'])

/** Site-wide images (the logo). Content type is from our own allow-list; never sniffed. */
export async function GET(_request: Request, ctx: { params: Promise<{ name: string }> }) {
  const { name } = await ctx.params
  if (!NAMES.has(name)) return new Response('Not found', { status: 404 })
  try {
    const site = await currentSite()
    const file = await getSiteFile(db(), site.id, name)
    return new Response(new Uint8Array(file.bytes), {
      headers: {
        'content-type': file.contentType,
        'cache-control': 'public, max-age=300',
        // One app serves several sites: a shared cache must keep each host's logo apart.
        vary: 'Host',
        etag: `"${file.sha256}"`,
        'x-content-type-options': 'nosniff',
        'content-security-policy': "default-src 'none'; sandbox",
      },
    })
  } catch (err) {
    if (err instanceof NotFoundError) return new Response('Not found', { status: 404 })
    throw err
  }
}
