import Link from 'next/link'
import { hasRole } from '@challengeforge/db'
import { currentScope, currentSite } from '@/server/scope'
import { SignOutButton } from './SignOutButton'

export async function SiteHeader() {
  const [site, { scope, user }] = await Promise.all([currentSite(), currentScope()])
  return (
    <header className="border-b border-line bg-surface">
      <nav aria-label="Main" className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="font-serif text-xl font-semibold text-ink">
          {site.name}
        </Link>
        <Link href="/" className="text-sm hover:underline">Challenges</Link>
        {hasRole(scope, 'author') && <Link href="/author" className="text-sm hover:underline">Author</Link>}
        {hasRole(scope, 'editor') && <Link href="/admin" className="text-sm hover:underline">{hasRole(scope, 'admin') ? 'Admin' : 'Review'}</Link>}
        <div className="ml-auto flex items-center gap-4">
          {user ? (
            <>
              <span className="text-sm text-ink-muted">{user.name}</span>
              <SignOutButton />
            </>
          ) : (
            <>
              <Link href="/sign-in" className="text-sm hover:underline">Sign in</Link>
              <Link href="/sign-up" className="btn-primary">Create account</Link>
            </>
          )}
        </div>
      </nav>
    </header>
  )
}
