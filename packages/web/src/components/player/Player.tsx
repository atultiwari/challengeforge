'use client'
import { useCallback, useRef, useState } from 'react'
import type { AttemptSnapshot } from '@challengeforge/db'
import type { ChatMissionView, DiagnosticSimView, LabLegacyView, QuestionSetView } from '@challengeforge/types'
import { postJson } from '@/lib/api'
import { AssessmentSummary } from './AssessmentSummary'
import { ChatMissionPlayer } from './ChatMissionPlayer'
import { DiagnosticSimPlayer } from './diagnostic/DiagnosticSimPlayer'
import { LabLegacyPlayer } from './LabLegacyPlayer'
import { QuestionSetPlayer } from './QuestionSetPlayer'

const PLAYABLE_TYPES = new Set(['lab-legacy', 'question-set', 'diagnostic-sim', 'chat-mission'])

export type SendAction = (action: Record<string, unknown>) => Promise<boolean>

interface Props {
  challengeId: string
  title: string
  preview: boolean
  /** The learner's open attempt, or null: attempts are only ever started by a POST. */
  initial: AttemptSnapshot | null
}

/**
 * Runs any challenge type: holds the attempt snapshot, sends actions (each
 * with a fresh idempotency key, so a retried request is never applied twice),
 * and hands the type's view to the matching player. Each attempt mounts a
 * fresh player (keyed by attempt), so "Try again" never carries answers over.
 */
export function Player({ challengeId, title, preview, initial }: Props) {
  const [snapshot, setSnapshot] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // A ref, not state: a double click must not send the same action twice.
  const inFlight = useRef(false)

  const run = useCallback(async <T,>(url: string, body: unknown, onData: (data: T) => void): Promise<boolean> => {
    if (inFlight.current) return false
    inFlight.current = true
    setBusy(true)
    setError(null)
    const result = await postJson<T>(url, body)
    inFlight.current = false
    setBusy(false)
    if (!result.ok) {
      setError(result.error.message)
      return false
    }
    onData(result.data)
    return true
  }, [])

  const send: SendAction = useCallback(
    (action) =>
      snapshot
        ? run<AttemptSnapshot>(`/api/attempts/${snapshot.attemptId}/actions`, { action, idempotencyKey: crypto.randomUUID() }, setSnapshot)
        : Promise.resolve(false),
    [run, snapshot],
  )
  const start = useCallback(() => run<AttemptSnapshot>(`/api/challenges/${challengeId}/attempt`, { preview }, setSnapshot), [run, challengeId, preview])

  const toast = error && (
    // Fixed to the viewport: the learner is usually at the submit button, far below the top.
    <p
      role="alert"
      className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-xl rounded-md border border-danger bg-danger-soft px-4 py-3 text-sm text-danger shadow-lg"
    >
      {error}
    </p>
  )

  if (!snapshot) {
    return (
      <div className="space-y-6">
        <h1 className="text-3xl sm:text-4xl">{title}</h1>
        <button type="button" className="btn-primary" onClick={start} disabled={busy}>
          {busy ? 'Starting…' : preview ? 'Start preview' : 'Start'}
        </button>
        {toast}
      </div>
    )
  }

  const ended = snapshot.status === 'terminal'
  return (
    <div className="space-y-6">
      {snapshot.isPreview && (
        <p className="rounded-md border border-warn bg-warn-soft px-4 py-2 text-sm text-warn">
          Preview of the latest draft. This attempt does not count towards anyone&apos;s progress.
        </p>
      )}
      {toast}
      {snapshot.typeId === 'lab-legacy' && (
        <LabLegacyPlayer key={snapshot.attemptId} challengeId={challengeId} view={snapshot.view as LabLegacyView} send={send} busy={busy} />
      )}
      {snapshot.typeId === 'question-set' && (
        <QuestionSetPlayer key={snapshot.attemptId} view={snapshot.view as QuestionSetView} send={send} busy={busy} />
      )}
      {snapshot.typeId === 'diagnostic-sim' && (
        <DiagnosticSimPlayer key={snapshot.attemptId} view={snapshot.view as DiagnosticSimView} send={send} busy={busy} />
      )}
      {snapshot.typeId === 'chat-mission' && (
        <ChatMissionPlayer key={snapshot.attemptId} view={snapshot.view as ChatMissionView} send={send} busy={busy} />
      )}
      {!PLAYABLE_TYPES.has(snapshot.typeId) && (
        <p className="card">This kind of challenge cannot be played in this version yet.</p>
      )}
      {ended && snapshot.assessment && <AssessmentSummary assessment={snapshot.assessment} />}
      {ended && (
        <button type="button" className="btn-secondary" onClick={start} disabled={busy}>
          Try again
        </button>
      )}
    </div>
  )
}
