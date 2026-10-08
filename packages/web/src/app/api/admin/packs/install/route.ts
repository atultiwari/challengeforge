import { importPack, ValidationError } from '@challengeforge/db'
import { downloadRegistryPack, PackZipError } from '@challengeforge/services'
import { registry } from '@challengeforge/types'
import { db } from '@/server/db'
import { fail, ok } from '@/server/http'
import { text } from '@/server/body'
import { registryPacks } from '@/server/packs'
import { mutation } from '@/server/route'

/** Installs a registry pack by slug. The URL and checksum come from the registry index, never from the browser. */
export async function POST(request: Request) {
  return mutation(request, async ({ scope, body }) => {
    const slug = text(body, 'slug', 63)
    const { packs, error } = await registryPacks()
    if (error) return fail(502, 'registry_unreachable', error)
    const entry = packs.find((p) => p.slug === slug)
    if (!entry) throw new ValidationError('That pack is not in the registry.')
    try {
      return ok(await importPack(db(), scope, registry, await downloadRegistryPack(entry), { publish: false }))
    } catch (err) {
      if (err instanceof PackZipError) return fail(422, 'bad_pack', err.message)
      throw err
    }
  })
}
