'use client'
import { useState } from 'react'
import type { Role } from '@challengeforge/db'
import { postJson } from '@/lib/api'

export function RoleSelect({ userId, role, isSelf }: { userId: string; role: Role; isSelf: boolean }) {
  const [value, setValue] = useState(role)
  const [error, setError] = useState<string | null>(null)
  return (
    <span className="inline-flex items-center gap-2">
      <select
        className="field-input w-auto min-h-9 py-1"
        value={value}
        disabled={isSelf}
        aria-label="Role"
        onChange={async (e) => {
          const next = e.target.value as Role
          const r = await postJson(`/api/admin/members/${userId}`, { role: next })
          if (r.ok) {
            setValue(next)
            setError(null)
          } else setError(r.error.message)
        }}
      >
        <option value="learner">Learner</option>
        <option value="author">Author</option>
        <option value="admin">Admin</option>
      </select>
      {error && <span role="alert" className="text-xs text-danger">{error}</span>}
    </span>
  )
}
