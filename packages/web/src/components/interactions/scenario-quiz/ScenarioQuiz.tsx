'use client'
import { useState } from 'react'
import type { InteractionProps } from '../types'

interface Scenario {
  id: string
  title: string
  asker: string
  prompt: string
  ai_answer: string
  question: string
  options: { id: string; text: string }[]
}

interface ScenarioQuizConfig {
  instructions: string
  ai_name: string
  answers_field: string
  scenarios: Scenario[]
}

/**
 * B2. Short cases: what a doctor asked an AI, what it answered, and one
 * question about each. Which option is right lives in the answer key.
 */
export function ScenarioQuiz({ challengeId, config: rawConfig, onSubmit, submitting, disabled }: InteractionProps) {
  const config = rawConfig as unknown as ScenarioQuizConfig
  const [answers, setAnswers] = useState<Readonly<Record<string, string>>>({})
  const complete = config.scenarios.every((s) => answers[s.id])

  return (
    <div className="space-y-6">
      <p className="rounded-lg bg-accent-soft px-4 py-3 text-sm text-ink">{config.instructions.trim()}</p>

      {config.scenarios.map((s, n) => (
        <section key={s.id} className="card" aria-labelledby={`scenario-${s.id}`}>
          <h2 id={`scenario-${s.id}`} className="text-base font-bold">
            Case {n + 1}: {s.title}
          </h2>
          <div className="mt-4 space-y-3">
            <div>
              <p className="text-xs font-semibold text-ink-muted">{s.asker} asks {config.ai_name}:</p>
              <p className="mt-1 rounded-2xl rounded-tl-sm bg-accent px-3 py-2 text-sm text-on-accent">{s.prompt}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-ink-muted">{config.ai_name} answers:</p>
              <p className="mt-1 rounded-2xl rounded-tl-sm border border-line bg-surface-sunken px-3 py-2 text-sm text-ink">
                {s.ai_answer}
              </p>
            </div>
          </div>

          <fieldset className="mt-5">
            <legend className="field-label">{s.question}</legend>
            <div className="space-y-2">
              {s.options.map((o) => (
                <label
                  key={o.id}
                  className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm ${
                    answers[s.id] === o.id ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent'
                  }`}
                >
                  <input
                    type="radio"
                    name={`scenario-${s.id}`}
                    value={o.id}
                    checked={answers[s.id] === o.id}
                    onChange={() => setAnswers((prev) => ({ ...prev, [s.id]: o.id }))}
                    disabled={disabled}
                    className="mt-1"
                  />
                  <span>{o.text}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </section>
      ))}

      <section className="card flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {Object.keys(answers).length} of {config.scenarios.length} cases answered.
        </p>
        <button
          className="btn-primary"
          disabled={!complete || submitting || disabled}
          onClick={() => onSubmit({ [config.answers_field]: answers })}
        >
          {submitting ? 'Checking…' : 'Submit my answers'}
        </button>
      </section>
    </div>
  )
}
