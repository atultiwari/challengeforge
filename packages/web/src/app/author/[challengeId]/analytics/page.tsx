import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ForbiddenError, NotFoundError, challengeAnalytics } from '@challengeforge/db'
import { CriteriaTable, StatsTable } from '@/components/analytics/StatsTable'
import { db } from '@/server/db'
import { requirePageRole } from '@/server/guards'

export const metadata = { title: 'Challenge analytics' }

export default async function ChallengeAnalyticsPage({ params }: { params: Promise<{ challengeId: string }> }) {
  const { challengeId } = await params
  const scope = await requirePageRole('author', `/author/${challengeId}/analytics`)
  let stats
  try {
    stats = await challengeAnalytics(db(), scope, challengeId)
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound()
    throw err
  }
  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow"><Link href={`/author/${challengeId}`} className="hover:underline">Edit challenge</Link></p>
        <h1 className="text-4xl">{stats.title}: how learners do</h1>
        <p className="text-ink-muted">Every learner on the site; previews never count. <a className="underline" href={`/api/analytics/challenges/${challengeId}/csv`}>Download CSV</a></p>
      </header>
      <StatsTable stats={[stats]} />
      <section className="space-y-3">
        <h2 className="text-2xl">Criteria, most missed first</h2>
        <p className="text-sm text-ink-muted">A criterion most people miss may be unclear, or may be the lesson that needs the most teaching.</p>
        <CriteriaTable stats={stats} />
      </section>
    </div>
  )
}
