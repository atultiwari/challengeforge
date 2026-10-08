import type { DiagnosticSimView } from '@challengeforge/types'

/** Who the patient is, what they look like right now, and how much time has passed. */
export function PatientPanel({ view }: { view: DiagnosticSimView }) {
  const { patient, setting, chief_complaint, vignette } = view.presentation
  const remaining = view.timeBudget === null ? null : Math.max(0, view.timeBudget - view.clock)
  return (
    <section aria-labelledby="patient-heading" className="card space-y-4">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 id="patient-heading" className="text-2xl">
          {patient.age}-year-old {patient.sex}
          {patient.weight_kg ? `, ${patient.weight_kg} kg` : ''}
        </h2>
        <p className="text-sm text-ink-muted">{setting}</p>
        <p className="ml-auto font-mono text-sm" aria-live="polite">
          T+{view.clock} min{remaining !== null && <span className="text-ink-muted"> · {remaining} min left</span>}
        </p>
      </div>
      <p className="font-semibold">{chief_complaint}</p>
      <p className="text-ink-muted">{vignette}</p>
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {Object.entries(view.vitals).map(([name, value]) => (
          <div key={name} className="rounded-md bg-surface-sunken px-3 py-2">
            <dt className="font-mono text-xs uppercase tracking-wider text-ink-muted">{name}</dt>
            <dd className="font-semibold">{value}</dd>
          </div>
        ))}
      </dl>
      {view.alerts.length > 0 && (
        <div role="alert" className="space-y-1 rounded-md border border-danger bg-danger-soft px-4 py-3 text-danger">
          {view.alerts.map((a) => (
            <p key={a} className="font-semibold">{a}</p>
          ))}
        </div>
      )}
    </section>
  )
}
