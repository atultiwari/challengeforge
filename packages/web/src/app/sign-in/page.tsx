import Link from 'next/link'
import { AuthForm } from '@/components/auth/AuthForm'

export const metadata = { title: 'Sign in' }

export default async function SignInPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  return (
    <div className="space-y-6">
      <h1 className="text-center text-3xl">Sign in</h1>
      <AuthForm mode="sign-in" next={next ?? null} />
      <p className="text-center text-sm">
        New here? <Link className="underline" href={`/sign-up${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Create an account</Link>
      </p>
    </div>
  )
}
