import Link from 'next/link'
import { listForAuthoring } from '@challengeforge/db'
import { db } from '@/server/db'
import { requirePageRole } from '@/server/guards'

export const metadata = { title: 'Author' }

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-surface-sunken text-ink-muted',
  in_review: 'bg-warn-soft text-warn',
  published: 'bg-good-soft text-good',
  archived: 'bg-surface-sunken text-ink-faint',
}

export default async function AuthorHome() {
  const scope = await requirePageRole('author', '/author')
  const challenges = await listForAuthoring(db(), scope)
  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end gap-4">
        <div className="mr-auto">
          <p className="eyebrow">Author</p>
          <h1 className="text-4xl">Your challenges</h1>
        </div>
        <Link href="/author/new" className="btn-primary">New question set</Link>
      </header>
      {challenges.length === 0 ? (
        <p className="card">Nothing here yet. Start with a question set: a clinical case quiz takes about ten minutes to write.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {challenges.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Link href={`/author/${c.id}`} className="mr-auto font-semibold hover:underline">{c.title}</Link>
              <span className="font-mono text-xs text-ink-muted">{c.typeId}</span>
              <span className={`pill ${STATUS_STYLE[c.status] ?? ''}`}>{c.status.replace('_', ' ')}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
