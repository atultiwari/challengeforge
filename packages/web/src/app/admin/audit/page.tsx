import Link from 'next/link'
import { listAudit, type AuditRecord } from '@challengeforge/db'
import { db } from '@/server/db'
import { requirePageRole } from '@/server/guards'

export const metadata = { title: 'Audit log' }

const LABELS: Record<AuditRecord['action'], string> = {
  'role.changed': 'Changed a role',
  'challenge.published': 'Published a challenge',
  'challenge.archived': 'Archived a challenge',
  'assessment.overridden': 'Overrode a result',
  'pack.imported': 'Imported a pack',
  'account.password_reset': 'Reset their password',
  'collaborator.added': 'Added a co-author',
  'collaborator.removed': 'Removed a co-author',
  'org.created': 'Created an organisation',
  'org.member_set': 'Set an organisation role',
  'org.member_removed': 'Removed someone from an organisation',
  'cohort.created': 'Created a cohort',
  'cohort.updated': 'Changed a cohort',
  'cohort.member_removed': 'Removed someone from a cohort',
  'pack.access_set': 'Changed who can play a pack',
  'access.granted': 'Gave access to a pack',
  'access.revoked': 'Took away access to a pack',
  'product.saved': 'Set a price',
  'payment.paid': 'Payment received',
  'payment.refunded': 'Payment refunded',
  'payment.rejected': 'Payment rejected (amount mismatch)',
  'certificates.set': 'Turned certificates on or off',
  'certificate.revoked': 'Revoked a certificate',
  'lti.platform_saved': 'Registered or enabled an LMS',
  'lti.platform_removed': 'Disabled an LMS',
  'site.settings_saved': 'Changed site settings',
  'site.created': 'Created this site',
  'site.domain_added': 'Added a domain',
}

/** Details as short "key: value" pairs; values are shown as text, never as markup. */
function describe(details: Record<string, unknown>): string {
  return Object.entries(details)
    .map(([k, v]) => `${k}: ${Array.isArray(v) ? v.length : typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v)}`)
    .join(' · ')
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ before?: string }> }) {
  const scope = await requirePageRole('admin', '/admin/audit')
  const { before } = await searchParams
  const beforeDate = before && !Number.isNaN(Date.parse(before)) ? new Date(before) : undefined
  const entries = await listAudit(db(), scope, beforeDate ? { before: beforeDate } : {})
  const last = entries.at(-1)
  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow"><Link href="/admin" className="hover:underline">Admin</Link></p>
        <h1 className="text-4xl">Audit log</h1>
        <p className="text-ink-muted">Who changed what, newest first.</p>
      </header>
      {entries.length === 0 ? (
        <p className="text-ink-muted">Nothing recorded{beforeDate ? ' before this point' : ' yet'}.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {entries.map((e) => (
            <li key={e.id} className="space-y-1 px-4 py-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-semibold">{e.actorName ?? e.actorId}</span>
                <span>{LABELS[e.action] ?? e.action}</span>
                <span className="text-sm text-ink-muted">
                  {e.targetType} {e.targetId.slice(0, 8)}
                </span>
                <time className="ml-auto text-sm text-ink-muted" dateTime={e.at.toISOString()}>{e.at.toISOString().replace('T', ' ').slice(0, 19)} UTC</time>
              </div>
              {Object.keys(e.details).length > 0 && <p className="text-sm text-ink-muted">{describe(e.details)}</p>}
            </li>
          ))}
        </ul>
      )}
      {last && entries.length >= 100 && (
        <Link className="btn-secondary" href={`/admin/audit?before=${encodeURIComponent(last.at.toISOString())}`}>Older entries</Link>
      )}
    </div>
  )
}
