import { createOrganisation } from '@challengeforge/db'
import { db } from '@/server/db'
import { text } from '@/server/body'
import { ok } from '@/server/http'
import { mutation } from '@/server/route'

/** A site admin creates an organisation. */
export async function POST(request: Request) {
  return mutation(request, async ({ scope, body }) => ok(await createOrganisation(db(), scope, { slug: text(body, 'slug', 63), name: text(body, 'name') })))
}
