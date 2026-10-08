import Link from 'next/link'
import { redirect } from 'next/navigation'
import { currentScope } from '@/server/scope'
import { AuthForm } from '@/components/auth/AuthForm'
import { mailer } from '@/server/mail'

export const metadata = { title: 'Sign in' }

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  // Already signed in: nothing to do here.
  if ((await currentScope()).user) redirect('/')
  return (
    <div className="space-y-6">
      <h1 className="text-center text-3xl">Sign in</h1>
      <AuthForm mode="sign-in" next={next ?? null} />
      {mailer().enabled && (
        <p className="text-center text-sm"><Link className="underline" href="/forgot-password">Forgot your password?</Link></p>
      )}
      <p className="text-center text-sm">
        New here? <Link className="underline" href={`/sign-up${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Create an account</Link>
      </p>
    </div>
  )
}
