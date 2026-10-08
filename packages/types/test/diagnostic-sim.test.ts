import { describe, it, expect } from 'vitest'
import { startAttempt, act, assess, replay, pointsFor, type AttemptEvent } from '@challengeforge/engine'
import { diagnosticSim, type DiagnosticSimDef } from '../src/diagnostic-sim'
import caseJson from '../fixtures/diagnostic-sim/dka-young-adult.json'

const def: DiagnosticSimDef = diagnosticSim.definitionSchema.parse(caseJson)
const ctx = { attemptId: 'att-d1', userId: 'u1', challengeId: 'dka-young-adult', seed: 7 }
const T0 = Date.parse('2026-10-08T22:40:00.000Z')

type Step = Record<string, unknown>

/** Plays a list of actions; every one must be accepted. */
async function play(actions: Step[]) {
  let { attempt, view } = startAttempt(diagnosticSim, def, ctx)
  const events: AttemptEvent[] = []
  for (const [i, action] of actions.entries()) {
    const r = await act(diagnosticSim, def, attempt, action, { services: {}, at: new Date(T0 + i * 1000).toISOString() })
    if (!r.ok) throw new Error(`action ${i} (${JSON.stringify(action)}) failed: ${r.error.typeCode ?? r.error.code}`)
    attempt = r.attempt
    view = r.view
    events.push(r.event)
  }
  return { attempt, view, events }
}

/** search-then-act, the way the player UI does it. */
const find = (category: string, query: string): Step => ({ kind: 'search', category, query })
const ask = (q: string, item: string): Step[] => [find('history', q), { kind: 'ask', item }]
const examine = (q: string, item: string): Step[] => [find('examination', q), { kind: 'examine', item }]
const order = (q: string, item: string): Step[] => [find('investigations', q), { kind: 'order', item }]
const treat = (q: string, item: string): Step[] => [find('treatments', q), { kind: 'treat', item }]

/** A competent work-up, roughly the model pathway. */
const GOOD_PATH: Step[] = [
  ...ask('diabetes', 'h_diabetes'),
  ...ask('insulin', 'h_insulin'),
  ...ask('thirst', 'h_polyuria'),
  ...ask('burning', 'h_infection'),
  ...ask('pregnant', 'h_pregnancy'),
  ...ask('how long', 'h_onset'),
  ...examine('hydration', 'e_hydration'),
  ...examine('breathing', 'e_respiratory'),
  ...examine('abdomen', 'e_abdomen'),
  ...order('glucose', 'i_cbg'),
  ...order('ketones', 'i_ketones'),
  ...order('blood gas', 'i_vbg'),
  ...treat('saline', 'm_fluids'),
  ...order('urea', 'i_ue'),
  ...order('hcg', 'i_hcg'),
  { kind: 'advance_time', minutes: 10 },
  ...treat('insulin infusion', 'm_frii'),
  ...treat('potassium', 'm_potassium'),
  ...treat('glargine', 'm_basal'),
  { kind: 'record_differential', terms: ['HHS', 'urinary tract infection', 'pancreatitis'] },
  { kind: 'submit_diagnosis', text: 'Diabetic ketoacidosis' },
]

describe('authoring: the doctor-shaped case is valid data', () => {
  it('parses against the type schema', () => {
    expect(def.history.length).toBeGreaterThan(5)
    expect(def.review.status).toBe('draft')
  })

  it('passes lint', () => {
    expect(diagnosticSim.lint(def)).toEqual([])
  })

  it('lint catches the mistakes an author is likely to make', () => {
    const broken: DiagnosticSimDef = {
      ...def,
      history: [...def.history, { ...def.history[0]!, label: 'Duplicate' }],
      events: [{ ...def.events[0]!, unless_done: ['m_does_not_exist'] }],
      rubric: {
        ...def.rubric,
        min_history: 99,
        ordering: [{ id: 'x', label: 'x', first: ['i_nope'], then: 'm_frii', weight: 1 }],
      },
    }
    const paths = diagnosticSim.lint(broken).map((i) => i.path)
    expect(paths).toEqual(expect.arrayContaining(['history.12.id', 'events.0.unless_done', 'rubric.min_history', 'rubric.ordering.0.first']))
  })
})

describe('play: search-to-reveal and progressive disclosure', () => {
  it('starts with the presentation only', () => {
    const { view } = startAttempt(diagnosticSim, def, ctx)
    expect(view.presentation.chief_complaint).toContain('Vomiting')
    expect(view.history).toEqual([])
    expect(view.clock).toBe(0)
  })

  it('search shows matching labels, never responses, results or tags', async () => {
    const { view } = await play([find('investigations', 'blood gas')])
    expect(view.search?.results).toEqual([{ id: 'i_vbg', label: 'Venous blood gas' }])
    expect(JSON.stringify(view)).not.toContain('7.12')
  })

  it('an item cannot be acted on until a search has surfaced it', async () => {
    const { attempt } = startAttempt(diagnosticSim, def, ctx)
    const r = await act(diagnosticSim, def, attempt, { kind: 'ask', item: 'h_insulin' }, { services: {}, at: new Date(T0).toISOString() })
    expect(r).toMatchObject({ ok: false, error: { code: 'rejected', typeCode: 'not_discovered' } })
  })

  it('rejects unknown items, wrong categories and repeats', async () => {
    const { attempt } = await play(ask('insulin', 'h_insulin'))
    const env = { services: {}, at: new Date(T0).toISOString() }
    expect(await act(diagnosticSim, def, attempt, { kind: 'ask', item: 'h_insulin' }, env)).toMatchObject({ error: { typeCode: 'already_done' } })
    expect(await act(diagnosticSim, def, attempt, { kind: 'order', item: 'h_insulin' }, env)).toMatchObject({ error: { typeCode: 'not_discovered' } })
  })

  it('answers questions and advances the simulated clock', async () => {
    const { view } = await play([...ask('insulin', 'h_insulin'), ...examine('breathing', 'e_respiratory')])
    expect(view.history).toEqual([{ label: 'Have you been taking your insulin?', response: expect.stringContaining('stopped it') }])
    expect(view.examination[0]?.response).toContain('Kussmaul')
    expect(view.clock).toBe(5)
  })

  it('shows an investigation as pending until its turnaround has passed', async () => {
    const pending = await play(order('urea', 'i_ue'))
    expect(pending.view.investigations).toEqual([{ label: 'Urea and electrolytes', status: 'pending', readyAt: 61 }])
    const ready = await play([...order('urea', 'i_ue'), { kind: 'advance_time', minutes: 60 }])
    expect(ready.view.investigations[0]).toMatchObject({ status: 'ready', result: expect.stringContaining('K 5.6') })
  })

  it('the patient deteriorates at 60 minutes unless fluids were started', async () => {
    const neglected = await play([{ kind: 'advance_time', minutes: 61 }])
    expect(neglected.view.alerts).toHaveLength(1)
    expect(neglected.view.vitals['Blood pressure']).toBe('82/48 mmHg')

    const treated = await play([...treat('saline', 'm_fluids'), { kind: 'advance_time', minutes: 61 }])
    expect(treated.view.alerts).toEqual([])
    expect(treated.view.vitals['Blood pressure']).toBe('98/60 mmHg')
  })

  it('can gate investigations behind a working differential', async () => {
    const gated: DiagnosticSimDef = { ...def, gates: { differential_before_investigations: true } }
    let { attempt } = startAttempt(diagnosticSim, gated, ctx)
    const env = { services: {}, at: new Date(T0).toISOString() }
    const searched = await act(diagnosticSim, gated, attempt, find('investigations', 'glucose'), env)
    if (!searched.ok) throw new Error('expected ok')
    attempt = searched.attempt
    expect(await act(diagnosticSim, gated, attempt, { kind: 'order', item: 'i_cbg' }, env)).toMatchObject({ error: { typeCode: 'differential_required' } })
  })

  it('never leaks tags, reasons, the diagnosis or the debrief while the case is open', async () => {
    const { view } = await play(GOOD_PATH.slice(0, -1))
    const json = JSON.stringify(view).toLowerCase()
    for (const secret of ['essential', 'contraindicated', 'unnecessary', 'ketoacidosis', 'paradoxical', 'sick-day', 'model_pathway']) {
      expect(json).not.toContain(secret)
    }
  })

  it('ends on diagnosis, and only then shows the debrief and model pathway', async () => {
    const { attempt, view } = await play(GOOD_PATH)
    expect(attempt.status).toBe('terminal')
    expect(view.ended).toBe(true)
    expect(view.debrief).toContain('sick-day rule')
    expect(view.modelPathway?.length).toBeGreaterThan(3)
  })

  it('ends when the time budget runs out', async () => {
    const { attempt } = await play([{ kind: 'advance_time', minutes: 180 }])
    expect(attempt.status).toBe('terminal')
  })

  it('rejects malformed actions at the boundary', async () => {
    const { attempt } = startAttempt(diagnosticSim, def, ctx)
    const env = { services: {}, at: new Date(T0).toISOString() }
    for (const bad of [
      { kind: 'ask' },
      { kind: 'advance_time', minutes: 0 },
      { kind: 'search', category: 'pharmacy', query: 'x' },
      { kind: 'record_differential', terms: Array(20).fill('x') },
      { kind: 'submit_diagnosis', text: 'x'.repeat(500) },
    ]) {
      expect(await act(diagnosticSim, def, attempt, bad, env)).toMatchObject({ ok: false, error: { code: 'invalid_action' } })
    }
  })
})

describe('assessment: the reasoning path is graded, not just the answer', () => {
  it('a competent work-up passes with a high score', async () => {
    const { attempt, events } = await play(GOOD_PATH)
    const a = await assess(diagnosticSim, def, attempt, events, {})
    expect(a.passed).toBe(true)
    expect(a.criticalFailure).toBe(false)
    expect(a.score / a.max).toBeGreaterThan(0.85)
    expect(a.criteria.find((c) => c.id === 'diagnosis')).toMatchObject({ passed: true })
    expect(pointsFor(a, { basePoints: 100, hintCosts: [], hintIndicesUsed: [] })).toBeGreaterThan(85)
  })

  it('the right diagnosis by a careless path does not pass', async () => {
    const { attempt, events } = await play([{ kind: 'submit_diagnosis', text: 'DKA' }])
    const a = await assess(diagnosticSim, def, attempt, events, {})
    expect(a.criteria.find((c) => c.id === 'diagnosis')?.passed).toBe(true)
    expect(a.passed).toBe(false)
  })

  it('starting insulin before potassium is known is a critical failure', async () => {
    const reckless = [
      ...GOOD_PATH.slice(0, 18),
      ...treat('saline', 'm_fluids'),
      ...treat('insulin infusion', 'm_frii'),
      ...order('blood gas', 'i_vbg'),
      { kind: 'submit_diagnosis', text: 'DKA' },
    ]
    const { attempt, events } = await play(reckless)
    const a = await assess(diagnosticSim, def, attempt, events, {})
    expect(a.criticalFailure).toBe(true)
    expect(a.passed).toBe(false)
    expect(a.criteria.find((c) => c.id === 'k_before_insulin')?.feedback).toContain('Venous blood gas')
  })

  it('a contraindicated treatment is a critical failure, explained in the feedback', async () => {
    const harmful = [...GOOD_PATH.slice(0, -1), ...treat('bicarbonate', 'm_bicarbonate'), GOOD_PATH.at(-1)!]
    const { attempt, events } = await play(harmful)
    const a = await assess(diagnosticSim, def, attempt, events, {})
    expect(a.passed).toBe(false)
    expect(a.criteria.find((c) => c.id === 'safety')?.feedback).toContain('IV sodium bicarbonate')
  })

  it('over-investigation costs efficiency points but is not a failure on its own', async () => {
    const scanHappy = [...GOOD_PATH.slice(0, -1), ...order('ct head', 'i_ct_head'), GOOD_PATH.at(-1)!]
    const good = await play(GOOD_PATH)
    const extra = await play(scanHappy)
    const a = await assess(diagnosticSim, def, good.attempt, good.events, {})
    const b = await assess(diagnosticSim, def, extra.attempt, extra.events, {})
    expect(b.score).toBeLessThan(a.score)
    expect(b.passed).toBe(true)
  })

  it('a wrong diagnosis loses the diagnosis marks', async () => {
    const wrongDx = [...GOOD_PATH.slice(0, -1), { kind: 'submit_diagnosis', text: 'gastroenteritis' }]
    const { attempt, events } = await play(wrongDx)
    const a = await assess(diagnosticSim, def, attempt, events, {})
    expect(a.criteria.find((c) => c.id === 'diagnosis')).toMatchObject({ passed: false, score: 0 })
  })

  it('credits recorded differentials by accepted synonyms', async () => {
    const { attempt, events } = await play(GOOD_PATH)
    const a = await assess(diagnosticSim, def, attempt, events, {})
    expect(a.criteria.find((c) => c.id === 'differentials')).toMatchObject({ passed: true, score: 5 })
  })
})

describe('replay and re-grading', () => {
  it('rebuilds the identical attempt from the event log', async () => {
    const { attempt, events } = await play(GOOD_PATH)
    const rebuilt = await replay(diagnosticSim, def, ctx, events, {})
    if (!rebuilt.ok) throw new Error('expected ok')
    expect(rebuilt.attempt).toEqual(attempt)
  })

  it('re-grades past attempts when the author corrects the rubric', async () => {
    const { attempt, events } = await play(GOOD_PATH)
    const stricter: DiagnosticSimDef = {
      ...def,
      rubric: {
        ...def.rubric,
        ordering: [...def.rubric.ordering, { id: 'cultures', label: 'Cultures sent', first: ['i_cultures'], required: true, critical: true, weight: 0 }],
      },
    }
    expect((await assess(diagnosticSim, def, attempt, events, {})).passed).toBe(true)
    expect((await assess(diagnosticSim, stricter, attempt, events, {})).passed).toBe(false)
  })
})
