'use client'
import type { InteractionProps } from '../types'
import { BarChart, LineChart } from './Charts'
import type { Exhibit, EvidenceQuizConfig } from './types'
import { AnswerSection } from '../questions/AnswerSection'

export function ExhibitView({ exhibit }: { exhibit: Exhibit }) {
  return (
    <section className="card" aria-labelledby={`exhibit-${exhibit.id}`}>
      <h2 id={`exhibit-${exhibit.id}`} className="text-base font-bold">{exhibit.title}</h2>
      {exhibit.caption && <p className="mt-0.5 text-sm text-ink-muted">{exhibit.caption}</p>}
      <div className="mt-4">
        {exhibit.type === 'line_chart' && <LineChart chart={exhibit} title={exhibit.title} />}
        {exhibit.type === 'bar_chart' && <BarChart chart={exhibit} />}
        {exhibit.type === 'text' && (
          <div className="space-y-2 text-sm text-ink">
            {exhibit.paragraphs.map((p, i) => <p key={i}>{p.trim()}</p>)}
          </div>
        )}
        {exhibit.type === 'log' && (
          <ol className="space-y-2 text-sm">
            {exhibit.items.map((item, i) => (
              <li key={i} className="grid grid-cols-[6.5rem_1fr] gap-3">
                <span className="font-semibold tabular-nums text-ink-muted">{item.when}</span>
                <span>{item.text}</span>
              </li>
            ))}
          </ol>
        )}
        {exhibit.type === 'table' && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm tabular-nums">
              <thead>
                <tr className="border-b border-line text-left">
                  {exhibit.columns.map((c) => <th key={c} scope="col" className="whitespace-nowrap p-2 font-semibold">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {exhibit.rows.map((row, r) => (
                  <tr key={r} className="border-b border-line/60">
                    {row.map((cell, c) => <td key={c} className="min-w-28 p-2 align-top">{cell}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * I5, I6, A7: look at the evidence, then answer. Charts, tables and logs are
 * public content; which answers are right lives in the answer key.
 */
export function EvidenceQuiz({ challengeId, config: rawConfig, onSubmit, submitting, disabled }: InteractionProps) {
  const config = rawConfig as unknown as EvidenceQuizConfig
  return (
    <div className="space-y-6">
      <p className="rounded-lg bg-accent-soft px-4 py-3 text-sm text-ink">{config.instructions.trim()}</p>
      {config.exhibits.map((e) => <ExhibitView key={e.id} exhibit={e} />)}
      <AnswerSection
        questions={config.questions}
        answersField={config.answers_field}
        submitLabel={config.submit_label}
        submitting={submitting}
        disabled={disabled}
        onSubmit={onSubmit}
      />
    </div>
  )
}
