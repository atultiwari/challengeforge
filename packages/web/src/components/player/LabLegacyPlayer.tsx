'use client'
import type { ComponentType } from 'react'
import type { LabLegacyView } from '@challengeforge/types'
import { Markdown } from '@/components/Markdown'
import type { InteractionProps } from '@/components/interactions/types'
import { ClickToFlag } from '@/components/interactions/click-to-flag/ClickToFlag'
import { DataFlagger } from '@/components/interactions/data-flagger/DataFlagger'
import { MetricsDashboard } from '@/components/interactions/MetricsDashboard'
import { ScenarioQuiz } from '@/components/interactions/scenario-quiz/ScenarioQuiz'
import type { SendAction } from './Player'

/** The Lab's Level 1 interaction components, by the name a challenge declares. */
const INTERACTIONS: Readonly<Record<string, ComponentType<InteractionProps>>> = {
  click_to_flag: ClickToFlag,
  data_flagger: DataFlagger,
  metrics_dashboard: MetricsDashboard,
  scenario_quiz: ScenarioQuiz,
}

const STATUS_TEXT: Record<LabLegacyView['status'], string> = {
  open: '',
  solved: 'Solved.',
  revealed: 'Answer revealed. This attempt scores no points.',
  closed: 'No attempts left on this try.',
}

interface Props {
  challengeId: string
  view: LabLegacyView
  send: SendAction
  busy: boolean
}

export function LabLegacyPlayer({ challengeId, view, send, busy }: Props) {
  const Interaction = INTERACTIONS[view.interaction]
  const open = view.status === 'open'
  const labels = Array.isArray(view.config['outcome_labels']) ? (view.config['outcome_labels'] as string[]) : []
  const nextHint = view.hints.length

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-3xl sm:text-4xl">{view.title}</h1>
        {view.storyBrief && <Markdown className="prose-cf text-lg text-ink-muted">{view.storyBrief}</Markdown>}
      </header>

      {Interaction ? (
        <Interaction
          challengeId={challengeId}
          config={view.config}
          onSubmit={async (payload) => {
            await send({ kind: 'submit', payload })
          }}
          submitting={busy}
          disabled={!open || busy}
        />
      ) : (
        <p className="card">This interaction ({view.interaction}) is not available in this version yet.</p>
      )}

      {view.lastOutcomes && (
        <section aria-live="polite" className="card space-y-2">
          <h2 className="eyebrow">Last answer</h2>
          <ul className="space-y-1">
            {view.lastOutcomes.map((o, i) => (
              <li key={i} className={o.passed ? 'text-good' : 'text-danger'}>
                <span className="font-semibold">{labels[i] ?? `Part ${i + 1}`}:</span> {o.message}
                {o.detail?.found !== undefined && o.detail.required !== undefined && (
                  <span className="ml-1 font-mono text-xs text-ink-muted">
                    ({o.detail.found}/{o.detail.required} found)
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {STATUS_TEXT[view.status] && <p className="font-semibold">{STATUS_TEXT[view.status]}</p>}

      {open && (
        <section className="card space-y-3" aria-labelledby="hints-heading">
          <h2 id="hints-heading" className="eyebrow">
            Hints
          </h2>
          {view.hints.map((h) => (
            <p key={h.index} className="rounded-md bg-surface-sunken px-3 py-2 text-sm">
              {h.text}
            </p>
          ))}
          <div className="flex flex-wrap gap-3">
            {nextHint < view.hintCosts.length && (
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => send({ kind: 'hint', index: nextHint })}>
                Show hint {nextHint + 1} (−{view.hintCosts[nextHint]} points)
              </button>
            )}
            {view.canReveal && (
              <button type="button" className="btn-secondary" disabled={busy} onClick={() => send({ kind: 'reveal' })}>
                Show me the answer (0 points)
              </button>
            )}
          </div>
        </section>
      )}

      {view.debrief && (
        <section className="card space-y-3" aria-labelledby="debrief-heading">
          <h2 id="debrief-heading" className="text-2xl">
            Debrief
          </h2>
          <Markdown>{view.debrief}</Markdown>
          {view.reviewItems && view.reviewItems.length > 0 && (
            <ul className="space-y-2">
              {view.reviewItems.map((r) => (
                <li key={r.id}>
                  <p className="font-semibold">
                    {r.found ? '✓ ' : ''}
                    {r.label}
                  </p>
                  <p className="text-sm text-ink-muted">{r.explanation}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  )
}
