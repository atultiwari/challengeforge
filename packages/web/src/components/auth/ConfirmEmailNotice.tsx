'use client'
import { useState } from 'react'
import { authClient } from '@/lib/auth-client'

/** Asks a signed-in person to confirm their address (needed before teachers or admins can give them roles). */
export function ConfirmEmailNotice({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'sent' | 'error'>('idle')
  return (
    <div role="status" className="flex flex-wrap items-center gap-3 rounded-md bg-warn-soft px-4 py-3 text-sm text-warn">
      <span className="mr-auto">Please confirm your email address ({email}).</span>
      {state === 'sent' ? (
        <span>Check your inbox for the link.</span>
      ) : (
        <button
          type="button"
          className="btn-secondary"
          onClick={async () => {
            const r = await authClient.sendVerificationEmail({ email, callbackURL: '/' })
            setState(r.error ? 'error' : 'sent')
          }}
        >
          Send confirmation link
        </button>
      )}
      {state === 'error' && <span role="alert">That did not work. Try again in a minute.</span>}
    </div>
  )
}
