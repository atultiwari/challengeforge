/**
 * `diagnostic-sim` state and step logic. Pure: time is SIMULATED minutes on
 * a clock the learner's actions advance, never the wall clock.
 */
import { searchCatalog, type StepOutcome, type TrajectoryStep } from '@challengeforge/engine'
import type { Category, DiagnosticSimAction, DiagnosticSimDef } from './schema'

export type EndReason = 'diagnosis' | 'time' | 'actions' | 'learner'

export interface OrderedItem {
  id: string
  at: number
  readyAt: number
}

export interface DiagnosticSimState {
  clock: number
  actionCount: number
  /** Ids surfaced by a search; only these may be acted on (search-to-reveal). */
  discovered: readonly string[]
  asked: readonly string[]
  examined: readonly string[]
  ordered: readonly OrderedItem[]
  treated: readonly { id: string; at: number }[]
  /** The path, in domain-free form, for the trajectory primitives. */
  trail: readonly TrajectoryStep[]
  triggered: readonly string[]
  differential: readonly string[] | null
  diagnosis: string | null
  lastSearch: { category: Category; query: string; results: readonly { id: string; label: string }[] } | null
  ended: boolean
  endReason: EndReason | null
}

export const initialState = (): DiagnosticSimState => ({
  clock: 0,
  actionCount: 0,
  discovered: [],
  asked: [],
  examined: [],
  ordered: [],
  treated: [],
  trail: [],
  triggered: [],
  differential: null,
  diagnosis: null,
  lastSearch: null,
  ended: false,
  endReason: null,
})

type ItemKind = 'ask' | 'examine' | 'order' | 'treat'
const CATEGORY_OF: Record<ItemKind, Category> = { ask: 'history', examine: 'examination', order: 'investigations', treat: 'treatments' }

export function catalog(def: DiagnosticSimDef, category: Category): readonly { id: string; label: string; keywords: readonly string[] }[] {
  return def[category]
}

export function doneIds(s: DiagnosticSimState): Set<string> {
  return new Set([...s.asked, ...s.examined, ...s.ordered.map((o) => o.id), ...s.treated.map((t) => t.id)])
}

function cost(def: DiagnosticSimDef, kind: ItemKind): number {
  const sim = def.sim
  return { ask: sim.minutes_per_question, examine: sim.minutes_per_examination, order: sim.minutes_per_order, treat: sim.minutes_per_treatment }[kind]
}

const reject = (code: string, message: string): StepOutcome<DiagnosticSimState> => ({ ok: false, error: { code, message } })

function applyItem(def: DiagnosticSimDef, s: DiagnosticSimState, kind: ItemKind, item: string): StepOutcome<DiagnosticSimState> {
  const category = CATEGORY_OF[kind]
  const known = catalog(def, category).find((i) => i.id === item)
  if (!known || !s.discovered.includes(item)) return reject('not_discovered', 'Search for it first.')
  if (doneIds(s).has(item)) return reject('already_done', 'You have already done that.')
  if (kind === 'order' && def.gates.differential_before_investigations && s.differential === null) {
    return reject('differential_required', 'Record a working differential before ordering investigations.')
  }

  const start = s.clock
  const clock = start + cost(def, kind)
  const trail = [...s.trail, { seq: s.actionCount + 1, kind, target: item, time: start }]
  const base = { ...s, clock, trail }
  switch (kind) {
    case 'ask':
      return { ok: true, state: { ...base, asked: [...s.asked, item] } }
    case 'examine':
      return { ok: true, state: { ...base, examined: [...s.examined, item] } }
    case 'order': {
      const turnaround = def.investigations.find((i) => i.id === item)?.turnaround ?? 0
      return { ok: true, state: { ...base, ordered: [...s.ordered, { id: item, at: start, readyAt: clock + turnaround }] } }
    }
    case 'treat':
      return { ok: true, state: { ...base, treated: [...s.treated, { id: item, at: start }] } }
  }
}

function applyAction(def: DiagnosticSimDef, s: DiagnosticSimState, action: DiagnosticSimAction): StepOutcome<DiagnosticSimState> {
  switch (action.kind) {
    case 'search': {
      const results = searchCatalog(catalog(def, action.category), action.query).map(({ id, label }) => ({ id, label }))
      const discovered = [...new Set([...s.discovered, ...results.map((r) => r.id)])]
      return { ok: true, state: { ...s, discovered, lastSearch: { category: action.category, query: action.query, results } } }
    }
    case 'ask':
    case 'examine':
    case 'order':
    case 'treat':
      return applyItem(def, s, action.kind, action.item)
    case 'advance_time':
      return { ok: true, state: { ...s, clock: s.clock + action.minutes } }
    case 'record_differential':
      return { ok: true, state: { ...s, differential: [...action.terms] } }
    case 'submit_diagnosis':
      return { ok: true, state: { ...s, diagnosis: action.text, ended: true, endReason: 'diagnosis' } }
    case 'end':
      return { ok: true, state: { ...s, ended: true, endReason: 'learner' } }
  }
}

/** Timed events fire once the clock passes them, unless the learner already acted. */
function fireEvents(def: DiagnosticSimDef, s: DiagnosticSimState): DiagnosticSimState {
  const done = doneIds(s)
  const due = def.events.filter(
    (e) => !s.triggered.includes(e.id) && s.clock >= e.at_time && !(e.unless_done.length > 0 && e.unless_done.every((id) => done.has(id))),
  )
  return due.length === 0 ? s : { ...s, triggered: [...s.triggered, ...due.map((e) => e.id)] }
}

function checkLimits(def: DiagnosticSimDef, s: DiagnosticSimState): DiagnosticSimState {
  if (s.ended) return s
  if (def.sim.time_budget !== null && s.clock >= def.sim.time_budget) return { ...s, ended: true, endReason: 'time' }
  if (s.actionCount >= def.sim.max_actions) return { ...s, ended: true, endReason: 'actions' }
  return s
}

export function stepState(def: DiagnosticSimDef, s: DiagnosticSimState, action: DiagnosticSimAction): StepOutcome<DiagnosticSimState> {
  const outcome = applyAction(def, s, action)
  if (!outcome.ok) return outcome
  const counted = { ...outcome.state, actionCount: s.actionCount + 1 }
  return { ok: true, state: checkLimits(def, fireEvents(def, counted)) }
}
