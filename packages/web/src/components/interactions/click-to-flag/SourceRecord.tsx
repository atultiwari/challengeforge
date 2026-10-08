'use client'
import type { CaseFile } from './types'

/** The hospital record: the ground truth every summary is checked against. */
export function SourceRecord({ caseFile }: { caseFile: CaseFile }) {
  const { patient, record, medication_chart: chart, labs, allergies } = caseFile

  return (
    <div className="space-y-5 text-sm">
      {patient && (
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-lg bg-surface-sunken p-3 text-xs sm:grid-cols-3">
          {Object.entries(patient).map(([key, value]) => (
            <div key={key}>
              <dt className="font-semibold capitalize text-ink-faint">{key}</dt>
              <dd className="text-ink">{String(value)}</dd>
            </div>
          ))}
        </dl>
      )}

      {allergies && (
        <section className="rounded-lg border-2 border-danger/40 bg-danger-soft p-3">
          <h3 className="text-xs font-bold uppercase tracking-wide text-danger">{allergies.title}</h3>
          {allergies.entries.map((a) => (
            <p key={a.substance} className="mt-1 text-ink">
              <strong>{a.substance}</strong>: {a.reaction}. {a.advice}.
            </p>
          ))}
        </section>
      )}

      {record.map((section) => (
        <section key={section.id}>
          <h3 className="text-xs font-bold uppercase tracking-wide text-ink-muted">{section.title}</h3>
          <div className="mt-2 space-y-2 text-ink">
            {(section.paragraphs ?? []).map((p, i) => <p key={i}>{p.trim()}</p>)}
            {section.dialogue && (
              <dl className="space-y-1.5">
                {section.dialogue.map((line, i) => (
                  <div key={i} className="grid grid-cols-[5.5rem_1fr] gap-2">
                    <dt className="font-semibold text-ink-muted">{line.speaker}</dt>
                    <dd>{line.text}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        </section>
      ))}

      {chart && (
      <section>
        <h3 className="text-xs font-bold uppercase tracking-wide text-ink-muted">{chart.title}</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-line text-left">
                {['Drug', 'Dose', 'Route', 'Frequency', 'Note'].map((h) => (
                  <th key={h} scope="col" className="whitespace-nowrap p-1.5 font-semibold">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chart.rows.map((r) => (
                <tr key={r.drug} className="border-b border-line/60 align-top">
                  <td className="p-1.5 font-medium">{r.drug}</td>
                  <td className="whitespace-nowrap p-1.5">{r.dose}</td>
                  <td className="p-1.5">{r.route}</td>
                  <td className="p-1.5">{r.frequency}</td>
                  <td className="p-1.5 text-ink-muted">{r.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      )}

      {labs && (
      <section>
        <h3 className="text-xs font-bold uppercase tracking-wide text-ink-muted">{labs.title}</h3>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full text-xs tabular-nums">
            <thead>
              <tr className="border-b border-line text-left">
                {labs.columns.map((c) => (
                  <th key={c} scope="col" className="whitespace-nowrap p-1.5 font-semibold">{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {labs.rows.map((row) => (
                <tr key={row[0]} className="border-b border-line/60">
                  {row.map((cell, i) => (
                    <td key={i} className={`whitespace-nowrap p-1.5 ${i === 0 ? 'font-medium' : ''}`}>{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      )}
    </div>
  )
}
