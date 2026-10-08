import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isTeacher, listMyCohorts, listMyOrganisations } from '@challengeforge/db'
import { SimpleForm } from '@/components/common/SimpleForm'
import { db } from '@/server/db'
import { requirePageRole } from '@/server/guards'

export const metadata = { title: 'Teach' }

export default async function TeachPage() {
  const scope = await requirePageRole('learner', '/teach')
  if (!(await isTeacher(db(), scope))) notFound()
  const [orgs, { teaching }] = await Promise.all([listMyOrganisations(db(), scope), listMyCohorts(db(), scope)])
  const canCreateIn = orgs.filter((o) => o.role !== 'member')
  const active = teaching.filter((c) => !c.archived)
  const archived = teaching.filter((c) => c.archived)
  return (
    <div className="space-y-10">
      <header>
        <p className="eyebrow">Teach</p>
        <h1 className="text-4xl">Your cohorts</h1>
        <p className="mt-2 text-sm"><Link className="underline" href="/teach/review">Results waiting for your review</Link></p>
      </header>
      <section className="space-y-3">
        {active.length === 0 ? (
          <p className="text-ink-muted">You are not teaching any cohorts yet.</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {active.map((c) => (
              <li key={c.id}>
                <Link href={`/teach/cohorts/${c.id}`} className="card block transition-colors hover:border-accent">
                  <p className="font-semibold">{c.name}</p>
                  <p className="mt-1 text-sm text-ink-muted">{c.orgName} · code {c.joinCode}{c.joiningOpen ? '' : ' (closed)'}</p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      {canCreateIn.length > 0 && (
        <section className="card max-w-lg space-y-3">
          <h2 className="text-xl">New cohort</h2>
          <SimpleForm
            url="/api/cohorts"
            submitLabel="Create cohort"
            then={{ goTo: '/teach/cohorts/{id}' }}
            fields={[
              { name: 'name', label: 'Name', type: 'text', required: true, help: 'e.g. "Year 3 pathology, 2026".' },
              { name: 'orgId', label: 'Organisation', type: 'select', required: true, options: canCreateIn.map((o) => [o.id, o.name] as const) },
            ]}
          />
        </section>
      )}
      <section className="space-y-3">
        <h2 className="text-2xl">Organisations</h2>
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {orgs.map((o) => (
            <li key={o.id} className="flex items-center gap-3 px-4 py-3">
              {o.role === 'member' ? <span className="mr-auto">{o.name}</span> : <Link href={`/teach/orgs/${o.id}`} className="mr-auto font-semibold hover:underline">{o.name}</Link>}
              <span className="pill bg-surface-sunken text-ink-muted">{o.role.replace('_', ' ')}</span>
            </li>
          ))}
        </ul>
      </section>
      {archived.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-xl">Archived cohorts</h2>
          <ul className="text-sm">
            {archived.map((c) => <li key={c.id}><Link className="underline" href={`/teach/cohorts/${c.id}`}>{c.name}</Link> <span className="text-ink-muted">({c.orgName})</span></li>)}
          </ul>
        </section>
      )}
    </div>
  )
}
