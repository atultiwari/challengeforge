import type { MetricTargetRule } from './schema'
import type { Validator } from './types'
import { readField, parseLearnerNumber } from '../payload'
import type { DatasetRow } from './types'

interface Performance {
  sensitivity: number
  specificity: number
}

/** A score must be a real number; null, "" and strings never silently become 0. */
function scoreOf(row: DatasetRow, column: string): number | null {
  const v = row[column]
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

/** True when every row has a usable score, so the server's recomputation can be trusted. */
export function hasValidScores(rows: readonly DatasetRow[], rule: MetricTargetRule): boolean {
  return rows.every((r) => scoreOf(r, rule.score_column) !== null)
}

/** A row is flagged when its score is at or above the threshold - the same rule the slider shows. */
export function performanceAt(rows: readonly DatasetRow[], rule: MetricTargetRule, threshold: number): Performance {
  let tp = 0, fp = 0, fn = 0, tn = 0
  for (const row of rows) {
    const positive = row[rule.truth_column] === true
    const score = scoreOf(row, rule.score_column)
    const flagged = score !== null && score >= threshold
    if (positive && flagged) tp += 1
    else if (positive) fn += 1
    else if (flagged) fp += 1
    else tn += 1
  }
  return { sensitivity: tp + fn === 0 ? 0 : tp / (tp + fn), specificity: tn + fp === 0 ? 0 : tn / (tn + fp) }
}

/**
 * The best specificity any threshold achieves while meeting the target, or
 * null if none can. One sort and one sweep from the highest score down, so a
 * large dataset costs O(n log n) per submission rather than O(n^2).
 */
export function bestSpecificityAtTarget(rows: readonly DatasetRow[], rule: MetricTargetRule): number | null {
  if (!hasValidScores(rows, rule)) return null
  const scored = rows
    .map((r) => ({ score: scoreOf(r, rule.score_column) as number, positive: r[rule.truth_column] === true }))
    .sort((a, b) => b.score - a.score)
  const positives = scored.filter((r) => r.positive).length
  const negatives = scored.length - positives
  let tp = 0
  let fp = 0
  let best: number | null = null
  for (let i = 0; i < scored.length; i += 1) {
    const row = scored[i] as { score: number; positive: boolean }
    if (row.positive) tp += 1
    else fp += 1
    // Only evaluate once every row sharing this score has been counted.
    if (i + 1 < scored.length && scored[i + 1]?.score === row.score) continue
    const sensitivity = positives === 0 ? 0 : tp / positives
    const specificity = negatives === 0 ? 0 : (negatives - fp) / negatives
    if (sensitivity >= rule.min_sensitivity && (best === null || specificity > best)) best = specificity
  }
  return best
}

const pct = (x: number) => `${Math.round(x * 1000) / 10}%`

export const validateMetricTarget: Validator<MetricTargetRule> = async (rule, payload, ctx) => {
  const threshold = parseLearnerNumber(readField(payload, rule.field))
  if (threshold === null || threshold < 0 || threshold > 1) {
    return { passed: false, message: 'Choose a threshold between 0 and 1.' }
  }

  // Datasets are injected so the engine never touches the filesystem. A
  // missing loader fails closed like a missing file.
  if (!ctx.loadDataset) return { passed: false, message: 'Your threshold could not be checked. Please try again.' }
  let rows: readonly DatasetRow[]
  try {
    rows = await ctx.loadDataset(rule.dataset_ref)
  } catch {
    return { passed: false, message: 'Your threshold could not be checked. Please try again.' }
  }
  const best = bestSpecificityAtTarget(rows, rule)
  if (best === null) return { passed: false, message: 'Your threshold could not be checked. Please try again.' }

  const p = performanceAt(rows, rule, threshold)
  if (p.sensitivity < rule.min_sensitivity) {
    return {
      passed: false,
      message: `At ${threshold} the score catches ${pct(p.sensitivity)} of the positive cases - short of the ${pct(rule.min_sensitivity)} target.`,
    }
  }
  if (p.specificity < best - rule.max_specificity_gap - 1e-9) {
    return {
      passed: false,
      message: 'That meets the target, but fires more alerts than it needs to. How high can the threshold go before you drop below the target?',
    }
  }
  return { passed: true, message: 'Correct - that is the highest threshold that still meets the target.' }
}
