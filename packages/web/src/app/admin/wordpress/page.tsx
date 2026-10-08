import Link from 'next/link'
import { getWpConnection } from '@challengeforge/db'
import { WordPressConnectForm } from '@/components/admin/WordPressConnectForm'
import { PostButton } from '@/components/common/PostButton'
import { db } from '@/server/db'
import { requirePageRole } from '@/server/guards'

export const metadata = { title: 'WordPress' }

export default async function WordPressPage() {
  const scope = await requirePageRole('admin', '/admin/wordpress')
  const connection = await getWpConnection(db(), scope)
  return (
    <div className="space-y-8">
      <header>
        <p className="eyebrow"><Link href="/admin" className="hover:underline">Admin</Link></p>
        <h1 className="text-4xl">WordPress</h1>
        <p className="text-ink-muted">
          With the ChallengeForge plugin (in this project&apos;s <code>integrations/wordpress</code> folder), WordPress pages link to challenges with
          a shortcode, and signed-in WordPress members arrive here signed in as their own linked account.
        </p>
      </header>
      <section className="card max-w-2xl space-y-3" aria-labelledby="wp-connect">
        <h2 id="wp-connect" className="text-xl">Connection</h2>
        {connection && (
          <p className="text-sm">
            Connected to <span className="font-mono">{connection.wpUrl}</span> · {connection.enabled ? 'sign-in on' : 'sign-in paused'}{' '}
            <PostButton url="/api/admin/wordpress" body={{ enabled: !connection.enabled }} label={connection.enabled ? 'Pause sign-in' : 'Resume sign-in'} />
          </p>
        )}
        <p className="text-sm text-ink-muted">Use the address exactly as WordPress shows it under Settings → General → Site Address. Connecting again makes a new secret and the old one stops working.</p>
        <WordPressConnectForm current={connection?.wpUrl ?? null} />
      </section>
    </div>
  )
}
