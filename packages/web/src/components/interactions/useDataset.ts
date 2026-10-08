'use client'
import { useEffect, useState } from 'react'
import { assetUrl } from './types'

export type Row = Record<string, unknown>

/** Loads a challenge's declared dataset through the artifact route. */
export function useDataset(challengeId: string, ref: string): { rows: Row[] | null; error: string | null } {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch(assetUrl(challengeId, ref))
      .then((res) => {
        if (!res.ok) throw new Error('load failed')
        return res.json()
      })
      .then((json) => { if (!cancelled) setRows(json.patients ?? []) })
      .catch(() => { if (!cancelled) setError('The patient data could not be loaded. Refresh and try again.') })
    return () => { cancelled = true }
  }, [challengeId, ref])

  return { rows, error }
}

export interface Matrix {
  tp: number
  fp: number
  fn: number
  tn: number
}

export function confusion(rows: readonly Row[], isPositive: (r: Row) => boolean, isFlagged: (r: Row) => boolean): Matrix {
  const m = { tp: 0, fp: 0, fn: 0, tn: 0 }
  for (const r of rows) {
    const pos = isPositive(r), flag = isFlagged(r)
    if (pos && flag) m.tp += 1
    else if (pos) m.fn += 1
    else if (flag) m.fp += 1
    else m.tn += 1
  }
  return m
}

export const ratio = (n: number, d: number): string => (d === 0 ? '—' : `${(Math.round((n / d) * 1000) / 10).toFixed(1)}%`)
