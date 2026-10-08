import Link from 'next/link'
import { hasRole, isTeacher } from '@challengeforge/db'
import { db } from '@/server/db'
import { currentScope } from '@/server/scope'
import { currentSettings } from '@/server/site-settings'
import { SignOutButton } from './SignOutButton'

export async function SiteHeader() {
  const [settings, { scope, user }] = await Promise.all([currentSettings(), currentScope()])
  const teaches = user ? await isTeacher(db(), scope) : false
  return (
    <header className="border-b border-line bg-surface">
      <nav aria-label="Main" className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-serif text-xl font-semibold text-ink">
          {/* eslint-disable-next-line @next/next/no-img-element -- a small, site-uploaded logo; no optimisation pipeline needed */}
          {settings.hasLogo && <img src="/site-files/logo" alt="" className="h-8 w-auto" />}
          {settings.name}
        </Link>
        <Link href="/" className="text-sm hover:underline">Challenges</Link>
        {hasRole(scope, 'author') && <Link href="/author" className="text-sm hover:underline">Author</Link>}
        {teaches && <Link href="/teach" className="text-sm hover:underline">Teach</Link>}
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
              {settings.signupsOpen && <Link href="/sign-up" className="btn-primary">Create account</Link>}
            </>
          )}
        </div>
      </nav>
    </header>
  )
}
