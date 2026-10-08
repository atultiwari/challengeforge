'use client'
import { useState } from 'react'
import { authClient } from '@/lib/auth-client'

/** Always answers the same way, so the form never reveals whether an account exists. */
export function ForgotPasswordForm() {
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // onSubmit, not <form action>: React would reset the fields even when the server refuses.
  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setBusy(true)
    setError(null)
    const result = await authClient.requestPasswordReset({ email: String(form.get('email') ?? '').trim(), redirectTo: '/reset-password' })
    setBusy(false)
    // Only a refusal of the request itself (rate limit, bad origin) is shown; "no such account" never is.
    if (result.error && (result.error.status === 429 || result.error.status === 403)) {
      setError(result.error.message ?? 'Please wait a minute and try again.')
      return
    }
    setSent(true)
  }

  if (sent) {
    return (
      <div role="status" className="card mx-auto max-w-md space-y-2">
        <p className="font-medium">Check your email.</p>
        <p className="text-sm">If an account uses that address, we sent it a link to choose a new password. The link works for one hour.</p>
      </div>
    )
  }
  return (
    <form onSubmit={onSubmit} className="card mx-auto max-w-md space-y-4">
      <div>
        <label className="field-label" htmlFor="email">Email</label>
        <input className="field-input" id="email" name="email" type="email" autoComplete="email" required />
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? 'Please wait…' : 'Send me a reset link'}</button>
    </form>
  )
}
