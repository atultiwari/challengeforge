import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  ForbiddenError,
  NotFoundError,
  cohortProgress,
  listAssignments,
  listCohortMembers,
  listPacks,
  listPlayable,
  requireCohortManager,
} from '@challengeforge/db'
import { PostButton } from '@/components/common/PostButton'
import { SimpleForm } from '@/components/common/SimpleForm'
import { ProgressGridTable } from '@/components/teach/ProgressGridTable'
import { db } from '@/server/db'
import { env } from '@/server/env'
import { requirePageRole } from '@/server/guards'

export const metadata = { title: 'Cohort' }

async function load(scope: Parameters<typeof requireCohortManager>[1], cohortId: string) {
  try {
    const cohort = await requireCohortManager(db(), scope, cohortId)
    const [assignments, members, grid, packs, challenges] = await Promise.all([
      listAssignments(db(), scope, cohortId),
      listCohortMembers(db(), scope, cohortId),
      cohortProgress(db(), scope, cohortId),
      listPacks(db(), scope),
      listPlayable(db(), scope),
    ])
    return { cohort, assignments, members, grid, packs, challenges }
  } catch (err) {
    if (err instanceof NotFoundError || err instanceof ForbiddenError) notFound()
    throw err
  }
}

export default async function CohortPage({ params }: { params: Promise<{ cohortId: string }> }) {
  const { cohortId } = await params
  const scope = await requirePageRole('learner', `/teach/cohorts/${cohortId}`)
  const { cohort, assignments, members, grid, packs, challenges } = await load(scope, cohortId)
  const api = `/api/cohorts/${cohortId}`
  const joinUrl = `${env().APP_URL}/join?code=${cohort.joinCode}`
  const targets = [
    ...packs.map((p) => [`pack:${p.id}`, `Pack: ${p.title}`] as const),
    ...challenges.map((c) => [`challenge:${c.id}`, `Challenge: ${c.title}`] as const),
  ]
  const instructors = members.filter((m) => m.role === 'instructor')
  return (
    <div className="space-y-10">
      <header className="space-y-2">
        <p className="eyebrow"><Link href="/teach" className="hover:underline">Teach</Link> · {cohort.orgName}</p>
        <h1 className="text-4xl">{cohort.name}{cohort.archived && <span className="ml-3 pill bg-surface-sunken text-ink-muted">archived</span>}</h1>
      </header>

      <section className="card space-y-3" aria-labelledby="joining">
        <h2 id="joining" className="text-xl">Joining</h2>
        <p>
          Code <strong className="font-mono text-2xl tracking-widest" data-testid="join-code">{cohort.joinCode}</strong>{' '}
          {cohort.joiningOpen ? <span className="text-good">open</span> : <span className="text-danger">closed</span>}
        </p>
        <p className="text-sm text-ink-muted">Learners sign in and enter the code at <span className="font-mono">{joinUrl}</span></p>
        <div className="flex flex-wrap gap-2">
          <PostButton url={api} body={{ joiningOpen: !cohort.joiningOpen }} label={cohort.joiningOpen ? 'Close joining' : 'Open joining'} />
          <PostButton url={api} body={{ rotateCode: true }} label="New code" confirm="Make a new code? The old one stops working; people already in stay in." />
          <PostButton url={api} body={{ archived: !cohort.archived }} label={cohort.archived ? 'Restore cohort' : 'Archive cohort'} />
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="progress">
        <h2 id="progress" className="text-2xl">Progress</h2>
        <ProgressGridTable grid={grid} />
      </section>

      <section className="space-y-3" aria-labelledby="assignments">
        <h2 id="assignments" className="text-2xl">Assignments</h2>
        {assignments.length > 0 && (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {assignments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="mr-auto">{a.packId ? 'Pack: ' : ''}{a.title}</span>
                {a.dueAt && <span className="text-sm text-ink-muted">due {a.dueAt.toISOString().slice(0, 16).replace('T', ' ')} UTC</span>}
                <PostButton url={`${api}/assignments/remove`} body={{ assignmentId: a.id }} label="Remove" />
              </li>
            ))}
          </ul>
        )}
        {targets.length > 0 ? (
          <div className="card max-w-2xl">
            <SimpleForm
              url={`${api}/assignments`}
              submitLabel="Assign"
              inline
              fields={[
                { name: 'target', label: 'What to assign', type: 'select', required: true, options: targets },
                { name: 'dueAt', label: 'Due (optional)', type: 'datetime-local' },
              ]}
            />
          </div>
        ) : (
          <p className="text-ink-muted">Nothing is published yet, so there is nothing to assign.</p>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="people">
        <h2 id="people" className="text-2xl">People</h2>
        <p className="text-sm text-ink-muted">{instructors.length} instructor{instructors.length === 1 ? '' : 's'}, {members.length - instructors.length} learners</p>
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="mr-auto"><span className="font-semibold">{m.name}</span> <span className="text-sm text-ink-muted">{m.email}</span></span>
              {m.role === 'instructor' && <span className="pill bg-surface-sunken text-ink-muted">instructor</span>}
              {m.userId !== scope.principal?.userId && (
                <PostButton url={`${api}/members/remove`} body={{ userId: m.userId }} label="Remove" confirm={`Remove ${m.name} from this cohort?`} />
              )}
            </li>
          ))}
        </ul>
        <div className="card max-w-lg">
          <SimpleForm
            url={`${api}/instructors`}
            submitLabel="Add instructor"
            inline
            fields={[{ name: 'email', label: 'Co-instructor email', type: 'email', required: true, maxLength: 254 }]}
          />
        </div>
      </section>
    </div>
  )
}
