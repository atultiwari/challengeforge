import type { MetricTargetRule } from './schema'
import type { Validator } from './types'
import { readField, parseLearnerNumber } from '../payload'
import type { DatasetRow } from './types'

interface Performance {
  sensitivity: number
  specificity: number
}

/** A row is flagged when its score is at or above the threshold - the same rule the slider shows. */
export function performanceAt(rows: readonly DatasetRow[], rule: MetricTargetRule, threshold: number): Performance {
  let tp = 0, fp = 0, fn = 0, tn = 0
  for (const row of rows) {
    const positive = row[rule.truth_column] === true
    const flagged = Number(row[rule.score_column]) >= threshold
    if (positive && flagged) tp += 1
    else if (positive) fn += 1
    else if (flagged) fp += 1
    else tn += 1
  }
  return { sensitivity: tp + fn === 0 ? 0 : tp / (tp + fn), specificity: tn + fp === 0 ? 0 : tn / (tn + fp) }
}

/** The best specificity any threshold achieves while meeting the target, or null if none can. */
export function bestSpecificityAtTarget(rows: readonly DatasetRow[], rule: MetricTargetRule): number | null {
  const thresholds = [...new Set(rows.map((r) => Number(r[rule.score_column])))].filter(Number.isFinite)
  let best: number | null = null
  for (const t of thresholds) {
    const p = performanceAt(rows, rule, t)
    if (p.sensitivity >= rule.min_sensitivity && (best === null || p.specificity > best)) best = p.specificity
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
