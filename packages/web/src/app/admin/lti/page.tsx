import Link from 'next/link'
import { listPlatforms } from '@challengeforge/db'
import { PostButton } from '@/components/common/PostButton'
import { SimpleForm } from '@/components/common/SimpleForm'
import { db } from '@/server/db'
import { env } from '@/server/env'
import { requirePageRole } from '@/server/guards'

export const metadata = { title: 'LMS (LTI 1.3)' }

export default async function LtiAdminPage() {
  const scope = await requirePageRole('admin', '/admin/lti')
  const platforms = await listPlatforms(db(), scope)
  const app = env().APP_URL
  const toolUrls: [string, string][] = [
    ['Login (initiate login) URL', `${app}/lti/login`],
    ['Redirect / launch URL', `${app}/lti/launch`],
    ['Deep linking URL', `${app}/lti/launch`],
    ['Public keyset (JWKS) URL', `${app}/lti/jwks`],
  ]
  return (
    <div className="space-y-10">
      <header>
        <p className="eyebrow"><Link href="/admin" className="hover:underline">Admin</Link></p>
        <h1 className="text-4xl">LMS (LTI 1.3)</h1>
        <p className="text-ink-muted">Let Moodle, Canvas, Blackboard or Brightspace open challenges inside a course and receive grades.</p>
      </header>

      <section className="card space-y-3" aria-labelledby="tool-config">
        <h2 id="tool-config" className="text-xl">1. Register this site in your LMS as an external tool</h2>
        <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[auto_1fr]">
          {toolUrls.map(([label, url]) => (
            <div key={label} className="contents">
              <dt className="font-medium">{label}</dt>
              <dd className="break-all font-mono">{url}</dd>
            </div>
          ))}
        </dl>
        <p className="text-sm text-ink-muted">
          Turn on the Assignment and Grade Services (scores) and Deep Linking. Set the tool to <strong>open in a new window</strong>:
          this site does not run inside frames, and browsers block the cookies a framed tool needs.
        </p>
      </section>

      <section className="space-y-3" aria-labelledby="registered">
        <h2 id="registered" className="text-xl">2. Registered platforms</h2>
        {platforms.length === 0 ? (
          <p className="text-ink-muted">None yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
            {platforms.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <span className="mr-auto">
                  <span className="font-semibold">{p.name}</span>{' '}
                  <span className="text-sm text-ink-muted">{p.issuer} · client {p.clientId} · {p.deploymentIds.length} deployment{p.deploymentIds.length === 1 ? '' : 's'}</span>
                </span>
                <span className={`pill ${p.active ? 'bg-good-soft text-good' : 'bg-surface-sunken text-ink-muted'}`}>{p.active ? 'active' : 'off'}</span>
                <PostButton
                  url={`/api/admin/lti/platforms/${p.id}`}
                  body={{ grantsAccess: !p.grantsAccess }}
                  label={p.grantsAccess ? 'Placements open restricted packs (stop)' : 'Let placements open restricted packs'}
                  {...(p.grantsAccess ? {} : { confirm: 'Any teacher on this LMS will be able to give their class access to restricted (including paid) packs. Continue?' })}
                />
                <PostButton url={`/api/admin/lti/platforms/${p.id}`} body={{ active: !p.active }} label={p.active ? 'Turn off' : 'Turn on'} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card max-w-2xl space-y-3" aria-labelledby="add-platform">
        <h2 id="add-platform" className="text-xl">3. Add the platform details your LMS shows you</h2>
        <SimpleForm
          url="/api/admin/lti/platforms"
          submitLabel="Save platform"
          fields={[
            { name: 'name', label: 'Name', type: 'text', required: true, help: 'e.g. "University Moodle"' },
            { name: 'issuer', label: 'Platform ID / issuer', type: 'text', required: true, maxLength: 255 },
            { name: 'clientId', label: 'Client ID', type: 'text', required: true, maxLength: 255 },
            { name: 'deploymentIds', label: 'Deployment ID(s)', type: 'text', required: true, maxLength: 2000, help: 'Separate several with commas.' },
            { name: 'authLoginUrl', label: 'Authentication request URL', type: 'text', required: true, maxLength: 500 },
            { name: 'authTokenUrl', label: 'Access token URL', type: 'text', required: true, maxLength: 500 },
            { name: 'jwksUrl', label: 'Public keyset URL', type: 'text', required: true, maxLength: 500 },
          ]}
        />
      </section>
    </div>
  )
}
