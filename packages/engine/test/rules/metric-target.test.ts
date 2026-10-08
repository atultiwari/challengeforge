import { describe, it, expect } from 'vitest'
import { validateMetricTarget, performanceAt, bestSpecificityAtTarget } from '../../src/rules/metric-target'
import { evaluateRule } from '../../src/rules'
import type { MetricTargetRule } from '../../src/rules/schema'
import { ctx } from './helpers'

/**
 * Synthetic cohort: 10 positives scored 0.50..0.95 and 90 negatives scored
 * 0.00..0.89. At >= 90% sensitivity the best threshold is 0.55 (9 of 10 caught).
 */
const positives = Array.from({ length: 10 }, (_, i) => ({ score: 0.5 + i * 0.05, outcome: true }))
const negatives = Array.from({ length: 90 }, (_, i) => ({ score: Math.round(i) / 100, outcome: false }))
const rows = [...positives, ...negatives].map((r) => ({ ...r, score: Math.round(r.score * 100) / 100 }))

const rule: MetricTargetRule = {
  type: 'metric_target',
  field: 'threshold',
  dataset_ref: 'cohort.json',
  score_column: 'score',
  truth_column: 'outcome',
  min_sensitivity: 0.9,
  max_specificity_gap: 0.03,
}

const loadDataset = async (ref: string) => {
  if (ref !== 'cohort.json') throw new Error(`no dataset ${ref}`)
  return rows
}
const at = (threshold: unknown) => validateMetricTarget(rule, { threshold }, ctx({ loadDataset }))

describe('metric_target validator', () => {
  it('passes at the best threshold, and a little below it', async () => {
    expect((await at(0.55)).passed).toBe(true)
    expect((await at('0.54')).passed).toBe(true)
  })

  it('fails a threshold that misses the sensitivity target, and says by how much', async () => {
    const r = await at(0.8)
    expect(r.passed).toBe(false)
    expect(r.message).toContain('40%')
  })

  it('fails a threshold that meets the target by alerting on almost everyone', async () => {
    const r = await at(0.05)
    expect(r.passed).toBe(false)
    expect(r.message).toMatch(/more alerts than it needs/)
  })

  it('refuses nonsense thresholds', async () => {
    for (const bad of [undefined, 'abc', -0.1, 1.5, null]) expect((await at(bad)).passed).toBe(false)
  })

  it('fails closed when the dataset cannot be loaded', async () => {
    const broken = { ...rule, dataset_ref: 'missing.json' }
    expect((await validateMetricTarget(broken, { threshold: 0.55 }, ctx({ loadDataset }))).passed).toBe(false)
  })

  it('fails closed when no dataset loader is provided', async () => {
    expect((await validateMetricTarget(rule, { threshold: 0.55 }, ctx())).passed).toBe(false)
  })

  it('fails closed when no threshold can reach the target', async () => {
    expect(bestSpecificityAtTarget([{ s: 0.5, y: false }], { ...rule, score_column: 's', truth_column: 'y' })).toBeNull()
    const impossible = async () => [{ score: 0.5, outcome: false }]
    expect((await validateMetricTarget(rule, { threshold: 0.5 }, ctx({ loadDataset: impossible }))).passed).toBe(false)
  })

  it('fails closed when any row has a missing or non-numeric score', async () => {
    const holes = async () => [...rows, { score: null, outcome: false }]
    expect((await validateMetricTarget(rule, { threshold: 0.55 }, ctx({ loadDataset: holes }))).passed).toBe(false)
  })

  it('finds the best specificity in one sweep on a large dataset', () => {
    const big = Array.from({ length: 20_000 }, (_, i) => ({ score: (i % 1000) / 1000, outcome: i % 10 === 0 }))
    const started = Date.now()
    expect(bestSpecificityAtTarget(big, rule)).not.toBeNull()
    expect(Date.now() - started).toBeLessThan(500)
  })

  it('computes performance with "score at or above the threshold" flagged', () => {
    const sample = [{ s: 0.5, y: true }, { s: 0.4, y: true }, { s: 0.5, y: false }, { s: 0.1, y: false }]
    const r = { ...rule, score_column: 's', truth_column: 'y' }
    expect(performanceAt(sample, r, 0.5)).toEqual({ sensitivity: 0.5, specificity: 0.5 })
  })

  it('is reachable through evaluateRule', async () => {
    expect((await evaluateRule(rule, { threshold: 0.55 }, ctx({ loadDataset }))).correct).toBe(true)
  })
})
