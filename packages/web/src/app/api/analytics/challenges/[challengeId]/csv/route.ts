import { challengeAnalytics } from '@challengeforge/db'
import { db } from '@/server/db'
import { csvDownload } from '@/server/csv-response'
import { STATS_HEADER, statsRow } from '@/lib/stats-csv'

/** One challenge's per-criterion numbers. */
export async function GET(_request: Request, ctx: { params: Promise<{ challengeId: string }> }) {
  const { challengeId } = await ctx.params
  return csvDownload(`analytics-${challengeId.slice(0, 8)}`, async (scope) => {
    const stats = await challengeAnalytics(db(), scope, challengeId)
    return {
      header: [...STATS_HEADER, 'Criterion', 'Critical', 'Assessed', 'Missed', 'Miss rate %'],
      rows: stats.criteria.length === 0
        ? [statsRow(stats)]
        : stats.criteria.map((c) => [...statsRow(stats), c.label, c.critical, c.assessed, c.missed, Math.round(c.missRate * 1000) / 10]),
    }
  })
}
