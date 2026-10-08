'use client'
import { useState } from 'react'
import type { QuestionSetView } from '@challengeforge/types'
import { Markdown } from '@/components/Markdown'
import type { SendAction } from './Player'

type Answers = Record<string, string | string[]>
type Item = QuestionSetView['items'][number]

function ItemInput({ item, value, onChange, disabled }: { item: Item; value: string | string[] | undefined; onChange: (v: string | string[]) => void; disabled: boolean }) {
  if (item.type === 'single') {
    return (
      <div className="space-y-2">
        {item.options?.map((o) => (
          <label key={o.id} className="flex items-start gap-2">
            <input type="radio" name={item.id} value={o.id} checked={value === o.id} disabled={disabled} onChange={() => onChange(o.id)} className="mt-1.5" />
            <span>{o.text}</span>
          </label>
        ))}
      </div>
    )
  }
  if (item.type === 'multi') {
    const picked = Array.isArray(value) ? value : []
    return (
      <div className="space-y-2">
        {item.options?.map((o) => (
          <label key={o.id} className="flex items-start gap-2">
            <input
              type="checkbox"
              checked={picked.includes(o.id)}
              disabled={disabled}
              onChange={(e) => onChange(e.target.checked ? [...picked, o.id] : picked.filter((p) => p !== o.id))}
              className="mt-1.5"
            />
            <span>{o.text}</span>
          </label>
        ))}
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2">
      <input
        className="field-input max-w-md"
        inputMode={item.type === 'numeric' ? 'decimal' : 'text'}
        maxLength={200}
        value={typeof value === 'string' ? value : ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        aria-label={item.prompt}
      />
      {item.unit && <span className="text-ink-muted">{item.unit}</span>}
    </div>
  )
}

export function QuestionSetPlayer({ view, send, busy }: { view: QuestionSetView; send: SendAction; busy: boolean }) {
  const [answers, setAnswers] = useState<Answers>((view.answers as Answers | null) ?? {})
  const results = new Map((view.results ?? []).map((r) => [r.id, r]))

  return (
    <form
      className="space-y-6"
      onSubmit={(e) => {
        e.preventDefault()
        void send({ kind: 'submit', answers })
      }}
    >
      <header className="space-y-2">
        <h1 className="text-3xl sm:text-4xl">{view.title}</h1>
        {view.intro && <Markdown className="prose-cf text-lg text-ink-muted">{view.intro}</Markdown>}
      </header>
      <ol className="space-y-4">
        {view.items.map((item, i) => {
          const result = results.get(item.id)
          return (
            <li key={item.id} className="card space-y-3">
              <p className="font-semibold">
                <span className="mr-2 font-mono text-sm text-ink-muted">{i + 1}.</span>
                {item.prompt}
              </p>
              <ItemInput item={item} value={answers[item.id]} disabled={view.submitted || busy} onChange={(v) => setAnswers({ ...answers, [item.id]: v })} />
              {result && (
                <div className={`rounded-md px-3 py-2 text-sm ${result.correct ? 'bg-good-soft text-good' : 'bg-danger-soft text-danger'}`}>
                  <p className="font-semibold">{result.correct ? 'Correct' : `Answer: ${result.correctAnswer}`}</p>
                  {result.explanation && <p className="text-ink">{result.explanation}</p>}
                </div>
              )}
            </li>
          )
        })}
      </ol>
      {!view.submitted && (
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? 'Submitting…' : 'Submit answers'}
        </button>
      )}
      {view.debrief && (
        <section className="card">
          <Markdown>{view.debrief}</Markdown>
        </section>
      )}
    </form>
  )
}
