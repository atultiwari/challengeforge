'use client'
import { useState } from 'react'
import type { Collaborator } from '@challengeforge/db'
import { postJson } from '@/lib/api'

interface Props {
  challengeId: string
  initial: readonly Collaborator[]
  /** The creator and editors manage co-authors; co-authors only see the list. */
  canManage: boolean
}

export function CollaboratorsPanel({ challengeId, initial, canManage }: Props) {
  const [people, setPeople] = useState<readonly Collaborator[]>(initial)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const base = `/api/author/challenges/${challengeId}/collaborators`

  // onSubmit, not <form action>: React would reset the fields even when the server refuses.
  async function add(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const element = event.currentTarget
    const form = new FormData(element)
    setBusy(true)
    setError(null)
    const r = await postJson<Collaborator>(base, { email: String(form.get('email') ?? '').trim() })
    setBusy(false)
    if (!r.ok) return setError(r.error.message)
    setPeople((list) => (list.some((p) => p.userId === r.data.userId) ? list : [...list, r.data]))
    element.reset()
  }

  async function remove(userId: string) {
    setError(null)
    const r = await postJson(`${base}/remove`, { userId })
    if (!r.ok) return setError(r.error.message)
    setPeople((list) => list.filter((p) => p.userId !== userId))
  }

  return (
    <details className="card space-y-3">
      <summary className="cursor-pointer font-semibold">Co-authors ({people.length})</summary>
      <p className="text-sm text-ink-muted">Co-authors can edit this challenge. Publishing stays with editors and admins.</p>
      {people.length > 0 && (
        <ul className="divide-y divide-line">
          {people.map((p) => (
            <li key={p.userId} className="flex items-center gap-3 py-2">
              <span className="mr-auto">{p.name} <span className="text-sm text-ink-muted">{p.email}</span></span>
              {canManage && (
                <button type="button" className="btn-secondary" onClick={() => remove(p.userId)}>Remove</button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canManage && (
        <form onSubmit={add} className="flex flex-wrap items-end gap-2">
          <div className="grow">
            <label className="field-label" htmlFor="coauthor-email">Add a co-author by email</label>
            <input className="field-input" id="coauthor-email" name="email" type="email" required maxLength={254} />
          </div>
          <button type="submit" className="btn-secondary" disabled={busy}>Add co-author</button>
        </form>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </details>
  )
}
