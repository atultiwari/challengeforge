'use client'
import type { AnswerValue, Question } from './types'

interface Props {
  q: Question
  n: number
  value: AnswerValue | undefined
  disabled: boolean
  onChange: (v: AnswerValue) => void
}

/** One numbered question: a number box, a radio list, or a checkbox list. */
export function QuestionField({ q, n, value, disabled, onChange }: Props) {
  if (q.type === 'numeric') {
    const inputId = `q-${q.id}`
    return (
      <fieldset className="rounded-lg border border-line p-4">
        <legend className="px-1 text-sm font-semibold">Question {n}</legend>
        <label className="text-sm text-ink" htmlFor={inputId}>{q.prompt}</label>
        <div className="mt-3 flex items-center gap-2">
          <input
            id={inputId}
            className="field-input max-w-40"
            inputMode="decimal"
            value={typeof value === 'string' ? value : ''}
            placeholder={q.placeholder ?? ''}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
          {q.unit && <span className="text-sm font-semibold text-ink-muted">{q.unit}</span>}
        </div>
        {q.help && <p className="field-help">{q.help}</p>}
      </fieldset>
    )
  }

  const selected = (id: string) => (Array.isArray(value) ? value.includes(id) : value === id)
  // Named by number AND prompt, so a screen reader announces the question with each option.
  return (
    <fieldset className="rounded-lg border border-line p-4" aria-labelledby={`q-${q.id}-n q-${q.id}-p`}>
      <legend id={`q-${q.id}-n`} className="px-1 text-sm font-semibold">Question {n}</legend>
      <p id={`q-${q.id}-p`} className="text-sm text-ink">{q.prompt}</p>
      <p className="mt-1 text-xs text-ink-muted">{q.help ?? (q.type === 'multi' ? 'Choose all that apply.' : 'Choose one.')}</p>
      <div className="mt-3 space-y-2">
        {q.options.map((o) => (
          <label
            key={o.id}
            className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${
              selected(o.id) ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent'
            }`}
          >
            <input
              type={q.type === 'multi' ? 'checkbox' : 'radio'}
              name={`q-${q.id}`}
              value={o.id}
              checked={selected(o.id)}
              disabled={disabled}
              className="mt-1"
              onChange={() => {
                if (q.type === 'single') return onChange(o.id)
                const current: readonly string[] = Array.isArray(value) ? value : []
                onChange(current.includes(o.id) ? current.filter((x) => x !== o.id) : [...current, o.id])
              }}
            />
            <span>{o.text.trim()}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
