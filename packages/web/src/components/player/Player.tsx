'use client'
import { useCallback, useState } from 'react'
import type { AttemptSnapshot } from '@challengeforge/db'
import type { LabLegacyView, QuestionSetView } from '@challengeforge/types'
import { postJson } from '@/lib/api'
import { AssessmentSummary } from './AssessmentSummary'
import { LabLegacyPlayer } from './LabLegacyPlayer'
import { QuestionSetPlayer } from './QuestionSetPlayer'

export type SendAction = (action: Record<string, unknown>) => Promise<boolean>

/**
 * Runs any challenge type: holds the attempt snapshot, sends actions (each
 * with a fresh idempotency key, so a retried request is never applied twice),
 * and hands the type's view to the matching player.
 */
export function Player({ challengeId, initial }: { challengeId: string; initial: AttemptSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const send: SendAction = useCallback(
    async (action) => {
      setBusy(true)
      setError(null)
      const result = await postJson<AttemptSnapshot>(`/api/attempts/${snapshot.attemptId}/actions`, {
        action,
        idempotencyKey: crypto.randomUUID(),
      })
      setBusy(false)
      if (!result.ok) {
        setError(result.error.message)
        return false
      }
      setSnapshot(result.data)
      return true
    },
    [snapshot.attemptId],
  )

  const restart = useCallback(async () => {
    setBusy(true)
    setError(null)
    const result = await postJson<AttemptSnapshot>(`/api/challenges/${challengeId}/attempt`, { preview: snapshot.isPreview })
    setBusy(false)
    if (result.ok) setSnapshot(result.data)
    else setError(result.error.message)
  }, [challengeId, snapshot.isPreview])

  const ended = snapshot.status === 'terminal'
  return (
    <div className="space-y-6">
      {snapshot.isPreview && (
        <p className="rounded-md border border-warn bg-warn-soft px-4 py-2 text-sm text-warn">
          Preview of the latest draft. This attempt does not count towards anyone&apos;s progress.
        </p>
      )}
      {error && (
        // Fixed to the viewport: the learner is usually at the submit button, far below the top.
        <p
          role="alert"
          className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-xl rounded-md border border-danger bg-danger-soft px-4 py-3 text-sm text-danger shadow-lg"
        >
          {error}
        </p>
      )}
      {snapshot.typeId === 'lab-legacy' && (
        <LabLegacyPlayer challengeId={challengeId} view={snapshot.view as LabLegacyView} send={send} busy={busy} />
      )}
      {snapshot.typeId === 'question-set' && <QuestionSetPlayer view={snapshot.view as QuestionSetView} send={send} busy={busy} />}
      {!['lab-legacy', 'question-set'].includes(snapshot.typeId) && (
        <p className="card">This kind of challenge cannot be played in this version yet.</p>
      )}
      {ended && snapshot.assessment && <AssessmentSummary assessment={snapshot.assessment} />}
      {ended && (
        <button type="button" className="btn-secondary" onClick={restart} disabled={busy}>
          Try again
        </button>
      )}
    </div>
  )
}
