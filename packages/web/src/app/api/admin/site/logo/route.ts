import { MAX_SITE_FILE_BYTES, deleteSiteFile, putSiteFile, saveSiteSettings } from '@challengeforge/db'
import { db } from '@/server/db'
import { fail, ok, sameOrigin, toResponse } from '@/server/http'
import { currentScope } from '@/server/scope'
import { currentSettings } from '@/server/site-settings'

/** Uploads (multipart "logo") or, with an empty form, removes the site logo. Admins only. */
export async function POST(request: Request) {
  if (!(await sameOrigin(request))) return fail(403, 'bad_origin', 'Request refused.')
  if (Number(request.headers.get('content-length') ?? 0) > MAX_SITE_FILE_BYTES + 16_384) return fail(413, 'too_large', 'The image must be under 512 KB.')
  try {
    const { scope } = await currentScope()
    const file = (await request.formData()).get('logo')
    const settings = await currentSettings()
    if (!(file instanceof File) || file.size === 0) {
      await deleteSiteFile(db(), scope, 'logo')
      await saveSiteSettings(db(), scope, settings, { hasLogo: false })
      return ok({ hasLogo: false })
    }
    await putSiteFile(db(), scope, 'logo', file.type, Buffer.from(await file.arrayBuffer()))
    await saveSiteSettings(db(), scope, settings, { hasLogo: true })
    return ok({ hasLogo: true })
  } catch (err) {
    return toResponse(err)
  }
}
