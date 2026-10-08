import { joinCohort } from '@challengeforge/db'
import { db } from '@/server/db'
import { text } from '@/server/body'
import { ok } from '@/server/http'
import { mutation } from '@/server/route'

/** A signed-in learner joins a cohort with its code. */
export async function POST(request: Request) {
  return mutation(request, async ({ scope, body }) => {
    const cohort = await joinCohort(db(), scope, text(body, 'code', 32))
    return ok({ id: cohort.id, name: cohort.name })
  })
}
