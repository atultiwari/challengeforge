'use client'
import type { BarChartExhibit, LineChartExhibit } from './types'

const W = 640
const H = 260
const PAD = { top: 34, right: 16, bottom: 40, left: 48 }
const SERIES_CLASSES = ['stroke-accent', 'stroke-warn', 'stroke-ink-muted', 'stroke-danger']
const DOT_CLASSES = ['fill-accent', 'fill-warn', 'fill-ink-muted', 'fill-danger']

function markerNumber(chart: LineChartExhibit, m: NonNullable<LineChartExhibit['markers']>[number]): number {
  return (chart.markers ?? []).indexOf(m) + 1
}

/** A plain SVG line chart, sized by viewBox so it shrinks on a phone. */
export function LineChart({ chart, title }: { chart: LineChartExhibit; title: string }) {
  const n = chart.x_labels.length
  const x = (i: number) => PAD.left + (n <= 1 ? 0 : (i * (W - PAD.left - PAD.right)) / (n - 1))
  const y = (v: number) => PAD.top + ((chart.y_max - v) * (H - PAD.top - PAD.bottom)) / (chart.y_max - chart.y_min)
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => chart.y_min + f * (chart.y_max - chart.y_min))
  const every = Math.max(1, Math.ceil(n / 12))

  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. The same data is in the table below.`} className="w-full">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} className="stroke-line" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" className="fill-ink-muted text-[11px]">
              {Number.isInteger(t) ? t : t.toFixed(2)}
            </text>
          </g>
        ))}
        {chart.x_labels.map((label, i) =>
          i % every === 0 ? (
            <text key={label} x={x(i)} y={H - PAD.bottom + 16} textAnchor="middle" className="fill-ink-muted text-[11px]">
              {label}
            </text>
          ) : null,
        )}
        {(chart.markers ?? []).map((m) => (
          <g key={m.label}>
            <line x1={x(m.x_index)} x2={x(m.x_index)} y1={PAD.top} y2={H - PAD.bottom} className="stroke-danger" strokeDasharray="4 3" />
            {/* Numbered badges above the plot; the labels are in the key below, so they never overlap the lines. */}
            <circle cx={x(m.x_index)} cy={PAD.top - 14} r={9} className="fill-danger" />
            <text x={x(m.x_index)} y={PAD.top - 10} textAnchor="middle" className="fill-surface text-[11px] font-bold">{markerNumber(chart, m)}</text>
          </g>
        ))}
        {chart.series.map((s, si) => (
          <g key={s.label}>
            <polyline
              fill="none"
              strokeWidth={2.5}
              className={SERIES_CLASSES[si % SERIES_CLASSES.length]}
              points={s.values.map((v, i) => `${x(i)},${y(v)}`).join(' ')}
            />
            {s.values.map((v, i) => (
              <circle key={i} cx={x(i)} cy={y(v)} r={3} className={DOT_CLASSES[si % DOT_CLASSES.length]} />
            ))}
          </g>
        ))}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-ink-muted">
        <span>Vertical axis: {chart.y_label}</span>
        {chart.series.map((s, si) => (
          <span key={s.label} className="inline-flex items-center gap-1.5">
            <span className={`inline-block h-0.5 w-5 ${['bg-accent', 'bg-warn', 'bg-ink-muted', 'bg-danger'][si % 4]}`} />
            {s.label}
          </span>
        ))}
      </figcaption>
      {chart.markers && chart.markers.length > 0 && (
        <ol className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {chart.markers.map((m) => (
            <li key={m.label} className="inline-flex items-center gap-1.5">
              <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-danger text-[10px] font-bold text-surface" aria-hidden>
                {markerNumber(chart, m)}
              </span>
              <span>{chart.x_labels[m.x_index]}: {m.label}</span>
            </li>
          ))}
        </ol>
      )}
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer font-semibold text-accent-dark">Show the numbers</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="min-w-full tabular-nums">
            <thead>
              <tr className="border-b border-line text-left">
                <th scope="col" className="p-1">Period</th>
                {chart.series.map((s) => <th key={s.label} scope="col" className="p-1">{s.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {chart.x_labels.map((label, i) => (
                <tr key={label} className="border-b border-line/60">
                  <th scope="row" className="p-1 text-left font-normal">{label}</th>
                  {chart.series.map((s) => <td key={s.label} className="p-1">{s.values[i]}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </figure>
  )
}

/** Horizontal bars with the value written on each: readable without the graphic. */
export function BarChart({ chart }: { chart: BarChartExhibit }) {
  return (
    <ul className="space-y-2">
      {chart.bars.map((b) => (
        <li key={b.label} className="text-sm">
          <div className="flex justify-between gap-2">
            <span>{b.label}</span>
            <span className="tabular-nums text-ink-muted">{b.value}</span>
          </div>
          {/* SVG, not a styled div: the Content Security Policy blocks inline style attributes. */}
          <svg viewBox="0 0 100 4" preserveAspectRatio="none" className="mt-1 h-2.5 w-full rounded-full" aria-hidden>
            <rect width={100} height={4} className="fill-surface-sunken" />
            <rect width={Math.max(2, (b.value / chart.max) * 100)} height={4} className="fill-accent" />
          </svg>
        </li>
      ))}
      <li className="text-xs text-ink-muted">{chart.value_label}</li>
    </ul>
  )
}
