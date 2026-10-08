import { createCohort } from '@challengeforge/db'
import { db } from '@/server/db'
import { text } from '@/server/body'
import { ok } from '@/server/http'
import { mutation } from '@/server/route'

/** An instructor creates a cohort in one of their organisations. */
export async function POST(request: Request) {
  return mutation(request, async ({ scope, body }) => ok(await createCohort(db(), scope, text(body, 'orgId', 64), text(body, 'name'))))
}
