'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { authClient } from '@/lib/auth-client'

/** Only same-site relative paths are followed after sign-in (no open redirects). */
function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}

export function AuthForm({ mode, next }: { mode: 'sign-in' | 'sign-up'; next: string | null }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(form: FormData) {
    setBusy(true)
    setError(null)
    const email = String(form.get('email') ?? '').trim()
    const password = String(form.get('password') ?? '')
    const result =
      mode === 'sign-up'
        ? await authClient.signUp.email({ email, password, name: String(form.get('name') ?? '').trim() || email })
        : await authClient.signIn.email({ email, password })
    setBusy(false)
    if (result.error) {
      setError(result.error.message ?? 'That did not work. Check your details and try again.')
      return
    }
    router.push(safeNext(next))
    router.refresh()
  }

  return (
    <form action={onSubmit} className="card mx-auto max-w-md space-y-4">
      {mode === 'sign-up' && (
        <div>
          <label className="field-label" htmlFor="name">Your name</label>
          <input className="field-input" id="name" name="name" autoComplete="name" maxLength={100} required />
        </div>
      )}
      <div>
        <label className="field-label" htmlFor="email">Email</label>
        <input className="field-input" id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div>
        <label className="field-label" htmlFor="password">Password</label>
        <input
          className="field-input"
          id="password"
          name="password"
          type="password"
          minLength={10}
          maxLength={128}
          autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
          required
        />
        {mode === 'sign-up' && <p className="field-help">At least 10 characters.</p>}
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={busy}>
        {busy ? 'Please wait…' : mode === 'sign-up' ? 'Create account' : 'Sign in'}
      </button>
    </form>
  )
}
