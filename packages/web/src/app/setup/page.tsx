import { notFound } from 'next/navigation'
import { needsSetup } from '@challengeforge/db'
import { SimpleForm } from '@/components/common/SimpleForm'
import { db } from '@/server/db'
import { currentSite } from '@/server/scope'
import { PRESETS } from '@/lib/themes'

export const metadata = { title: 'Set up your site', robots: { index: false } }

/** First run only: once the site has an admin, this page no longer exists. */
export default async function SetupPage() {
  const site = await currentSite()
  if (!(await needsSetup(db(), site.id))) notFound()
  return (
    <div className="mx-auto max-w-xl space-y-6">
      <header className="space-y-2">
        <p className="eyebrow">Welcome</p>
        <h1 className="text-4xl">Set up your site</h1>
        <p className="text-ink-muted">
          Create the administrator account. You need the setup token: the <code>SETUP_TOKEN</code> you set in your hosting panel, or one printed by{' '}
          <code>node cli.mjs setup-token</code>.
        </p>
      </header>
      <div className="card">
        <SimpleForm
          url="/api/setup"
          submitLabel="Create my site"
          then={{ goTo: '/admin' }}
          fields={[
            { name: 'token', label: 'Setup token', type: 'password', required: true, maxLength: 200, autoComplete: 'off' },
            { name: 'siteName', label: 'Site name', type: 'text', required: true, maxLength: 100, value: site.name },
            { name: 'preset', label: 'Look', type: 'select', value: 'case-file', options: Object.entries(PRESETS).map(([id, p]) => [id, p.label] as const) },
            { name: 'name', label: 'Your name', type: 'text', required: true, maxLength: 100, autoComplete: 'name' },
            { name: 'email', label: 'Your email', type: 'email', required: true, maxLength: 254, autoComplete: 'email' },
            { name: 'password', label: 'Password (at least 10 characters)', type: 'password', required: true, minLength: 10, maxLength: 128, autoComplete: 'new-password' },
          ]}
        />
      </div>
    </div>
  )
}
