'use client'
import { useState } from 'react'
import type { DiagnosticSimView } from '@challengeforge/types'
import type { SendAction } from '../Player'

const WAITS = [5, 15, 30, 60] as const
const MAX_DIFFERENTIALS = 8

/** Waiting for results, recording a differential, and committing to a diagnosis. */
export function DecisionPanel({ view, send, busy }: { view: DiagnosticSimView; send: SendAction; busy: boolean }) {
  const [differential, setDifferential] = useState<string[]>(view.differential ? [...view.differential] : [''])
  const [diagnosis, setDiagnosis] = useState('')
  const terms = differential.map((d) => d.trim()).filter(Boolean)

  return (
    <section aria-label="Decisions" className="card space-y-5">
      <div className="space-y-2">
        <h3 className="eyebrow">Time</h3>
        <div className="flex flex-wrap gap-2">
          {WAITS.map((minutes) => (
            <button key={minutes} type="button" className="btn-secondary" disabled={busy} onClick={() => send({ kind: 'advance_time', minutes })}>
              Wait {minutes} min
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-2">
        <h3 className="eyebrow">Differential diagnosis</h3>
        {view.differentialRequired && view.differential === null && (
          <p className="text-sm text-warn">Record a working differential before ordering investigations.</p>
        )}
        {differential.map((d, i) => (
          <input
            key={i}
            className="field-input"
            value={d}
            maxLength={80}
            aria-label={`Differential ${i + 1}`}
            onChange={(e) => setDifferential(differential.map((x, j) => (j === i ? e.target.value : x)))}
          />
        ))}
        <div className="flex flex-wrap gap-2">
          {differential.length < MAX_DIFFERENTIALS && (
            <button type="button" className="btn-secondary" onClick={() => setDifferential([...differential, ''])}>
              Add another
            </button>
          )}
          <button type="button" className="btn-secondary" disabled={busy || terms.length === 0} onClick={() => send({ kind: 'record_differential', terms })}>
            Record differential
          </button>
        </div>
        {view.differential && <p className="text-sm text-ink-muted">Recorded: {view.differential.join(', ')}</p>}
      </div>

      <form
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault()
          if (window.confirm('Submitting your diagnosis ends the case. Continue?')) void send({ kind: 'submit_diagnosis', text: diagnosis.trim() })
        }}
      >
        <h3 className="eyebrow">Final diagnosis</h3>
        <input className="field-input" value={diagnosis} maxLength={120} aria-label="Final diagnosis" onChange={(e) => setDiagnosis(e.target.value)} />
        <button type="submit" className="btn-primary" disabled={busy || !diagnosis.trim()}>
          Submit diagnosis and end the case
        </button>
      </form>
    </section>
  )
}
