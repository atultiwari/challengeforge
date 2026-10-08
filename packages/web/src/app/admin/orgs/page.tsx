import Link from 'next/link'
import { listMyOrganisations } from '@challengeforge/db'
import { SimpleForm } from '@/components/common/SimpleForm'
import { db } from '@/server/db'
import { requirePageRole } from '@/server/guards'

export const metadata = { title: 'Organisations' }

export default async function OrganisationsPage() {
  const scope = await requirePageRole('admin', '/admin/orgs')
  const orgs = await listMyOrganisations(db(), scope)
  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow"><Link href="/admin" className="hover:underline">Admin</Link></p>
        <h1 className="text-4xl">Organisations</h1>
        <p className="text-ink-muted">Schools or departments on this site. Each has its own instructors and cohorts.</p>
      </header>
      {orgs.length === 0 ? (
        <p className="text-ink-muted">No organisations yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {orgs.map((o) => (
            <li key={o.id} className="flex items-center gap-3 px-4 py-3">
              <Link href={`/teach/orgs/${o.id}`} className="mr-auto font-semibold hover:underline">{o.name}</Link>
              <span className="text-sm text-ink-muted">{o.slug}</span>
            </li>
          ))}
        </ul>
      )}
      <section className="card max-w-lg space-y-3">
        <h2 className="text-xl">New organisation</h2>
        <SimpleForm
          url="/api/admin/orgs"
          submitLabel="Create organisation"
          then={{ goTo: '/teach/orgs/{id}' }}
          fields={[
            { name: 'name', label: 'Name', type: 'text', required: true },
            { name: 'slug', label: 'Short name', type: 'text', required: true, maxLength: 63, help: 'Lowercase letters, digits and hyphens, e.g. "med-school".' },
          ]}
        />
      </section>
    </div>
  )
}
