'use client'
import { useState } from 'react'
import { buildConfusionMatrix, type ConfusionMatrix } from '@/lib/metrics'

type CellKey = keyof ConfusionMatrix

/** Cell descriptions come from the challenge content, e.g. "Had a PE, and EmboScan flagged them". */
export interface MatrixCellLabels {
  true_positives: string
  false_positives: string
  false_negatives: string
  true_negatives: string
}

const CELLS: { key: CellKey; label: string; contentKey: keyof MatrixCellLabels }[] = [
  { key: 'truePositives', label: 'True positives', contentKey: 'true_positives' },
  { key: 'falsePositives', label: 'False positives', contentKey: 'false_positives' },
  { key: 'falseNegatives', label: 'False negatives', contentKey: 'false_negatives' },
  { key: 'trueNegatives', label: 'True negatives', contentKey: 'true_negatives' },
]

/**
 * The learner reveals the four cells one at a time. Nothing is computed for
 * them beyond the counts - working out the metric is the challenge.
 */
export function ConfusionMatrixBuilder({
  rows,
  truthColumn,
  predictionColumn,
  intro,
  cellLabels,
}: {
  rows: Record<string, unknown>[]
  truthColumn: string
  predictionColumn: string
  intro: string
  cellLabels: MatrixCellLabels
}) {
  const [revealed, setRevealed] = useState<Set<CellKey>>(new Set())
  const matrix = buildConfusionMatrix(rows, truthColumn, predictionColumn)

  return (
    <div>
      <p className="text-sm text-ink-muted">{intro}</p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {CELLS.map((cell) => {
          const isRevealed = revealed.has(cell.key)
          return (
            <div key={cell.key} className="rounded-lg border border-line bg-surface p-4">
              <div className="text-sm font-semibold text-ink">{cell.label}</div>
              <div className="mt-0.5 text-xs text-ink-muted">{cellLabels[cell.contentKey]}</div>

              {isRevealed ? (
                <div className="mt-3 text-3xl font-bold tabular-nums text-accent-dark">
                  {matrix[cell.key]}
                </div>
              ) : (
                <button
                  className="btn-secondary mt-3 w-full"
                  onClick={() => setRevealed((prev) => new Set(prev).add(cell.key))}
                >
                  Reveal count
                </button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
