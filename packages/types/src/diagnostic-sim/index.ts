/**
 * `diagnostic-sim` (interactive): a patient case a clinician authors as data
 * and a learner works up action by action. See PLAN.md §3.5.
 */
import type { ChallengeType } from '@challengeforge/engine'
import { DiagnosticSimActionSchema, DiagnosticSimDefSchema, type DiagnosticSimAction, type DiagnosticSimDef } from './schema'
import { conversePatient, initialState, stepState, type DiagnosticSimState } from './state'
import { z } from 'zod'
import { viewOf, type DiagnosticSimView } from './view'
import { evaluateCase } from './evaluate'
import { lintCase } from './lint'

const PatientReplySchema = z.object({ reply: z.string().max(2000), matched: z.array(z.string().max(80)).max(20) })

export const diagnosticSim: ChallengeType<DiagnosticSimDef, DiagnosticSimState, DiagnosticSimAction, DiagnosticSimView> = {
  id: 'diagnostic-sim',
  version: 1,
  paradigm: 'interactive',
  definitionSchema: DiagnosticSimDefSchema,
  actionSchema: DiagnosticSimActionSchema,
  lint: lintCase,
  init: initialState,
  /** Talking to the patient needs a model reply (packages/services), grounded in the history list. */
  prepare(def, state, action) {
    if (action.kind !== 'converse' || !def.patient_chat.enabled || state.ended) return null
    if ((state.conversation ?? []).length >= def.patient_chat.max_questions) return null
    return {
      kind: 'patient.reply',
      payload: {
        provider: def.patient_chat.model.provider,
        model: def.patient_chat.model.model,
        callCap: def.patient_chat.max_questions,
        persona: def.patient_chat.persona,
        patient: { ...def.presentation.patient, chief_complaint: def.presentation.chief_complaint },
        items: def.history.map((h) => ({ id: h.id, label: h.label, response: h.response, keywords: [...h.keywords] })),
        recent: (state.conversation ?? []).slice(-6),
        question: action.text,
      },
    }
  },
  step: async (def, state, action, env) => {
    if (action.kind !== 'converse') return stepState(def, state, action)
    const answer = PatientReplySchema.safeParse(env.recorded)
    if (!answer.success) return stepState(def, state, action)
    return conversePatient(def, state, action.text, answer.data)
  },
  view: viewOf,
  isTerminal: (_def, state) => state.ended,
  // The path is recorded in state.trail as each step happens; the event log
  // rebuilds the same trail on replay.
  evaluate: async (def, _trajectory, final) => evaluateCase(def, final),
}

export type { DiagnosticSimDef, DiagnosticSimAction } from './schema'
export type { DiagnosticSimState } from './state'
export type { DiagnosticSimView } from './view'
export { DiagnosticSimDefSchema, DiagnosticSimActionSchema } from './schema'
