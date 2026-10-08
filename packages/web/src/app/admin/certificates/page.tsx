import Link from 'next/link'
import { listCertificates } from '@challengeforge/db'
import { SimpleForm } from '@/components/common/SimpleForm'
import { db } from '@/server/db'
import { requirePageRole } from '@/server/guards'

export const metadata = { title: 'Certificates' }

export default async function CertificatesAdminPage() {
  const scope = await requirePageRole('admin', '/admin/certificates')
  const certificates = await listCertificates(db(), scope)
  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow"><Link href="/admin" className="hover:underline">Admin</Link></p>
        <h1 className="text-4xl">Certificates</h1>
        <p className="text-ink-muted">Turn certificates on for a pack in Access and payments. Revoking shows the reason on the public verify page.</p>
      </header>
      {certificates.length === 0 ? (
        <p className="text-ink-muted">None issued yet.</p>
      ) : (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {certificates.map((c) => (
            <li key={c.id} className="space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-3">
                <Link href={`/certificates/${c.id}`} className="mr-auto font-semibold hover:underline">{c.recipientName} · {c.packTitle}</Link>
                <span className="text-sm text-ink-muted">{c.issuedAt.toISOString().slice(0, 10)}</span>
                {c.revokedAt && <span className="pill bg-danger-soft text-danger">revoked</span>}
              </div>
              {!c.revokedAt && (
                <details>
                  <summary className="cursor-pointer text-sm">Revoke…</summary>
                  <SimpleForm url={`/api/admin/certificates/${c.id}/revoke`} submitLabel="Revoke certificate" inline fields={[{ name: 'reason', label: 'Reason (shown publicly)', type: 'text', required: true, maxLength: 500 }]} />
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
