import { notFound } from 'next/navigation'
import { isNetworkAdmin, listSites } from '@challengeforge/db'
import { SimpleForm } from '@/components/common/SimpleForm'
import { db } from '@/server/db'
import { requirePageRole } from '@/server/guards'

export const metadata = { title: 'Network' }

/** Install-level: the sites this installation serves, and their domains (network admins only). */
export default async function NetworkPage() {
  const scope = await requirePageRole('learner', '/network')
  if (!(await isNetworkAdmin(db(), scope.principal!.userId))) notFound()
  const sites = await listSites(db(), scope)
  return (
    <div className="space-y-10">
      <header>
        <p className="eyebrow">Network</p>
        <h1 className="text-4xl">Sites on this installation</h1>
        <p className="text-ink-muted">
          Each site has its own people, content, look and settings. Accounts are shared: one person, one password, a role on each site they join.
          Point each domain at this app (in your hosting panel) before adding it here.
        </p>
      </header>
      <ul className="space-y-3">
        {sites.map((s) => (
          <li key={s.id} className="card space-y-2">
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="mr-auto text-xl">{s.name}</h2>
              <span className="font-mono text-sm text-ink-muted">{s.slug}</span>
              <span className="text-sm text-ink-muted">{s.admins} admin{s.admins === 1 ? '' : 's'}</span>
            </div>
            <p className="text-sm">{s.hosts.length > 0 ? s.hosts.join(' · ') : 'The default site (APP_URL).'}</p>
            {s.hosts.length > 0 && (
              <SimpleForm url={`/api/network/sites/${s.id}/domains`} submitLabel="Add domain" inline fields={[{ name: 'host', label: 'Another domain for this site', type: 'text', required: true, maxLength: 255 }]} />
            )}
          </li>
        ))}
      </ul>
      <section className="card max-w-xl space-y-3" aria-labelledby="new-site">
        <h2 id="new-site" className="text-xl">New site</h2>
        <SimpleForm
          url="/api/network/sites"
          submitLabel="Create site"
          fields={[
            { name: 'name', label: 'Name', type: 'text', required: true, maxLength: 200 },
            { name: 'slug', label: 'Short name', type: 'text', required: true, maxLength: 63, help: 'Lowercase letters, digits and hyphens.' },
            { name: 'host', label: 'Domain', type: 'text', required: true, maxLength: 255, help: 'e.g. pathology.example.org (with :port only when testing locally).' },
            { name: 'adminEmail', label: 'First admin (email, optional)', type: 'email', maxLength: 254, help: 'An existing account. Leave empty to be its admin yourself.' },
          ]}
        />
      </section>
    </div>
  )
}
