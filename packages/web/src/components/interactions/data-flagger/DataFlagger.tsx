'use client'
import { Fragment, useEffect, useState } from 'react'
import { assetUrl, type InteractionProps, type ColumnSpec } from '../types'

interface DataFlaggerConfig {
  instructions: string
  dataset_ref: string
  rows_key: string
  row_id_column: string
  columns: ColumnSpec[]
  categories: { id: string; label: string }[]
  flags_field: string
  submit_label?: string
}

type Row = Record<string, unknown>

/**
 * B6. A dataset to clean: flag any row with a problem and say what kind.
 * The table scrolls sideways on a phone; the row number and the flag control
 * stay pinned on the left.
 */
export function DataFlagger({ challengeId, config: rawConfig, onSubmit, submitting, disabled }: InteractionProps) {
  const config = rawConfig as unknown as DataFlaggerConfig
  const [rows, setRows] = useState<Row[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [flags, setFlags] = useState<Readonly<Record<string, string>>>({})
  const [openId, setOpenId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(assetUrl(challengeId, config.dataset_ref))
      .then((res) => {
        if (!res.ok) throw new Error('load failed')
        return res.json() as Promise<Record<string, Row[]>>
      })
      .then((data) => { if (!cancelled) setRows(data[config.rows_key] ?? []) })
      .catch(() => { if (!cancelled) setLoadError('The dataset could not be loaded. Refresh and try again.') })
    return () => { cancelled = true }
  }, [challengeId, config.dataset_ref, config.rows_key])

  const label = (id: string) => config.categories.find((c) => c.id === id)?.label ?? id
  const flag = (id: string, category: string) => { setFlags((p) => ({ ...p, [id]: category })); setOpenId(null) }
  const unflag = (id: string) => {
    setFlags((p) => Object.fromEntries(Object.entries(p).filter(([k]) => k !== id)))
    setOpenId(null)
  }

  if (loadError) return <p role="alert" className="card text-sm font-medium text-danger">{loadError}</p>
  if (!rows) return <p className="card text-sm text-ink-muted">Loading the dataset…</p>
  const count = Object.keys(flags).length

  return (
    <div className="space-y-6">
      <p className="rounded-lg bg-accent-soft px-4 py-3 text-sm text-ink">{config.instructions.trim()}</p>

      <section className="card">
        <p className="mb-3 text-sm text-ink-muted">
          <span className="sm:hidden">Swipe the table sideways to see every column. </span>
          {rows.length} rows. You have flagged {count}.
        </p>
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
          <table className="min-w-full border-collapse text-sm tabular-nums">
            <thead>
              <tr className="border-b border-line text-left">
                <th scope="col" className="sticky left-0 z-10 bg-surface p-2 font-semibold">Row</th>
                {config.columns.map((c) => (
                  <th key={c.key} scope="col" className="whitespace-nowrap p-2 font-semibold">{c.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const id = String(row[config.row_id_column])
                const flagged = flags[id]
                return (
                  <Fragment key={id}>
                    <tr className={`border-b border-line/60 ${flagged ? 'bg-danger-soft' : ''}`}>
                      <th scope="row" className={`sticky left-0 p-1.5 text-left ${flagged ? 'bg-danger-soft' : 'bg-surface'}`}>
                        <button
                          type="button"
                          disabled={disabled}
                          aria-expanded={openId === id}
                          onClick={() => setOpenId(openId === id ? null : id)}
                          className={`whitespace-nowrap rounded-md border px-2 py-1 text-xs font-semibold ${
                            flagged ? 'border-danger bg-danger text-on-danger' : 'border-line bg-surface text-ink hover:border-accent'
                          }`}
                        >
                          {id}{flagged ? ` · ${label(flagged)}` : ' · Flag'}
                        </button>
                      </th>
                      {config.columns.map((c) => (
                        <td key={c.key} className="whitespace-nowrap p-2 text-ink">
                          {c.type === 'boolean' ? (row[c.key] ? 'Yes' : 'No') : String(row[c.key] ?? '—')}
                        </td>
                      ))}
                    </tr>
                    {openId === id && !disabled && (
                      <tr className="bg-surface-sunken">
                        <td colSpan={config.columns.length + 1} className="p-2">
                          <p className="sticky left-2 mb-1.5 text-xs font-semibold text-ink-muted">What is wrong with row {id}?</p>
                          <div className="sticky left-2 flex flex-wrap gap-1.5">
                            {config.categories.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                aria-pressed={flagged === c.id}
                                onClick={() => flag(id, c.id)}
                                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                                  flagged === c.id ? 'border-danger bg-danger text-on-danger' : 'border-line bg-surface text-ink hover:border-danger'
                                }`}
                              >
                                {c.label}
                              </button>
                            ))}
                            {flagged && (
                              <button
                                type="button"
                                onClick={() => unflag(id)}
                                className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs font-semibold text-ink-muted"
                              >
                                Remove flag
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-muted">
          {count} {count === 1 ? 'row' : 'rows'} flagged.
        </p>
        <button
          className="btn-primary"
          disabled={count === 0 || submitting || disabled}
          onClick={() => onSubmit({ [config.flags_field]: Object.entries(flags).map(([id, category]) => ({ id, category })) })}
        >
          {submitting ? 'Checking…' : (config.submit_label ?? 'Submit my findings')}
        </button>
      </section>
    </div>
  )
}
