'use client'
import { useMemo, useState } from 'react'
import type { InteractionProps } from '../types'
import { AnswerSection } from '../questions/AnswerSection'
import type { Question } from '../questions/types'
import { confusion, ratio, useDataset, type Row } from '../useDataset'

interface Config {
  instructions: string
  dataset_ref: string
  score_column: string
  truth_column: string
  /** The vendor's out-of-the-box threshold, where the slider starts. */
  default_threshold: number
  default_label: string
  positive_label: string
  negative_label: string
  target_label: string
  threshold_field: string
  answers_field: string
  questions: Question[]
  submit_label?: string
}

const BINS = 20

/** Score distribution for one outcome group, with the threshold drawn across it. */
function Histogram({ rows, score, label, threshold, tone }: { rows: Row[]; score: string; label: string; threshold: number; tone: string }) {
  const counts = Array.from({ length: BINS }, (_, bin) =>
    rows.filter((r) => Math.min(BINS - 1, Math.floor(Number(r[score]) * BINS)) === bin).length,
  )
  const max = Math.max(1, ...counts)
  return (
    <figure>
      <figcaption className="text-xs font-semibold text-ink-muted">{label} ({rows.length})</figcaption>
      <svg viewBox="0 0 200 50" className="mt-1 h-16 w-full" role="img" aria-label={`Score distribution: ${label}`}>
        {counts.map((c, i) => (
          <rect key={i} x={i * 10 + 1} y={50 - (c / max) * 48} width={8} height={(c / max) * 48} className={tone} />
        ))}
        <line x1={threshold * 200} x2={threshold * 200} y1={0} y2={50} className="stroke-ink" strokeWidth={1.2} strokeDasharray="3 2" />
      </svg>
    </figure>
  )
}

/**
 * I2. The learner drags a decision threshold and watches the trade-off move:
 * every patient caught costs alerts. The server recomputes whatever threshold
 * they submit from the same dataset.
 */
export function ThresholdSlider({ challengeId, config: rawConfig, onSubmit, submitting, disabled }: InteractionProps) {
  const config = rawConfig as unknown as Config
  const { rows, error } = useDataset(challengeId, config.dataset_ref)
  const [threshold, setThreshold] = useState(config.default_threshold)

  const isPositive = (r: Row) => r[config.truth_column] === true
  const groups = useMemo(() => ({
    positive: (rows ?? []).filter((r) => r[config.truth_column] === true),
    negative: (rows ?? []).filter((r) => r[config.truth_column] !== true),
  }), [rows, config.truth_column])
  const m = rows ? confusion(rows, isPositive, (r) => Number(r[config.score_column]) >= threshold) : null
  const alerts = m ? m.tp + m.fp : 0

  return (
    <div className="space-y-6">
      <p className="rounded-lg bg-accent-soft px-4 py-3 text-sm text-ink">{config.instructions.trim()}</p>

      <section className="card">
        <h2 className="text-base font-bold">Choose the alert threshold</h2>
        {error && <p role="alert" className="mt-3 text-sm font-medium text-danger">{error}</p>}
        {!rows && !error && <p className="mt-3 text-sm text-ink-muted">Loading the patients…</p>}
        {rows && m && (
          <>
            <div className="mt-4 flex flex-wrap items-center gap-4">
              <label htmlFor="threshold" className="text-sm font-semibold">Alert when the score is at least</label>
              <input
                id="threshold"
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={threshold}
                disabled={disabled}
                onChange={(e) => setThreshold(Number(e.target.value))}
                className="w-full max-w-md accent-accent"
              />
              <output htmlFor="threshold" className="text-2xl font-bold tabular-nums">{threshold.toFixed(2)}</output>
              <button className="btn-secondary" disabled={disabled} onClick={() => setThreshold(config.default_threshold)}>
                {config.default_label} ({config.default_threshold.toFixed(2)})
              </button>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <Histogram rows={groups.positive} score={config.score_column} label={config.positive_label} threshold={threshold} tone="fill-danger" />
              <Histogram rows={groups.negative} score={config.score_column} label={config.negative_label} threshold={threshold} tone="fill-ink-muted" />
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-5" aria-live="polite">
              {[
                ['Sensitivity', ratio(m.tp, m.tp + m.fn), `${m.tp} of ${m.tp + m.fn} caught`],
                ['Specificity', ratio(m.tn, m.tn + m.fp), `${m.tn} of ${m.tn + m.fp} left alone`],
                ['PPV', ratio(m.tp, alerts), 'alerts that were real'],
                ['Alerts', String(alerts), `of ${rows.length} patients`],
                ['Alerts per 100', (Math.round((alerts / rows.length) * 1000) / 10).toFixed(1), 'patients on the ward'],
              ].map(([label, value, note]) => (
                <div key={label} className="rounded-lg border border-line p-3">
                  <dt className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</dt>
                  <dd className="mt-1 text-xl font-bold tabular-nums">{value}</dd>
                  <dd className="text-xs text-ink-muted">{note}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-ink-muted">{config.target_label}</p>
          </>
        )}
      </section>

      <AnswerSection
        questions={config.questions}
        answersField={config.answers_field}
        submitLabel={config.submit_label}
        submitting={submitting}
        disabled={disabled || !rows}
        extra={{ [config.threshold_field]: threshold }}
        onSubmit={onSubmit}
      />
    </div>
  )
}
