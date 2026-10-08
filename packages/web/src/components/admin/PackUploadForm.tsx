'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'

interface Report {
  created: string[]
  updated: string[]
  unchanged: string[]
  skipped: string[]
  published: string[]
}

/** Uploads a pack .zip (multipart) and shows what the import did. */
export function PackUploadForm() {
  const router = useRouter()
  const [error, setError] = useState<string | null>(null)
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError(null)
    setReport(null)
    try {
      const res = await fetch('/api/admin/packs/upload', { method: 'POST', body: new FormData(event.currentTarget) })
      const json = (await res.json().catch(() => null)) as { success?: boolean; data?: Report; error?: { message?: string; issues?: { path: string; message: string }[] } } | null
      if (!json?.success || !json.data) {
        const first = json?.error?.issues?.[0]
        setError(`${json?.error?.message ?? `The upload failed (${res.status}).`}${first ? ` (${first.path}: ${first.message})` : ''}`)
      } else {
        setReport(json.data)
        router.refresh()
      }
    } catch {
      setError('Could not reach the server.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <form onSubmit={onSubmit} className="flex flex-wrap items-end gap-3">
        <div>
          <label className="field-label" htmlFor="pack">Pack (.zip, up to 32 MB)</label>
          <input id="pack" name="pack" type="file" accept=".zip,application/zip" required className="text-sm" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="publish" value="yes" /> Publish right away
        </label>
        <button type="submit" className="btn-secondary" disabled={busy}>{busy ? 'Importing…' : 'Import pack'}</button>
      </form>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      {report && (
        <p role="status" className="text-sm">
          Imported: {report.created.length} new, {report.updated.length} updated (as drafts), {report.unchanged.length} unchanged
          {report.skipped.length > 0 ? `, ${report.skipped.length} skipped` : ''}{report.published.length > 0 ? `, ${report.published.length} published` : ''}.
        </p>
      )}
    </div>
  )
}
