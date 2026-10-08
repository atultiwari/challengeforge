import Link from 'next/link'
import { ResetPasswordForm } from '@/components/auth/ResetPasswordForm'

export const metadata = { title: 'Choose a new password' }

/** Better Auth redirects here with ?token=… (or ?error=INVALID_TOKEN for a bad or used link). */
export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  const { token, error } = await searchParams
  const usable = typeof token === 'string' && /^[A-Za-z0-9_-]{8,200}$/.test(token) && !error
  return (
    <div className="space-y-6">
      <h1 className="text-center text-3xl">Choose a new password</h1>
      {usable ? (
        <ResetPasswordForm token={token} />
      ) : (
        <p role="alert" className="card mx-auto max-w-md text-sm">
          This link has expired or was already used. <Link className="underline" href="/forgot-password">Ask for a new one</Link>.
        </p>
      )}
    </div>
  )
}
