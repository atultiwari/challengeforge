'use client'
import Link from 'next/link'
import { useState } from 'react'
import { authClient } from '@/lib/auth-client'

const MIN_LENGTH = 10

export function ResetPasswordForm({ token }: { token: string }) {
  const [done, setDone] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // onSubmit, not <form action>: React would reset the fields even when the server refuses.
  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const password = String(form.get('password') ?? '')
    if (password !== String(form.get('confirm') ?? '')) {
      setError('The two passwords do not match.')
      return
    }
    setBusy(true)
    setError(null)
    const result = await authClient.resetPassword({ newPassword: password, token })
    setBusy(false)
    if (result.error) {
      setError(result.error.status === 400 ? 'This link has expired or was already used. Ask for a new one.' : (result.error.message ?? 'That did not work. Try again.'))
      return
    }
    setDone(true)
  }

  if (done) {
    return (
      <div role="status" className="card mx-auto max-w-md space-y-2">
        <p className="font-medium">Your password has been changed.</p>
        <p className="text-sm">You have been signed out everywhere. <Link className="underline" href="/sign-in">Sign in</Link> with the new password.</p>
      </div>
    )
  }
  return (
    <form onSubmit={onSubmit} className="card mx-auto max-w-md space-y-4">
      <div>
        <label className="field-label" htmlFor="password">New password</label>
        <input className="field-input" id="password" name="password" type="password" minLength={MIN_LENGTH} maxLength={128} autoComplete="new-password" required />
        <p className="field-help">At least {MIN_LENGTH} characters.</p>
      </div>
      <div>
        <label className="field-label" htmlFor="confirm">Type it again</label>
        <input className="field-input" id="confirm" name="confirm" type="password" minLength={MIN_LENGTH} maxLength={128} autoComplete="new-password" required />
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="submit" className="btn-primary w-full" disabled={busy}>{busy ? 'Please wait…' : 'Change password'}</button>
    </form>
  )
}
