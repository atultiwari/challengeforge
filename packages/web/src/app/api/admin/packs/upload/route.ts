import { importPack, requireRole } from '@challengeforge/db'
import { loadPackFromZip, MAX_PACK_ZIP_BYTES, PackZipError } from '@challengeforge/services'
import { registry } from '@challengeforge/types'
import { db } from '@/server/db'
import { fail, ok, readBytesCapped, sameOrigin, toResponse } from '@/server/http'
import { currentScope } from '@/server/scope'

/** An admin uploads a pack .zip; it is validated in full by the same importer the CLI uses. */
export async function POST(request: Request) {
  if (!(await sameOrigin(request))) return fail(403, 'bad_origin', 'Request refused.')
  try {
    const { scope } = await currentScope()
    requireRole(scope, 'admin')
    const raw = await readBytesCapped(request, MAX_PACK_ZIP_BYTES + 64 * 1024)
    if (raw === null) return fail(413, 'too_large', 'The pack is larger than 32 MB.')
    const form = await new Response(new Uint8Array(raw), { headers: { 'content-type': request.headers.get('content-type') ?? '' } }).formData()
    const file = form.get('pack')
    if (!(file instanceof File) || file.size === 0) return fail(400, 'bad_request', 'Choose a pack .zip file.')
    const pack = loadPackFromZip(new Uint8Array(await file.arrayBuffer()))
    return ok(await importPack(db(), scope, registry, pack, { publish: form.get('publish') === 'yes' }))
  } catch (err) {
    if (err instanceof PackZipError) return fail(422, 'bad_pack', err.message)
    return toResponse(err)
  }
}
