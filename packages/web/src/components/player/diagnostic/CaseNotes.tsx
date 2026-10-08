import type { DiagnosticSimView } from '@challengeforge/types'

function Section({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="eyebrow">{title}</h3>
      {empty ? <p className="text-sm text-ink-faint">Nothing yet.</p> : children}
    </section>
  )
}

/** Everything the learner has found out so far, in the order a clinician writes it up. */
export function CaseNotes({ view }: { view: DiagnosticSimView }) {
  return (
    <aside aria-label="Case notes" className="card space-y-5">
      <h2 className="text-xl">Case notes</h2>
      <Section title="History" empty={view.history.length === 0}>
        <dl className="space-y-2 text-sm">
          {view.history.map((h) => (
            <div key={h.label}>
              <dt className="font-semibold">{h.label}</dt>
              <dd className="text-ink-muted">“{h.response}”</dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section title="Examination" empty={view.examination.length === 0}>
        <dl className="space-y-2 text-sm">
          {view.examination.map((e) => (
            <div key={e.label}>
              <dt className="font-semibold">{e.label}</dt>
              <dd className="text-ink-muted">{e.response}</dd>
            </div>
          ))}
        </dl>
      </Section>
      <Section title="Investigations" empty={view.investigations.length === 0}>
        <ul className="space-y-2 text-sm">
          {view.investigations.map((inv, i) => (
            <li key={`${inv.label}-${i}`}>
              <span className="font-semibold">{inv.label}</span>{' '}
              {inv.status === 'ready' ? (
                <span>{inv.result}</span>
              ) : (
                <span className="text-ink-faint">pending, back at T+{inv.readyAt} min</span>
              )}
            </li>
          ))}
        </ul>
      </Section>
      <Section title="Treatment" empty={view.treatments.length === 0}>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {view.treatments.map((t) => (
            <li key={t.label}>{t.response}</li>
          ))}
        </ul>
      </Section>
    </aside>
  )
}
