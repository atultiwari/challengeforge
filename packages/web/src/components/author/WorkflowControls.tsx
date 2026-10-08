'use client'
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import type { ChallengeStatus } from '@challengeforge/db'
import { postJson } from '@/lib/api'

const STATUS_TEXT: Record<ChallengeStatus, string> = {
  draft: 'Draft: only you and admins can see it.',
  in_review: 'In review: waiting for an admin to publish it.',
  published: 'Published: learners can play it.',
  archived: 'Archived.',
}

interface Props {
  challengeId: string
  status: ChallengeStatus
  version: number
  hasUnpublishedChanges: boolean
  canPublish: boolean
}

export function WorkflowControls({ challengeId, status, version, hasUnpublishedChanges, canPublish }: Props) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const run = async (action: 'submit' | 'publish' | 'archive') => {
    setBusy(true)
    setError(null)
    const r = await postJson(`/api/author/challenges/${challengeId}/status`, { action })
    setBusy(false)
    if (!r.ok) setError(r.error.message)
    else router.refresh()
  }
  return (
    <section className="card flex flex-wrap items-center gap-3">
      <p className="mr-auto text-sm">
        <span className="font-semibold">Version {version}.</span> {STATUS_TEXT[status]}
        {status === 'published' && hasUnpublishedChanges && ' Your latest edits are not live yet.'}
      </p>
      <Link className="btn-secondary" href={`/play/${challengeId}?preview=1`} target="_blank">Preview as learner</Link>
      {status === 'draft' && !canPublish && (
        <button type="button" className="btn-secondary" disabled={busy} onClick={() => run('submit')}>Send for review</button>
      )}
      {canPublish && status !== 'archived' && (status !== 'published' || hasUnpublishedChanges) && (
        <button type="button" className="btn-primary" disabled={busy} onClick={() => run('publish')}>Publish this version</button>
      )}
      {canPublish && status !== 'archived' && (
        <button type="button" className="text-sm text-danger" disabled={busy} onClick={() => run('archive')}>Archive</button>
      )}
      {error && <p role="alert" className="w-full text-sm text-danger">{error}</p>}
    </section>
  )
}
