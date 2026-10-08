'use client'
import { useState } from 'react'
import { postJson } from '@/lib/api'

/** Starts checkout and sends the buyer to the provider's hosted page. */
export function BuyButton({ productId, label }: { productId: string; label: string }) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        className="btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true)
          setError(null)
          const r = await postJson<{ redirectUrl: string }>('/api/payments/checkout', { productId })
          if (!r.ok) {
            setBusy(false)
            return setError(r.error.message)
          }
          window.location.assign(r.data.redirectUrl)
        }}
      >
        {busy ? 'Opening checkout…' : label}
      </button>
      {error && <span role="alert" className="text-sm text-danger">{error}</span>}
    </span>
  )
}
