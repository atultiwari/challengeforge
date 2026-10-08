'use client'
import { useState } from 'react'
import type { DiagnosticSimView } from '@challengeforge/types'
import type { SendAction } from '../Player'

/**
 * Asking the patient in your own words (cases with patient_chat). Answers
 * come from the case's history list only; what they reveal is added to the
 * history notes, exactly as if it had been asked from the search.
 */
export function PatientChat({ chat, send, busy }: { chat: NonNullable<DiagnosticSimView['patientChat']>; send: SendAction; busy: boolean }) {
  const [question, setQuestion] = useState('')
  return (
    <section className="card space-y-3" aria-labelledby="patient-chat">
      <div className="flex flex-wrap items-baseline gap-2">
        <h2 id="patient-chat" className="mr-auto text-xl">Talk to the patient</h2>
        <span className="text-sm text-ink-muted">{chat.remaining} question{chat.remaining === 1 ? '' : 's'} left</span>
      </div>
      {chat.conversation.length > 0 && (
        <ol className="space-y-2" aria-label="Conversation">
          {chat.conversation.map((turn, i) => (
            <li key={i} className="space-y-1">
              <p className="text-sm"><span className="font-semibold">You: </span>{turn.question}</p>
              <p className="rounded-md bg-surface-sunken px-3 py-2 text-sm"><span className="font-semibold">Patient: </span>{turn.reply}</p>
            </li>
          ))}
        </ol>
      )}
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          const text = question.trim()
          if (!text) return
          if (await send({ kind: 'converse', text: text.slice(0, 300) })) setQuestion('')
        }}
      >
        <input
          className="field-input"
          value={question}
          maxLength={300}
          placeholder="e.g. When did the vomiting start?"
          aria-label="Your question to the patient"
          disabled={chat.remaining === 0}
          onChange={(e) => setQuestion(e.target.value)}
        />
        <button type="submit" className="btn-secondary" disabled={busy || !question.trim() || chat.remaining === 0}>Ask the patient</button>
      </form>
      <p className="text-xs text-ink-muted">The patient is simulated by an AI model and answers only from the case notes.</p>
    </section>
  )
}
