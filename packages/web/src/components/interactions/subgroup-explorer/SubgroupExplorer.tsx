'use client'
import { useState } from 'react'
import type { InteractionProps, ColumnSpec } from '../types'
import { AnswerSection } from '../questions/AnswerSection'
import type { Question } from '../questions/types'
import { DatasetExplorer, type FilterLabels } from '../DatasetExplorer'
import { confusion, ratio, useDataset, type Row } from '../useDataset'

interface Config {
  instructions: string
  dataset_ref: string
  truth_column: string
  prediction_column: string
  /** Columns the learner may split the cohort by. */
  group_columns: { key: string; label: string; order?: string[] }[]
  columns: ColumnSpec[]
  filters?: Partial<FilterLabels>
  answers_field: string
  questions: Question[]
  submit_label?: string
}

function SubgroupTable({ rows, config, groupBy }: { rows: Row[]; config: Config; groupBy: Config['group_columns'][number] }) {
  const values = groupBy.order ?? [...new Set(rows.map((r) => String(r[groupBy.key])))].sort()
  const all = [...values.map((v) => ({ label: v, rows: rows.filter((r) => String(r[groupBy.key]) === v) })), { label: 'All patients', rows }]
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-sm tabular-nums">
        <caption className="sr-only">Performance by {groupBy.label}</caption>
        <thead>
          <tr className="border-b border-line text-left">
            {[groupBy.label, 'Patients', 'With the condition', 'Caught', 'Missed', 'False alarms', 'Sensitivity', 'Specificity', 'PPV'].map((h) => (
              <th key={h} scope="col" className="whitespace-nowrap p-2 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {all.map((g) => {
            const m = confusion(g.rows, (r) => r[config.truth_column] === true, (r) => r[config.prediction_column] === true)
            return (
              <tr key={g.label} className={`border-b border-line/60 ${g.label === 'All patients' ? 'font-semibold' : ''}`}>
                <th scope="row" className="whitespace-nowrap p-2 text-left font-medium">{g.label}</th>
                <td className="p-2">{g.rows.length}</td>
                <td className="p-2">{m.tp + m.fn}</td>
                <td className="p-2">{m.tp}</td>
                <td className="p-2">{m.fn}</td>
                <td className="p-2">{m.fp}</td>
                <td className="p-2">{ratio(m.tp, m.tp + m.fn)}</td>
                <td className="p-2">{ratio(m.tn, m.tn + m.fp)}</td>
                <td className="p-2">{ratio(m.tp, m.tp + m.fp)}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/**
 * I3. One overall figure, then the same model split by patient group - the
 * committee's job is to find the group it fails.
 */
export function SubgroupExplorer({ challengeId, config: rawConfig, onSubmit, submitting, disabled }: InteractionProps) {
  const config = rawConfig as unknown as Config
  const { rows, error } = useDataset(challengeId, config.dataset_ref)
  const [groupKey, setGroupKey] = useState<string | null>(null)
  const [showRows, setShowRows] = useState(false)
  const groupBy = config.group_columns.find((g) => g.key === groupKey) ?? null

  return (
    <div className="space-y-6">
      <p className="rounded-lg bg-accent-soft px-4 py-3 text-sm text-ink">{config.instructions.trim()}</p>

      <section className="card">
        <h2 className="text-base font-bold">Performance by patient group</h2>
        {error && <p role="alert" className="mt-3 text-sm font-medium text-danger">{error}</p>}
        {!rows && !error && <p className="mt-3 text-sm text-ink-muted">Loading the patients…</p>}
        {rows && (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-2" role="group" aria-label="Split the patients by">
              <span className="text-sm font-semibold">Split by:</span>
              <button className={groupKey === null ? 'btn-primary' : 'btn-secondary'} aria-pressed={groupKey === null} onClick={() => setGroupKey(null)}>
                No split
              </button>
              {config.group_columns.map((g) => (
                <button key={g.key} className={groupKey === g.key ? 'btn-primary' : 'btn-secondary'} aria-pressed={groupKey === g.key} onClick={() => setGroupKey(g.key)}>
                  {g.label}
                </button>
              ))}
            </div>
            <div className="mt-4">
              <SubgroupTable rows={rows} config={config} groupBy={groupBy ?? { key: '__all', label: 'Group', order: [] }} />
            </div>
            <button className="btn-secondary mt-4" onClick={() => setShowRows((s) => !s)}>
              {showRows ? 'Hide patients' : 'Open patient list'}
            </button>
            {showRows && (
              <div className="mt-4 border-t border-line pt-4">
                <DatasetExplorer
                  rows={rows}
                  columns={config.columns}
                  truthColumn={config.truth_column}
                  predictionColumn={config.prediction_column}
                  filterLabels={config.filters}
                />
              </div>
            )}
          </>
        )}
      </section>

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
