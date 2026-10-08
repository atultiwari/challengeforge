'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { postJson } from '@/lib/api'

interface Props {
  url: string
  body: Record<string, unknown>
  label: string
  /** Asked before an action that is hard to undo. */
  confirm?: string
  variant?: 'primary' | 'secondary'
}

/** One button, one POST, then a refresh of the page. */
export function PostButton({ url, body, label, confirm, variant = 'secondary' }: Props) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        className={variant === 'primary' ? 'btn-primary' : 'btn-secondary'}
        disabled={busy}
        onClick={async () => {
          if (confirm && !window.confirm(confirm)) return
          setBusy(true)
          setError(null)
          const r = await postJson(url, body)
          setBusy(false)
          if (!r.ok) return setError(r.error.message)
          router.refresh()
        }}
      >
        {label}
      </button>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </span>
  )
}
