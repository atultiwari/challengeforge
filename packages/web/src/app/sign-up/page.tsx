import Link from 'next/link'
import { AuthForm } from '@/components/auth/AuthForm'

export const metadata = { title: 'Create an account' }

export default async function SignUpPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams
  return (
    <div className="space-y-6">
      <h1 className="text-center text-3xl">Create an account</h1>
      <AuthForm mode="sign-up" next={next ?? null} />
      <p className="text-center text-sm">
        Already have one? <Link className="underline" href={`/sign-in${next ? `?next=${encodeURIComponent(next)}` : ''}`}>Sign in</Link>
      </p>
    </div>
  )
}
