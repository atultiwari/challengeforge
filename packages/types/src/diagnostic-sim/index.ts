/**
 * `diagnostic-sim` (interactive): a patient case a clinician authors as data
 * and a learner works up action by action. See PLAN.md §3.5.
 */
import type { ChallengeType } from '@challengeforge/engine'
import { DiagnosticSimActionSchema, DiagnosticSimDefSchema, type DiagnosticSimAction, type DiagnosticSimDef } from './schema'
import { initialState, stepState, type DiagnosticSimState } from './state'
import { viewOf, type DiagnosticSimView } from './view'
import { evaluateCase } from './evaluate'
import { lintCase } from './lint'

export const diagnosticSim: ChallengeType<DiagnosticSimDef, DiagnosticSimState, DiagnosticSimAction, DiagnosticSimView> = {
  id: 'diagnostic-sim',
  version: 1,
  paradigm: 'interactive',
  definitionSchema: DiagnosticSimDefSchema,
  actionSchema: DiagnosticSimActionSchema,
  lint: lintCase,
  init: initialState,
  step: async (def, state, action) => stepState(def, state, action),
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
