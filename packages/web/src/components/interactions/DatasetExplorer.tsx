'use client'
import { useMemo, useState } from 'react'
import type { ColumnSpec } from './types'

type Row = Record<string, unknown>
type Filter = 'all' | 'flagged' | 'not_flagged' | 'confirmed' | 'missed'

/** Filter labels are content: each challenge names its own condition and tool. */
export type FilterLabels = Record<Filter, string>

const DEFAULT_FILTER_LABELS: FilterLabels = {
  all: 'All patients',
  confirmed: 'Condition confirmed',
  flagged: 'Flagged by the tool',
  not_flagged: 'Not flagged',
  missed: 'Confirmed but not flagged',
}

const FILTER_ORDER: Filter[] = ['all', 'confirmed', 'flagged', 'not_flagged', 'missed']

const PAGE_SIZE = 25

function cellText(value: unknown, type: ColumnSpec['type']): string {
  if (value === null || value === undefined) return '—'
  if (type === 'boolean') return value ? 'Yes' : 'No'
  return String(value)
}

/**
 * Sortable, filterable patient table. The learner is meant to browse it, spot
 * the missed patients, and reach the confusion matrix on their own.
 */
export function DatasetExplorer({
  rows,
  columns,
  truthColumn,
  predictionColumn,
  filterLabels,
}: {
  rows: Row[]
  columns: ColumnSpec[]
  truthColumn: string
  predictionColumn: string
  filterLabels?: Partial<FilterLabels>
}) {
  const labels = { ...DEFAULT_FILTER_LABELS, ...filterLabels }
  const [filter, setFilter] = useState<Filter>('all')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDesc, setSortDesc] = useState(true)
  const [page, setPage] = useState(0)

  const filtered = useMemo(() => {
    const matches = (row: Row) => {
      const truth = Boolean(row[truthColumn])
      const predicted = Boolean(row[predictionColumn])
      switch (filter) {
        case 'flagged': return predicted
        case 'not_flagged': return !predicted
        case 'confirmed': return truth
        case 'missed': return truth && !predicted
        default: return true
      }
    }
    const out = rows.filter(matches)
    if (!sortKey) return out

    return [...out].sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      if (typeof av === 'number' && typeof bv === 'number') return sortDesc ? bv - av : av - bv
      return sortDesc
        ? String(bv).localeCompare(String(av))
        : String(av).localeCompare(String(bv))
    })
  }, [rows, filter, sortKey, sortDesc, truthColumn, predictionColumn])

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const safePage = Math.min(page, pageCount - 1)
  const visible = filtered.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE)

  function toggleSort(key: string) {
    if (sortKey === key) setSortDesc((d) => !d)
    else { setSortKey(key); setSortDesc(true) }
    setPage(0)
  }

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {FILTER_ORDER.map((id) => (
          <button
            key={id}
            onClick={() => { setFilter(id); setPage(0) }}
            aria-pressed={filter === id}
            className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
              filter === id
                ? 'border-accent bg-accent text-on-accent'
                : 'border-line bg-surface text-ink-muted hover:border-accent'
            }`}
          >
            {labels[id]}
          </button>
        ))}
      </div>

      <p className="mt-3 text-sm text-ink-muted">
        <span className="sm:hidden">Swipe the table sideways to see every column. </span>
        {filtered.length} {filtered.length === 1 ? 'patient' : 'patients'}
        {filter !== 'all' && ` (of ${rows.length})`}
      </p>

      <div className="mt-3 -mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
        <table className="min-w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left">
              {columns.map((col, c) => (
                <th
                  key={col.key}
                  scope="col"
                  className={`whitespace-nowrap p-2 font-semibold ${c === 0 ? 'sticky left-0 z-10 bg-surface' : ''}`}
                >
                  <button
                    onClick={() => toggleSort(col.key)}
                    className="inline-flex items-center gap-1 hover:text-accent"
                  >
                    {col.label}
                    {sortKey === col.key && <span aria-hidden>{sortDesc ? '↓' : '↑'}</span>}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => (
              <tr key={String(row.patient_id ?? i)} className="border-b border-line/60">
                {columns.map((col, c) => (
                  <td
                    key={col.key}
                    className={`whitespace-nowrap p-2 tabular-nums text-ink-muted ${
                      c === 0 ? 'sticky left-0 bg-surface font-medium text-ink' : ''
                    }`}
                  >
                    {cellText(row[col.key], col.type)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 && (
        <div className="mt-3 flex items-center justify-between gap-3">
          <button className="btn-secondary" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage === 0}>
            Previous
          </button>
          <span className="text-sm text-ink-muted">Page {safePage + 1} of {pageCount}</span>
          <button
            className="btn-secondary"
            onClick={() => setPage((p) => Math.min(pageCount - 1, p + 1))}
            disabled={safePage >= pageCount - 1}
          >
            Next
          </button>
        </div>
      )}
    </div>
  )
}
