import { describe, it, expect } from 'vitest'
import { coverage, avoided, before, efficiency, type TrajectoryStep } from '../src/trajectory'

const step = (seq: number, kind: string, target: string, time = seq * 5): TrajectoryStep => ({ seq, kind, target, time })

// A short work-up: three history questions, an exam, two investigations, then a drug.
const path: TrajectoryStep[] = [
  step(1, 'ask', 'h_onset'),
  step(2, 'ask', 'h_insulin'),
  step(3, 'ask', 'h_vomit'),
  step(4, 'examine', 'e_breath'),
  step(5, 'order', 'i_glucose'),
  step(6, 'order', 'i_ct_head'),
  step(7, 'order', 'i_potassium', 40),
  step(8, 'treat', 'm_insulin', 50),
]
const labels = { h_allergy: 'Allergies', i_ct_head: 'CT head', m_bicarb: 'IV bicarbonate' }

describe('coverage', () => {
  const spec = { id: 'hx', label: 'Essential history', weight: 20, kinds: ['ask'], required: ['h_onset', 'h_insulin', 'h_vomit', 'h_allergy'] }

  it('scores in proportion to the required items covered', () => {
    expect(coverage({ ...spec, min: 3 }, path)).toMatchObject({ score: 15, max: 20, passed: true })
  })

  it('fails below the minimum', () => {
    expect(coverage({ ...spec, min: 4 }, path).passed).toBe(false)
  })

  it('names what was missed, by label, for the debrief', () => {
    expect(coverage({ ...spec, min: 4, labels }, path).feedback).toContain('Allergies')
  })

  it('only counts steps of the given kinds', () => {
    expect(coverage({ ...spec, kinds: ['order'], min: 1 }, path).score).toBe(0)
  })

  it('counts a repeated item once', () => {
    const repeated = [...path, step(9, 'ask', 'h_onset')]
    expect(coverage({ ...spec, min: 1 }, repeated).score).toBe(15)
  })
})

describe('avoided', () => {
  it('passes and keeps its weight when nothing forbidden was done', () => {
    expect(avoided({ id: 'harm', label: 'No harmful drugs', weight: 5, forbidden: ['m_bicarb'] }, path)).toMatchObject({ passed: true, score: 5 })
  })

  it('fails, scores zero and is critical when flagged so', () => {
    const r = avoided({ id: 'harm', label: 'No unnecessary radiation', weight: 5, forbidden: ['i_ct_head'], critical: true, labels }, path)
    expect(r).toMatchObject({ passed: false, score: 0, critical: true })
    expect(r.feedback).toContain('CT head')
  })
})

describe('before', () => {
  it('passes when the first item precedes the second', () => {
    expect(before({ id: 'k', label: 'K before insulin', weight: 10, first: 'i_potassium', then: 'm_insulin' }, path).passed).toBe(true)
  })

  it('fails when the order is reversed', () => {
    expect(before({ id: 'k', label: 'x', weight: 10, first: 'm_insulin', then: 'i_potassium' }, path).passed).toBe(false)
  })

  it('fails when the second happens and the first never does', () => {
    expect(before({ id: 'k', label: 'x', weight: 10, first: 'i_ketones', then: 'm_insulin' }, path).passed).toBe(false)
  })

  it('passes vacuously when neither happens, unless the first is required', () => {
    const spec = { id: 'k', label: 'x', weight: 10, first: 'i_ketones', then: 'm_fluids' }
    expect(before(spec, path).passed).toBe(true)
    expect(before({ ...spec, required: true }, path).passed).toBe(false)
  })

  it('supports a deadline in simulated time', () => {
    expect(before({ id: 't', label: 'Glucose within 30 min', weight: 10, first: 'i_glucose', byTime: 30 }, path).passed).toBe(true)
    expect(before({ id: 't', label: 'K within 30 min', weight: 10, first: 'i_potassium', byTime: 30 }, path).passed).toBe(false)
    expect(before({ id: 't', label: 'Ketones within 30 min', weight: 10, first: 'i_ketones', byTime: 30 }, path).passed).toBe(false)
  })

  it('can be critical', () => {
    expect(before({ id: 'k', label: 'x', weight: 0, first: 'm_insulin', then: 'i_potassium', critical: true }, path)).toMatchObject({
      critical: true,
      passed: false,
    })
  })
})

describe('efficiency', () => {
  const spec = { id: 'eff', label: 'Avoids unnecessary tests', weight: 10, counted: ['i_ct_head', 'i_lipase'], maxAllowed: 0 }

  it('deducts per unnecessary item beyond the allowance', () => {
    expect(efficiency(spec, path)).toMatchObject({ score: 7.5, passed: false })
    expect(efficiency({ ...spec, penaltyPerExtra: 4 }, path).score).toBe(6)
  })

  it('passes within the allowance', () => {
    expect(efficiency({ ...spec, maxAllowed: 1 }, path)).toMatchObject({ score: 10, passed: true })
  })

  it('never goes below zero', () => {
    const many = [step(1, 'order', 'i_ct_head'), step(2, 'order', 'i_lipase')]
    expect(efficiency({ ...spec, penaltyPerExtra: 100 }, many).score).toBe(0)
  })
})
