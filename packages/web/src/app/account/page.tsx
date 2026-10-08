import { getMailPreferences } from '@challengeforge/db'
import { PostButton } from '@/components/common/PostButton'
import { db } from '@/server/db'
import { requirePageRole } from '@/server/guards'
import { mailer } from '@/server/mail'
import { currentScope } from '@/server/scope'

export const metadata = { title: 'Your account' }

export default async function AccountPage() {
  const scope = await requirePageRole('learner', '/account')
  const [{ user }, prefs] = await Promise.all([currentScope(), getMailPreferences(db(), scope)])
  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow">Account</p>
        <h1 className="text-4xl">{user?.name}</h1>
        <p className="text-ink-muted">{user?.email.endsWith('@lti.invalid') ? 'Signed in through your course (LMS).' : user?.email}</p>
      </header>
      {mailer().enabled && (
        <section className="card max-w-xl space-y-3" aria-labelledby="email-prefs">
          <h2 id="email-prefs" className="text-xl">Emails</h2>
          <p className="text-sm">
            Update emails (certificates, reviewed results, cohorts you join) are <strong>{prefs.updates ? 'on' : 'off'}</strong>. Password and sign-in emails are always sent.
          </p>
          <PostButton url="/api/account/mail" body={{ updates: !prefs.updates }} label={prefs.updates ? 'Turn update emails off' : 'Turn update emails on'} />
        </section>
      )}
    </div>
  )
}
