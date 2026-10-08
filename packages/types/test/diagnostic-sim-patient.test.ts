import { describe, expect, it } from 'vitest'
import { applyServiceResult, replay, startAttempt, type ServiceRequest } from '@challengeforge/engine'
import { diagnosticSim, type DiagnosticSimDef, type DiagnosticSimView } from '../src/diagnostic-sim'
import caseJson from '../fixtures/diagnostic-sim/dka-young-adult.json'

const base: DiagnosticSimDef = diagnosticSim.definitionSchema.parse({ ...caseJson, patient_chat: { enabled: false } })
const chatty: DiagnosticSimDef = diagnosticSim.definitionSchema.parse({ ...caseJson, patient_chat: { enabled: true, persona: 'tired, short answers', max_questions: 2 } })
const ctx = { attemptId: 'att-p1', userId: 'u1', challengeId: 'dka', seed: 1 }
const env = { services: {}, at: '2026-10-08T10:00:00.000Z' }

describe('diagnostic-sim: talking to the patient', () => {
  it('is off unless the case turns it on', () => {
    const { attempt, view } = startAttempt(diagnosticSim, base, ctx)
    expect(diagnosticSim.prepare!(base, attempt.state, { kind: 'converse', text: 'when did it start?' }, ctx)).toBeNull()
    expect((view as DiagnosticSimView).patientChat).toBeUndefined()
    expect(diagnosticSim.lint(chatty).some((i) => i.path === 'patient_chat.enabled' && i.severity === 'warning')).toBe(true)
  })

  it('asks the server with the history list only (never the answer), then reveals what the reply matched', async () => {
    const { attempt } = startAttempt(diagnosticSim, chatty, ctx)
    const request = diagnosticSim.prepare!(chatty, attempt.state, { kind: 'converse', text: 'When did this start?' }, ctx) as ServiceRequest
    expect(request.kind).toBe('patient.reply')
    expect(JSON.stringify(request.payload)).not.toContain(chatty.answer.diagnosis.accepted[0]!)
    expect((request.payload as { items: unknown[] }).items).toHaveLength(chatty.history.length)

    const r = await applyServiceResult(diagnosticSim, chatty, attempt, { kind: 'converse', text: 'When did this start?' }, env, {
      reply: 'Two days ago, it came on slowly.',
      matched: ['h_onset', 'not-a-real-item'],
    })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const s = r.attempt.state
    expect(s.asked).toEqual(['h_onset'])
    expect(s.discovered).toContain('history:h_onset')
    expect(s.trail.map((t) => t.target)).toEqual(['h_onset'])
    expect(s.clock).toBe(chatty.sim.minutes_per_question)
    const view = r.view as DiagnosticSimView
    expect(view.patientChat).toEqual({ conversation: [{ question: 'When did this start?', reply: 'Two days ago, it came on slowly.' }], remaining: 1 })
    expect(view.history.map((h) => h.label)).toHaveLength(1)
  })

  it('a reply that matched nothing still takes time; the question cap is enforced', async () => {
    let { attempt } = startAttempt(diagnosticSim, chatty, ctx)
    for (const text of ['Do you like football?', 'What is your favourite colour?']) {
      const r = await applyServiceResult(diagnosticSim, chatty, attempt, { kind: 'converse', text }, env, { reply: "I'm not sure.", matched: [] })
      if (!r.ok) throw new Error(r.error.message)
      attempt = r.attempt
    }
    expect(attempt.state.asked).toEqual([])
    expect(diagnosticSim.prepare!(chatty, attempt.state, { kind: 'converse', text: 'one more?' }, ctx)).toBeNull()
    const capped = await applyServiceResult(diagnosticSim, chatty, attempt, { kind: 'converse', text: 'one more?' }, env, { reply: 'x', matched: [] })
    expect(capped).toMatchObject({ ok: false })
  })

  it('records the reply on the event, so the attempt replays without the model (review)', async () => {
    const { attempt } = startAttempt(diagnosticSim, chatty, ctx)
    const r = await applyServiceResult(diagnosticSim, chatty, attempt, { kind: 'converse', text: 'When did this start?' }, env, { reply: 'Two days ago.', matched: ['h_onset'] })
    if (!r.ok) throw new Error(r.error.message)
    expect(r.event.effects).toEqual({ reply: 'Two days ago.', matched: ['h_onset'] })
    expect(await replay(diagnosticSim, chatty, ctx, [r.event], {})).toMatchObject({ ok: true, attempt: { state: r.attempt.state } })
  })

  it('says the cap is reached (not "try again") once questions run out', async () => {
    let { attempt } = startAttempt(diagnosticSim, chatty, ctx)
    for (const text of ['one?', 'two?']) {
      const r = await applyServiceResult(diagnosticSim, chatty, attempt, { kind: 'converse', text }, env, { reply: 'x', matched: [] })
      if (!r.ok) throw new Error(r.error.message)
      attempt = r.attempt
    }
    const capped = await applyServiceResult(diagnosticSim, chatty, attempt, { kind: 'converse', text: 'three?' }, env, { reply: 'x', matched: [] })
    expect(capped).toMatchObject({ ok: false, error: { typeCode: 'cap_reached' } })
  })
})
