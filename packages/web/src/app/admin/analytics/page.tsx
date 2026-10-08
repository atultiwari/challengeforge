import Link from 'next/link'
import { listPacks, packAnalytics } from '@challengeforge/db'
import { StatsTable } from '@/components/analytics/StatsTable'
import { db } from '@/server/db'
import { requirePageRole } from '@/server/guards'

export const metadata = { title: 'Analytics' }

export default async function AnalyticsPage() {
  const scope = await requirePageRole('editor', '/admin/analytics')
  const packs = await listPacks(db(), scope)
  const reports = await Promise.all(packs.map(async (p) => ({ pack: p, report: await packAnalytics(db(), scope, p.id) })))
  return (
    <div className="space-y-10">
      <header>
        <p className="eyebrow"><Link href="/admin" className="hover:underline">Admin</Link></p>
        <h1 className="text-4xl">Analytics</h1>
        <p className="text-ink-muted">From every learner&apos;s attempts on this site. Open a challenge in Author for its criteria.</p>
      </header>
      {reports.map(({ pack, report }) => (
        <section key={pack.id} className="space-y-3" aria-labelledby={`a-${pack.id}`}>
          <div className="flex flex-wrap items-baseline gap-3">
            <h2 id={`a-${pack.id}`} className="mr-auto text-2xl">{report.packTitle}</h2>
            <a className="text-sm underline" href={`/api/analytics/packs/${pack.id}/csv`}>Download CSV</a>
          </div>
          <StatsTable stats={report.challenges} />
        </section>
      ))}
    </div>
  )
}
