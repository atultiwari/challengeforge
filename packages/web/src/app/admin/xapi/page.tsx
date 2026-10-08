import Link from 'next/link'
import { getLrsEndpoint } from '@challengeforge/db'
import { PostButton } from '@/components/common/PostButton'
import { SimpleForm } from '@/components/common/SimpleForm'
import { db } from '@/server/db'
import { requirePageRole } from '@/server/guards'

export const metadata = { title: 'Learning records (xAPI)' }

const when = (d: Date | null) => (d ? `${d.toISOString().slice(0, 16).replace('T', ' ')} UTC` : 'never')

export default async function XapiPage() {
  const scope = await requirePageRole('admin', '/admin/xapi')
  const lrs = await getLrsEndpoint(db(), scope)
  return (
    <div className="space-y-10">
      <header>
        <p className="eyebrow"><Link href="/admin" className="hover:underline">Admin</Link></p>
        <h1 className="text-4xl">Learning records (xAPI)</h1>
        <p className="text-ink-muted">
          Attempts and results as xAPI 1.0.3 statements, for your institution&apos;s Learning Record Store or analytics. Learners are identified by
          account, never by email; results waiting for review are included once decided.
        </p>
      </header>
      <section className="card max-w-2xl space-y-3" aria-labelledby="export">
        <h2 id="export" className="text-xl">Export</h2>
        <a className="btn-secondary" href="/api/admin/xapi">Download all statements (.json)</a>
        <p className="text-sm text-ink-muted">Instructors can download their own cohort&apos;s statements from the cohort page.</p>
      </section>
      <section className="card max-w-2xl space-y-3" aria-labelledby="lrs">
        <h2 id="lrs" className="text-xl">Send to a Learning Record Store</h2>
        {lrs && (
          <div className="space-y-2 text-sm">
            <p>
              Connected to <span className="font-mono">{lrs.endpoint}</span> · {lrs.enabled ? 'sending' : 'paused'} · last sent {when(lrs.lastSentAt)}
            </p>
            {lrs.lastError && <p role="alert" className="text-danger">Last attempt failed: {lrs.lastError}</p>}
            <PostButton url="/api/admin/xapi/lrs" body={{ enabled: !lrs.enabled }} label={lrs.enabled ? 'Pause sending' : 'Resume sending'} />
          </div>
        )}
        <p className="text-sm text-ink-muted">New statements are sent by the cron job every few minutes. Saving a connection sends everything again from the start (LRSs ignore statements they already have).</p>
        <SimpleForm
          url="/api/admin/xapi/lrs"
          submitLabel={lrs ? 'Replace connection' : 'Connect'}
          fields={[
            { name: 'endpoint', label: 'LRS endpoint', type: 'text', required: true, maxLength: 500, value: lrs?.endpoint ?? '', help: 'e.g. https://lrs.example.org/xapi/' },
            { name: 'username', label: 'Key', type: 'text', required: true, maxLength: 200, value: lrs?.username ?? '' },
            { name: 'secret', label: 'Secret', type: 'password', required: true, maxLength: 500, autoComplete: 'off' },
          ]}
        />
      </section>
    </div>
  )
}
