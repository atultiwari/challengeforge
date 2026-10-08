import { updateCohort } from '@challengeforge/db'
import { db } from '@/server/db'
import { optionalBool, optionalText } from '@/server/body'
import { ok } from '@/server/http'
import { mutation } from '@/server/route'

/** Rename, open or close joining, rotate the code, archive or restore. */
export async function POST(request: Request, ctx: { params: Promise<{ cohortId: string }> }) {
  const { cohortId } = await ctx.params
  return mutation(request, async ({ scope, body }) => {
    const name = optionalText(body, 'name')
    const joiningOpen = optionalBool(body, 'joiningOpen')
    const archived = optionalBool(body, 'archived')
    const rotateCode = optionalBool(body, 'rotateCode')
    const cohort = await updateCohort(db(), scope, cohortId, {
      ...(name !== undefined ? { name } : {}),
      ...(joiningOpen !== undefined ? { joiningOpen } : {}),
      ...(archived !== undefined ? { archived } : {}),
      ...(rotateCode ? { rotateCode } : {}),
    })
    return ok(cohort)
  })
}
