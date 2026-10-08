import Link from 'next/link'
import { notFound } from 'next/navigation'
import { ForbiddenError, listReviewQueue } from '@challengeforge/db'
import { db } from '@/server/db'
import { requirePageRole } from '@/server/guards'

export const metadata = { title: 'Review' }

/** Results from the instructor's own cohorts that a challenge sent for human review. */
export default async function TeachReviewPage() {
  const scope = await requirePageRole('learner', '/teach/review')
  let items
  try {
    items = await listReviewQueue(db(), scope)
  } catch (err) {
    if (err instanceof ForbiddenError) notFound()
    throw err
  }
  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow"><Link href="/teach" className="hover:underline">Teach</Link></p>
        <h1 className="text-4xl">Waiting for your review</h1>
      </header>
      {items.length === 0 ? (
        <p className="text-ink-muted">Nothing is waiting.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {items.map((r) => (
            <li key={r.attemptId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Link href={`/admin/review/${r.attemptId}`} className="mr-auto font-semibold hover:underline">{r.challengeTitle}</Link>
              <span className="text-sm text-ink-muted">{r.learnerName}</span>
              <span className={`pill ${r.passed ? 'bg-good-soft text-good' : 'bg-danger-soft text-danger'}`}>{r.passed ? 'auto: pass' : 'auto: fail'}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
