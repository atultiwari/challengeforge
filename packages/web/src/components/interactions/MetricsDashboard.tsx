'use client'
import { useEffect, useState } from 'react'
import { DatasetExplorer } from './DatasetExplorer'
import { ConfusionMatrixBuilder, type MatrixCellLabels } from './ConfusionMatrixBuilder'
import type { FilterLabels } from './DatasetExplorer'
import { assetUrl, type InteractionProps, type ColumnSpec } from './types'

/** Everything the learner reads comes from interaction_config, not from code. */
interface DashboardConfig {
  headline: { label: string; value: string; value_caption: string; caption: string }
  dataset: {
    ref: string
    title: string
    description: string
    truth_column: string
    prediction_column: string
    id_column: string
    columns: ColumnSpec[]
    filters?: Partial<FilterLabels>
  }
  matrix: { title: string; intro: string; cells: MatrixCellLabels }
  answer: {
    numeric: { field: string; label: string; help: string; placeholder?: string; unit: string }
    choice: { field: string; label: string; options: { id: string; text: string }[] }
  }
}

/**
 * B5. The learner arrives at a single confident number, and has to dig past it.
 * The headline is shown alone at first, exactly as a vendor brochure would.
 */
export function MetricsDashboard({ challengeId, config: rawConfig, onSubmit, submitting, disabled }: InteractionProps) {
  const config = rawConfig as unknown as DashboardConfig
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [showData, setShowData] = useState(false)
  const [numeric, setNumeric] = useState('')
  const [choice, setChoice] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const res = await fetch(
          assetUrl(challengeId, config.dataset.ref),
        )
        if (!res.ok) throw new Error('load failed')
        const json = await res.json()
        if (!cancelled) setRows(json.patients ?? [])
      } catch {
        if (!cancelled) setLoadError('The patient data could not be loaded. Refresh and try again.')
      }
    }
    load()
    return () => { cancelled = true }
  }, [challengeId, config.dataset.ref])

  const canSubmit = numeric.trim() !== '' && choice !== '' && !submitting && !disabled

  return (
    <div className="space-y-6">
      {/* The brochure. One number, no context - the trap. */}
      <section className="card bg-accent-soft">
        <div className="text-xs font-semibold uppercase tracking-wide text-accent-dark">
          {config.headline.label}
        </div>
        <div className="mt-1 text-5xl font-bold tracking-tight text-accent-dark">{config.headline.value}</div>
        <div className="mt-1 text-sm font-semibold text-ink">{config.headline.value_caption}</div>
        <p className="mt-3 text-xs text-ink-muted">{config.headline.caption}</p>
      </section>

      <section className="card">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold">{config.dataset.title}</h2>
            <p className="mt-0.5 text-sm text-ink-muted">{config.dataset.description}</p>
          </div>
          <button className="btn-secondary" onClick={() => setShowData((s) => !s)}>
            {showData ? 'Hide patients' : 'Open patient list'}
          </button>
        </div>

        {loadError && <p role="alert" className="mt-4 text-sm font-medium text-danger">{loadError}</p>}
        {!rows && !loadError && <p className="mt-4 text-sm text-ink-muted">Loading the patients…</p>}

        {showData && rows && (
          <div className="mt-5 border-t border-line pt-5">
            <DatasetExplorer
              rows={rows}
              columns={config.dataset.columns}
              truthColumn={config.dataset.truth_column}
              predictionColumn={config.dataset.prediction_column}
              filterLabels={config.dataset.filters}
            />
          </div>
        )}
      </section>

      {rows && (
        <section className="card">
          <h2 className="text-base font-bold">{config.matrix.title}</h2>
          <div className="mt-3">
            <ConfusionMatrixBuilder
              rows={rows}
              truthColumn={config.dataset.truth_column}
              predictionColumn={config.dataset.prediction_column}
              intro={config.matrix.intro}
              cellLabels={config.matrix.cells}
            />
          </div>
        </section>
      )}

      <section className="card">
        <h2 className="text-base font-bold">Your answer</h2>

        <div className="mt-4">
          <label className="field-label" htmlFor="numeric-answer">{config.answer.numeric.label}</label>
          <div className="flex items-center gap-2">
            <input
              id="numeric-answer"
              className="field-input max-w-40"
              inputMode="decimal"
              value={numeric}
              onChange={(e) => setNumeric(e.target.value)}
              placeholder={config.answer.numeric.placeholder ?? ''}
              disabled={disabled}
            />
            <span className="text-sm font-semibold text-ink-muted">{config.answer.numeric.unit}</span>
          </div>
          <p className="field-help">{config.answer.numeric.help}</p>
        </div>

        <fieldset className="mt-6">
          <legend className="field-label">{config.answer.choice.label}</legend>
          <div className="space-y-2">
            {config.answer.choice.options.map((option) => (
              <label
                key={option.id}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 text-sm transition-colors ${
                  choice === option.id ? 'border-accent bg-accent-soft' : 'border-line hover:border-accent'
                }`}
              >
                <input
                  type="radio"
                  name="explanation"
                  value={option.id}
                  checked={choice === option.id}
                  onChange={() => setChoice(option.id)}
                  className="mt-1"
                  disabled={disabled}
                />
                <span>{option.text}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <button
          className="btn-primary mt-6 w-full sm:w-auto"
          disabled={!canSubmit}
          onClick={() =>
            onSubmit({
              [config.answer.numeric.field]: numeric.trim(),
              [config.answer.choice.field]: choice,
            })
          }
        >
          {submitting ? 'Checking…' : 'Submit answer'}
        </button>
      </section>
    </div>
  )
}
