'use client'
import { useState, type ReactNode } from 'react'
import { QuestionField } from './QuestionField'
import { isAnswered, type Answers, type Question } from './types'

interface Props {
  questions: Question[]
  answersField: string
  submitLabel?: string
  submitting: boolean
  disabled: boolean
  /** Extra values sent with the answers, e.g. the threshold the learner chose (I2). */
  extra?: Record<string, unknown>
  /** Blocks submission until the mission's own control is set. */
  ready?: boolean
  children?: ReactNode
  onSubmit: (payload: unknown) => Promise<void>
}

/** "Your assessment": the numbered questions and one submit button. */
export function AnswerSection({ questions, answersField, submitLabel, submitting, disabled, extra, ready = true, children, onSubmit }: Props) {
  const [answers, setAnswers] = useState<Answers>({})
  const complete = ready && questions.every((q) => isAnswered(answers[q.id]))

  return (
    <section className="card space-y-4">
      <h2 className="text-base font-bold">Your assessment</h2>
      {children}
      {questions.map((q, i) => (
        <QuestionField
          key={q.id}
          q={q}
          n={i + 1}
          value={answers[q.id]}
          disabled={disabled}
          onChange={(v) => setAnswers((prev) => ({ ...prev, [q.id]: v }))}
        />
      ))}
      <button
        className="btn-primary w-full sm:w-auto"
        disabled={!complete || submitting || disabled}
        onClick={() => onSubmit({ ...extra, [answersField]: answers })}
      >
        {submitting ? 'Checking…' : (submitLabel ?? 'Submit my assessment')}
      </button>
    </section>
  )
}
