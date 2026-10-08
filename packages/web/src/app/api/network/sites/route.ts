import { createSite } from '@challengeforge/db'
import { db } from '@/server/db'
import { optionalText, text } from '@/server/body'
import { ok } from '@/server/http'
import { mutation } from '@/server/route'

/** A network admin creates a site served at a host, naming its first admin (or becoming it). */
export async function POST(request: Request) {
  return mutation(request, async ({ scope, body }) => {
    const adminEmail = optionalText(body, 'adminEmail', 254)
    return ok(
      await createSite(db(), scope, {
        slug: text(body, 'slug', 63),
        name: text(body, 'name', 200),
        host: text(body, 'host', 255),
        ...(adminEmail ? { adminEmail } : {}),
      }),
    )
  })
}
