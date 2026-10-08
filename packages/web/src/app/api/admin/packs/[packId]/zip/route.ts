import { exportFiles, exportPack, listPacks, NotFoundError, requireRole } from '@challengeforge/db'
import { packToZip } from '@challengeforge/services'
import { db } from '@/server/db'
import { fail, toResponse } from '@/server/http'
import { currentScope } from '@/server/scope'

/** Downloads a pack (published versions, sections, assets) as a .zip that any ChallengeForge site can import. */
export async function GET(_request: Request, ctx: { params: Promise<{ packId: string }> }) {
  const { packId } = await ctx.params
  try {
    const { scope } = await currentScope()
    requireRole(scope, 'admin')
    const pack = (await listPacks(db(), scope)).find((p) => p.id === packId)
    if (!pack) throw new NotFoundError('Pack not found.')
    const zip = packToZip(exportFiles(await exportPack(db(), scope, pack.slug)))
    return new Response(new Uint8Array(zip), {
      headers: {
        'content-type': 'application/zip',
        'content-disposition': `attachment; filename="${pack.slug}.zip"`,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    })
  } catch (err) {
    if ((err as { code?: string }).code === 'forbidden') return fail(404, 'not_found', 'Not found.')
    return toResponse(err)
  }
}
