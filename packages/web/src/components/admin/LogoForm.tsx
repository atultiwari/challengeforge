'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

/** Uploads or removes the site logo (multipart; the JSON helper does not send files). */
export function LogoForm({ hasLogo }: { hasLogo: boolean }) {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function send(form: FormData) {
    setBusy(true)
    setError(null)
    try {
      const res = await fetch('/api/admin/site/logo', { method: 'POST', body: form })
      const json = (await res.json().catch(() => null)) as { success?: boolean; error?: { message?: string } } | null
      if (!json?.success) setError(json?.error?.message ?? `The upload failed (${res.status}).`)
      else router.refresh()
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <form action={send} className="flex flex-wrap items-end gap-3">
        <div>
          <label className="field-label" htmlFor="logo">Logo (PNG, JPEG or WebP, under 512 KB)</label>
          <input id="logo" name="logo" type="file" accept="image/png,image/jpeg,image/webp" required className="text-sm" />
        </div>
        <button type="submit" className="btn-secondary" disabled={busy}>Upload logo</button>
      </form>
      {hasLogo && (
        <form action={send}>
          <button type="submit" className="btn-secondary" disabled={busy}>Remove logo</button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  )
}
