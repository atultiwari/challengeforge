import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createChallenge, performAction, publish, putAsset, startOrResume } from '../src'
import { freshDb, registry, setupSite, type TestDb } from './harness'

/** A synthetic threshold mission: metric_target recomputes performance from the challenge's own dataset asset. */
const positives = Array.from({ length: 10 }, (_, i) => ({ score: Math.round((0.5 + i * 0.05) * 100) / 100, outcome: true }))
const negatives = Array.from({ length: 90 }, (_, i) => ({ score: i / 100, outcome: false }))
const cohort = { patients: [...positives, ...negatives] }

const thresholdMission = {
  title: 'Pick a threshold (synthetic)',
  interaction: 'threshold_slider',
  interaction_config: { dataset_ref: 'artifacts/t/cohort.json' },
  rule: {
    type: 'metric_target',
    field: 'threshold',
    dataset_ref: 'artifacts/t/cohort.json',
    score_column: 'score',
    truth_column: 'outcome',
    min_sensitivity: 0.9,
    max_specificity_gap: 0.03,
  },
  scoring: { base_points: 100 },
  debrief: 'Done.',
}

let t: TestDb
let s: Awaited<ReturnType<typeof setupSite>>
let withData: string
let withoutData: string
const deps = { registry }

beforeAll(async () => {
  t = await freshDb()
  s = await setupSite(t.db)
  withData = await createChallenge(t.db, s.admin, registry, { slug: 'thr', typeId: 'lab-legacy', typeVersion: 1, definition: thresholdMission })
  await putAsset(t.db, s.admin, { challengeId: withData, path: 'artifacts/t/cohort.json', contentType: 'application/json', visibility: 'public', bytes: Buffer.from(JSON.stringify(cohort)) })
  await publish(t.db, s.admin, withData)
  withoutData = await createChallenge(t.db, s.admin, registry, { slug: 'thr-nodata', typeId: 'lab-legacy', typeVersion: 1, definition: thresholdMission })
  await publish(t.db, s.admin, withoutData)
})
afterAll(async () => t.close())

describe('dataset-backed rules', () => {
  it('grades a threshold against the challenge\'s own dataset', async () => {
    const { attemptId } = await startOrResume(t.db, s.learner, deps, withData)
    const wrong = await performAction(t.db, s.learner, deps, attemptId, { kind: 'submit', payload: { threshold: 0.8 } })
    expect(wrong).toMatchObject({ ok: true, snapshot: { status: 'open' } })
    const right = await performAction(t.db, s.learner, deps, attemptId, { kind: 'submit', payload: { threshold: 0.55 } })
    expect(right).toMatchObject({ ok: true, snapshot: { status: 'terminal', assessment: { passed: true } } })
  })

  it('fails closed when the dataset belongs to another challenge (or is missing)', async () => {
    const { attemptId } = await startOrResume(t.db, s.learner, deps, withoutData)
    const r = await performAction(t.db, s.learner, deps, attemptId, { kind: 'submit', payload: { threshold: 0.55 } })
    expect(r).toMatchObject({ ok: true, snapshot: { status: 'open' } })
  })
})
