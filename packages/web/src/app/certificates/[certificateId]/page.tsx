import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { verifyCertificate } from '@challengeforge/db'
import { PrintButton } from '@/components/certificates/PrintButton'
import { db } from '@/server/db'
import { currentSiteContext } from '@/server/site'
import { currentSite } from '@/server/scope'

// Holding the link is what lets someone verify; keep certificates out of search engines.
export const metadata: Metadata = { title: 'Certificate', robots: { index: false, follow: false } }

const longDate = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })

/** Public: anyone with the link sees the certificate and whether it is still valid. */
export default async function CertificatePage({ params }: { params: Promise<{ certificateId: string }> }) {
  const { certificateId } = await params
  const site = await currentSite()
  const cert = await verifyCertificate(db(), site.id, certificateId)
  if (!cert) notFound()
  const url = `${(await currentSiteContext()).baseUrl}/certificates/${cert.id}`
  return (
    <div className="space-y-6">
      {cert.revokedAt ? (
        <p role="alert" className="rounded-md bg-danger-soft px-4 py-3 text-danger">
          <strong>Revoked</strong> on {longDate(cert.revokedAt)}: {cert.revokeReason}
        </p>
      ) : (
        <p role="status" className="rounded-md bg-good-soft px-4 py-3 text-good print:hidden">
          <strong>Valid.</strong> This certificate was issued by {cert.siteName} and has not been revoked.
        </p>
      )}
      <article className="mx-auto max-w-3xl border-4 border-double border-line bg-surface px-8 py-14 text-center shadow-sm print:border-black print:shadow-none">
        <p className="eyebrow">{cert.siteName}</p>
        <h1 className="mt-4 font-serif text-4xl">Certificate of completion</h1>
        <p className="mt-10 text-ink-muted">This certifies that</p>
        <p className="mt-2 font-serif text-4xl">{cert.recipientName}</p>
        <p className="mt-6 text-ink-muted">completed every challenge ({cert.challengeCount}) in</p>
        <p className="mt-2 text-2xl font-semibold">{cert.packTitle}</p>
        <p className="mt-10">{longDate(cert.issuedAt)}</p>
        <p className="mt-8 break-all font-mono text-xs text-ink-muted">Verify at {url}</p>
      </article>
      <div className="text-center"><PrintButton /></div>
    </div>
  )
}
