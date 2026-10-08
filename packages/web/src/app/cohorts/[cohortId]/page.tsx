import Link from 'next/link'
import { notFound } from 'next/navigation'
import { NotFoundError, cohortAccess, myCohortAssignments } from '@challengeforge/db'
import { db } from '@/server/db'
import { requirePageRole } from '@/server/guards'

export const metadata = { title: 'Cohort' }

const due = (d: Date) => d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'

/** A learner's view of their cohort: what is assigned, by when, and how they are doing. */
export default async function LearnerCohortPage({ params }: { params: Promise<{ cohortId: string }> }) {
  const { cohortId } = await params
  const scope = await requirePageRole('learner', `/cohorts/${cohortId}`)
  const found = await cohortAccess(db(), scope, cohortId)
  if (!found) notFound()
  let items
  try {
    items = await myCohortAssignments(db(), scope, cohortId)
  } catch (err) {
    if (err instanceof NotFoundError) notFound()
    throw err
  }
  const done = items.filter((i) => i.passed).length
  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">{found.cohort.orgName}</p>
        <h1 className="text-4xl">{found.cohort.name}</h1>
        <p className="text-ink-muted">{done} of {items.length} passed</p>
        {found.access === 'manage' && <p className="mt-2 text-sm"><Link className="underline" href={`/teach/cohorts/${cohortId}`}>Instructor view</Link></p>}
      </header>
      {items.length === 0 ? (
        <p className="card">Your instructor has not assigned anything yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {items.map((i) => (
            <li key={i.challengeId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Link href={`/play/${i.challengeId}`} className="mr-auto font-semibold hover:underline">{i.title}</Link>
              {i.dueAt && <span className={`text-sm ${i.late ? 'text-danger' : 'text-ink-muted'}`}>{i.late && !i.passed ? 'overdue · ' : ''}due {due(i.dueAt)}</span>}
              <span className={`pill ${i.passed ? 'bg-good-soft text-good' : 'bg-surface-sunken text-ink-muted'}`}>
                {i.passed ? `Passed · ${i.bestPoints}` : i.attempts > 0 ? `Tried ${i.attempts}×` : 'Not started'}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
