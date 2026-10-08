import { cohortProgress } from '@challengeforge/db'
import { db } from '@/server/db'
import { csvDownload } from '@/server/csv-response'

/** The progress grid as a spreadsheet: one row per learner, a pass/points pair per assigned challenge. */
export async function GET(_request: Request, ctx: { params: Promise<{ cohortId: string }> }) {
  const { cohortId } = await ctx.params
  return csvDownload(`cohort-progress-${cohortId.slice(0, 8)}`, async (scope) => {
    const grid = await cohortProgress(db(), scope, cohortId)
    const header = ['Learner', 'Email', 'Passed', ...grid.columns.flatMap((c) => [`${c.title}: passed`, `${c.title}: points`, `${c.title}: late`])]
    const rows = grid.rows.map((r) => [
      r.name,
      r.email,
      r.passedCount,
      ...grid.columns.flatMap((c) => {
        const cell = r.cells[c.challengeId]!
        return [cell.passed, cell.bestPoints, cell.late]
      }),
    ])
    return { header, rows }
  })
}
