import { cohortAnalytics } from '@challengeforge/db'
import { db } from '@/server/db'
import { csvDownload } from '@/server/csv-response'
import { STATS_HEADER, statsRow } from '@/lib/stats-csv'

export async function GET(_request: Request, ctx: { params: Promise<{ cohortId: string }> }) {
  const { cohortId } = await ctx.params
  return csvDownload(`cohort-analytics-${cohortId.slice(0, 8)}`, async (scope) => ({
    header: STATS_HEADER,
    rows: (await cohortAnalytics(db(), scope, cohortId)).map(statsRow),
  }))
}
