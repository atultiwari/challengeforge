/**
 * The learner's view of a diagnostic case: only what they have revealed.
 * Tags, reasons, the answer, the debrief and the model pathway never appear
 * until the case has ended (default-deny, PLAN.md §3.4).
 */
import type { DiagnosticSimDef } from './schema'
import type { DiagnosticSimState, EndReason } from './state'

export interface InvestigationView {
  label: string
  status: 'pending' | 'ready'
  readyAt: number
  result?: string
}

export interface DiagnosticSimView {
  title: string
  presentation: {
    setting: string
    patient: { age: number; sex: string; weight_kg?: number }
    chief_complaint: string
    vignette: string
  }
  vitals: Readonly<Record<string, string>>
  clock: number
  timeBudget: number | null
  history: readonly { label: string; response: string }[]
  examination: readonly { label: string; response: string }[]
  investigations: readonly InvestigationView[]
  treatments: readonly { label: string; response: string }[]
  alerts: readonly string[]
  search: DiagnosticSimState['lastSearch']
  differential: readonly string[] | null
  differentialRequired: boolean
  ended: boolean
  endReason?: EndReason
  debrief?: string
  modelPathway?: readonly string[]
}

function answered<T extends { id: string; label: string; response: string }>(items: readonly T[], ids: readonly string[]) {
  return ids.flatMap((id) => {
    const item = items.find((i) => i.id === id)
    return item ? [{ label: item.label, response: item.response }] : []
  })
}

function investigationViews(def: DiagnosticSimDef, s: DiagnosticSimState): InvestigationView[] {
  return s.ordered.flatMap((o): InvestigationView[] => {
    const item = def.investigations.find((i) => i.id === o.id)
    if (!item) return []
    // The result exists in the definition all along; it reaches the view only once it is ready.
    return s.clock >= o.readyAt
      ? [{ label: item.label, status: 'ready', readyAt: o.readyAt, result: o.result }]
      : [{ label: item.label, status: 'pending', readyAt: o.readyAt }]
  })
}

export function viewOf(def: DiagnosticSimDef, s: DiagnosticSimState): DiagnosticSimView {
  const fired = def.events.filter((e) => s.triggered.includes(e.id))
  const { setting, patient, chief_complaint, vignette } = def.presentation
  const base: DiagnosticSimView = {
    title: def.title,
    presentation: { setting, patient: { ...patient }, chief_complaint, vignette },
    vitals: fired.reduce<Record<string, string>>((v, e) => ({ ...v, ...e.vitals }), { ...def.presentation.vitals }),
    clock: s.clock,
    timeBudget: def.sim.time_budget,
    history: answered(def.history, s.asked),
    examination: answered(def.examination, s.examined),
    investigations: investigationViews(def, s),
    treatments: answered(def.treatments, s.treated.map((t) => t.id)),
    alerts: fired.map((e) => e.message),
    search: s.lastSearch,
    differential: s.differential === null ? null : [...s.differential],
    differentialRequired: def.gates.differential_before_investigations,
    ended: s.ended,
  }
  if (!s.ended) return base
  return { ...base, endReason: s.endReason ?? 'learner', debrief: def.debrief, modelPathway: [...def.model_pathway] }
}
