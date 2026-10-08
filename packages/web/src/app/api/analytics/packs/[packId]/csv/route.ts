import { packAnalytics } from '@challengeforge/db'
import { db } from '@/server/db'
import { csvDownload } from '@/server/csv-response'
import { STATS_HEADER, statsRow } from '@/lib/stats-csv'

export async function GET(_request: Request, ctx: { params: Promise<{ packId: string }> }) {
  const { packId } = await ctx.params
  return csvDownload(`pack-analytics-${packId.slice(0, 8)}`, async (scope) => {
    const report = await packAnalytics(db(), scope, packId)
    return { header: STATS_HEADER, rows: report.challenges.map(statsRow) }
  })
}
