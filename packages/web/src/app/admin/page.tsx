import Link from 'next/link'
import { hasRole, listForAuthoring, listMembers, listReviewQueue } from '@challengeforge/db'
import { RoleSelect } from '@/components/admin/RoleSelect'
import { db } from '@/server/db'
import { requirePageRole } from '@/server/guards'

export const metadata = { title: 'Admin' }

export default async function AdminPage() {
  // Editors review and publish here; people and the audit log are for admins.
  const scope = await requirePageRole('editor', '/admin')
  const isAdmin = hasRole(scope, 'admin')
  const [members, challenges, reviews] = await Promise.all([isAdmin ? listMembers(db(), scope) : Promise.resolve([]), listForAuthoring(db(), scope), listReviewQueue(db(), scope)])
  const awaiting = challenges.filter((c) => c.status === 'in_review' || c.status === 'draft')
  return (
    <div className="space-y-10">
      <header>
        <p className="eyebrow">Admin</p>
        <h1 className="text-4xl">{isAdmin ? 'Site administration' : 'Review and publishing'}</h1>
        {isAdmin && (
          <p className="mt-2 flex gap-4 text-sm">
            <Link className="underline" href="/admin/orgs">Organisations</Link>
            <Link className="underline" href="/admin/audit">Audit log</Link>
          </p>
        )}
      </header>
      <section className="space-y-3">
        <h2 className="text-2xl">Results waiting for review</h2>
        {reviews.length === 0 ? (
          <p className="text-ink-muted">No results are waiting.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {reviews.map((r) => (
              <li key={r.attemptId} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Link href={`/admin/review/${r.attemptId}`} className="mr-auto font-semibold hover:underline">
                  {r.challengeTitle}
                </Link>
                <span className="text-sm text-ink-muted">{r.learnerName}</span>
                <span className={`pill ${r.passed ? 'bg-good-soft text-good' : 'bg-danger-soft text-danger'}`}>{r.passed ? 'auto: pass' : 'auto: fail'}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="space-y-3">
        <h2 className="text-2xl">Waiting to be published</h2>
        {awaiting.length === 0 ? (
          <p className="text-ink-muted">Nothing is waiting.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {awaiting.map((c) => (
              <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                <Link href={`/author/${c.id}`} className="mr-auto font-semibold hover:underline">{c.title}</Link>
                <span className="pill bg-surface-sunken text-ink-muted">{c.status.replace('_', ' ')}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
{isAdmin && (
      <section className="space-y-3">
        <h2 className="text-2xl">People</h2>
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {members.map((m) => (
            <li key={m.userId} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <span className="mr-auto">
                <span className="font-semibold">{m.name}</span> <span className="text-sm text-ink-muted">{m.email}</span>
              </span>
              <RoleSelect userId={m.userId} role={m.role} isSelf={m.userId === scope.principal?.userId} />
            </li>
          ))}
        </ul>
      </section>
      )}
    </div>
  )
}
