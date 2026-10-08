'use client'
import type { DiagnosticSimView } from '@challengeforge/types'
import { Markdown } from '@/components/Markdown'
import type { SendAction } from '../Player'
import { ActionTabs } from './ActionTabs'
import { CaseNotes } from './CaseNotes'
import { DecisionPanel } from './DecisionPanel'
import { PatientPanel } from './PatientPanel'
import { PatientChat } from './PatientChat'

const END_TEXT: Record<string, string> = {
  diagnosis: 'You submitted your diagnosis.',
  time: 'The time for this case ran out.',
  actions: 'The case reached its limit of actions.',
  learner: 'You ended the case.',
}

/** The interactive paradigm in the browser: a patient worked up step by step. */
export function DiagnosticSimPlayer({ view, send, busy }: { view: DiagnosticSimView; send: SendAction; busy: boolean }) {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl sm:text-4xl">{view.title}</h1>
      <PatientPanel view={view} />
      {view.ended ? (
        <section className="card space-y-3" aria-labelledby="case-debrief">
          <h2 id="case-debrief" className="text-2xl">Debrief</h2>
          <p className="text-sm text-ink-muted">{END_TEXT[view.endReason ?? 'learner']}</p>
          {view.debrief && <Markdown>{view.debrief}</Markdown>}
          {view.modelPathway && view.modelPathway.length > 0 && (
            <>
              <h3 className="eyebrow">A model pathway</h3>
              <ol className="list-decimal space-y-1 pl-5">
                {view.modelPathway.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </>
          )}
        </section>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[3fr_2fr]">
          <div className="space-y-6">
            {view.patientChat && <PatientChat chat={view.patientChat} send={send} busy={busy} />}
            <ActionTabs view={view} send={send} busy={busy} />
            <DecisionPanel view={view} send={send} busy={busy} />
          </div>
          <CaseNotes view={view} />
        </div>
      )}
      {view.ended && <CaseNotes view={view} />}
    </div>
  )
}
