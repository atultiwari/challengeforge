import { cohortLearningFacts } from '@challengeforge/db'
import { db } from '@/server/db'
import { xapiDownload } from '@/server/xapi-response'

/** A cohort's learning records as xAPI statements (its instructors). */
export async function GET(_request: Request, ctx: { params: Promise<{ cohortId: string }> }) {
  const { cohortId } = await ctx.params
  return xapiDownload(`cohort-${cohortId.slice(0, 8)}`, (scope) => cohortLearningFacts(db(), scope, cohortId))
}
