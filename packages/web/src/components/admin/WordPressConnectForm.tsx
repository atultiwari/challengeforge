'use client'
import { useState } from 'react'
import { postJson } from '@/lib/api'

/** Connects a WordPress site and shows the new secret once, to paste into the plugin. */
export function WordPressConnectForm({ current }: { current: string | null }) {
  const [secret, setSecret] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <div className="space-y-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          setBusy(true)
          setError(null)
          const r = await postJson<{ secret: string }>('/api/admin/wordpress', { wpUrl: String(new FormData(e.currentTarget).get('wpUrl') ?? '').trim() })
          setBusy(false)
          if (!r.ok) return setError(r.error.message)
          setSecret(r.data.secret)
        }}
      >
        <div className="min-w-64 grow">
          <label className="field-label" htmlFor="wpUrl">WordPress site address</label>
          <input className="field-input" id="wpUrl" name="wpUrl" type="url" required maxLength={500} defaultValue={current ?? ''} placeholder="https://blog.example.org" />
        </div>
        <button type="submit" className="btn-secondary" disabled={busy}>{current ? 'Connect again (new secret)' : 'Connect'}</button>
      </form>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {secret && (
        <div role="status" className="space-y-1 rounded-md bg-warn-soft p-3 text-sm text-warn">
          <p className="font-semibold">Copy this secret into WordPress → Settings → ChallengeForge now. It is not shown again.</p>
          <p className="break-all font-mono" data-testid="wp-secret">{secret}</p>
        </div>
      )}
    </div>
  )
}
