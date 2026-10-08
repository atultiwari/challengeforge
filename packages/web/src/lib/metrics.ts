/**
 * Confusion-matrix arithmetic, shared by the dashboard and by tests.
 * Pure functions - no answers, no secrets, safe on the client.
 */
export interface ConfusionMatrix {
  truePositives: number
  falsePositives: number
  falseNegatives: number
  trueNegatives: number
}

export interface CohortRow {
  [key: string]: unknown
}

export function buildConfusionMatrix(
  rows: CohortRow[],
  truthColumn: string,
  predictionColumn: string,
): ConfusionMatrix {
  const matrix = { truePositives: 0, falsePositives: 0, falseNegatives: 0, trueNegatives: 0 }
  for (const row of rows) {
    const truth = Boolean(row[truthColumn])
    const predicted = Boolean(row[predictionColumn])
    if (truth && predicted) matrix.truePositives += 1
    else if (!truth && predicted) matrix.falsePositives += 1
    else if (truth && !predicted) matrix.falseNegatives += 1
    else matrix.trueNegatives += 1
  }
  return matrix
}

/** Percentage to one decimal place, or null when the denominator is zero. */
export function ratePercent(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null
  return Math.round((numerator / denominator) * 1000) / 10
}

export function accuracyPercent(m: ConfusionMatrix): number | null {
  const total = m.truePositives + m.falsePositives + m.falseNegatives + m.trueNegatives
  return ratePercent(m.truePositives + m.trueNegatives, total)
}
