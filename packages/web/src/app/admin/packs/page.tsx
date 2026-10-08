import Link from 'next/link'
import { listPacks } from '@challengeforge/db'
import { PackUploadForm } from '@/components/admin/PackUploadForm'
import { PostButton } from '@/components/common/PostButton'
import { db } from '@/server/db'
import { requirePageRole } from '@/server/guards'
import { registryPacks, registryUrl } from '@/server/packs'

export const metadata = { title: 'Packs' }

export default async function PacksPage() {
  const scope = await requirePageRole('admin', '/admin/packs')
  const [packs, fromRegistry] = await Promise.all([listPacks(db(), scope), registryPacks()])
  const installed = new Set(packs.map((p) => p.slug))
  return (
    <div className="space-y-10">
      <header>
        <p className="eyebrow"><Link href="/admin" className="hover:underline">Admin</Link></p>
        <h1 className="text-4xl">Packs</h1>
        <p className="text-ink-muted">A pack is a set of challenges with its files. Packs are data only: importing one never runs code on this server.</p>
      </header>

      <section className="space-y-3" aria-labelledby="installed">
        <h2 id="installed" className="text-2xl">On this site</h2>
        {packs.length === 0 ? (
          <p className="text-ink-muted">No packs yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {packs.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="mr-auto font-semibold">{p.title} <span className="font-mono text-xs font-normal text-ink-muted">{p.slug}</span></span>
                <a className="btn-secondary" href={`/api/admin/packs/${p.id}/zip`}>Download .zip</a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card max-w-2xl space-y-3" aria-labelledby="upload">
        <h2 id="upload" className="text-xl">Import a pack</h2>
        <p className="text-sm text-ink-muted">Everything is checked before anything is saved. Re-importing a pack updates changed challenges as drafts; learners keep the published version until you publish again.</p>
        <PackUploadForm />
      </section>

      <section className="space-y-3" aria-labelledby="registry">
        <h2 id="registry" className="text-2xl">From the pack registry</h2>
        {!registryUrl() ? (
          <p className="text-ink-muted">No registry is configured (set PACK_REGISTRY_URL).</p>
        ) : fromRegistry.error ? (
          <p role="alert" className="text-danger">{fromRegistry.error}</p>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {fromRegistry.packs.map((p) => (
              <li key={p.slug} className="card space-y-2">
                <p className="font-semibold">{p.title} {p.version && <span className="text-sm font-normal text-ink-muted">v{p.version}</span>}</p>
                {p.description && <p className="text-sm text-ink-muted">{p.description}</p>}
                <PostButton url="/api/admin/packs/install" body={{ slug: p.slug }} label={installed.has(p.slug) ? 'Update from registry' : 'Install'} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
