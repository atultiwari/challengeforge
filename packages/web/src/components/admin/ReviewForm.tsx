'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { postJson } from '@/lib/api'

export function ReviewForm({ attemptId, passed, points }: { attemptId: string; passed: boolean; points: number }) {
  const router = useRouter()
  const [verdict, setVerdict] = useState(passed)
  const [value, setValue] = useState(String(points))
  const [error, setError] = useState<string | null>(null)
  return (
    <form
      className="card space-y-3"
      onSubmit={async (e) => {
        e.preventDefault()
        const r = await postJson(`/api/admin/reviews/${attemptId}`, { passed: verdict, points: Number(value) })
        if (!r.ok) return setError(r.error.message)
        router.push('/admin')
        router.refresh()
      }}
    >
      <h2 className="text-xl">Your decision</h2>
      <div className="flex gap-4">
        <label className="flex items-center gap-2"><input type="radio" checked={verdict} onChange={() => setVerdict(true)} /> Pass</label>
        <label className="flex items-center gap-2"><input type="radio" checked={!verdict} onChange={() => setVerdict(false)} /> Fail</label>
      </div>
      <label className="block max-w-xs">
        <span className="field-label">Points</span>
        <input className="field-input" inputMode="numeric" value={value} disabled={!verdict} onChange={(e) => setValue(e.target.value)} />
      </label>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <button type="submit" className="btn-primary">Save decision</button>
    </form>
  )
}
