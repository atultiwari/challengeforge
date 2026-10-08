/**
 * `diagnostic-sim` state and step logic. Pure: time is SIMULATED minutes on
 * a clock the learner's actions advance, never the wall clock.
 */
import { searchCatalog, type StepOutcome, type TrajectoryStep } from '@challengeforge/engine'
import type { Category, DiagnosticSimAction, DiagnosticSimDef } from './schema'

export type EndReason = 'diagnosis' | 'time' | 'actions' | 'learner'

export interface OrderedItem {
  id: string
  /** Sequence number of the order action, so result steps sort correctly. */
  seq: number
  at: number
  readyAt: number
  /** Chosen when ordered (it may depend on what had been done); shown only once ready. */
  result: string
}

export interface DiagnosticSimState {
  clock: number
  actionCount: number
  /**
   * `${category}:${id}` keys surfaced by a search; only these may be acted on
   * (search-to-reveal). Keyed by category so one search never unlocks another.
   */
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
  /** Free-text conversation with the simulated patient (absent in older attempts). */
  conversation?: readonly { question: string; reply: string; matched?: readonly string[] }[]
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
  conversation: [],
  ended: false,
  endReason: null,
})

type ItemKind = 'ask' | 'examine' | 'order' | 'treat'
const CATEGORY_OF: Record<ItemKind, Category> = { ask: 'history', examine: 'examination', order: 'investigations', treat: 'treatments' }

export function catalog(def: DiagnosticSimDef, category: Category): readonly { id: string; label: string; keywords: readonly string[] }[] {
  return def[category]
}

export const discoveryKey = (category: Category, id: string): string => `${category}:${id}`

export function doneIds(s: DiagnosticSimState): Set<string> {
  return new Set([...s.asked, ...s.examined, ...s.ordered.map((o) => o.id), ...s.treated.map((t) => t.id)])
}

function cost(def: DiagnosticSimDef, kind: ItemKind): number {
  const sim = def.sim
  return { ask: sim.minutes_per_question, examine: sim.minutes_per_examination, order: sim.minutes_per_order, treat: sim.minutes_per_treatment }[kind]
}

const reject = (code: string, message: string): StepOutcome<DiagnosticSimState> => ({ ok: false, error: { code, message } })

/** The result an investigation shows if ordered now: the last serial entry that applies. */
function resultFor(def: DiagnosticSimDef, s: DiagnosticSimState, item: string): string {
  const inv = def.investigations.find((i) => i.id === item)
  if (!inv) return ''
  const done = doneIds(s)
  const applicable = inv.serial_results.filter((r) => r.from_time <= s.clock && r.if_done.every((id) => done.has(id)))
  return applicable.at(-1)?.result ?? inv.result
}

function isRepeatable(def: DiagnosticSimDef, kind: ItemKind, item: string): boolean {
  return kind === 'order' && def.investigations.some((i) => i.id === item && i.repeatable)
}

function applyItem(def: DiagnosticSimDef, s: DiagnosticSimState, kind: ItemKind, item: string): StepOutcome<DiagnosticSimState> {
  const category = CATEGORY_OF[kind]
  const known = catalog(def, category).find((i) => i.id === item)
  if (!known || !s.discovered.includes(discoveryKey(category, item))) return reject('not_discovered', 'Search for it first.')
  if (doneIds(s).has(item) && !isRepeatable(def, kind, item)) return reject('already_done', 'You have already done that.')
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
      const ordered: OrderedItem = { id: item, seq: s.actionCount + 1, at: start, readyAt: clock + turnaround, result: resultFor(def, s, item) }
      return { ok: true, state: { ...base, ordered: [...s.ordered, ordered] } }
    }
    case 'treat':
      return { ok: true, state: { ...base, treated: [...s.treated, { id: item, at: start }] } }
  }
}

function applyAction(def: DiagnosticSimDef, s: DiagnosticSimState, action: DiagnosticSimAction): StepOutcome<DiagnosticSimState> {
  switch (action.kind) {
    case 'search': {
      const results = searchCatalog(catalog(def, action.category), action.query).map(({ id, label }) => ({ id, label }))
      const discovered = [...new Set([...s.discovered, ...results.map((r) => discoveryKey(action.category, r.id))])]
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
    case 'converse':
      // Needs the patient's reply from the server; see conversePatient.
      return reject('needs_service', 'The patient could not answer just now. Please try again.')
  }
}

/** What the simulated patient answered, as recorded on the event (see packages/services). */
export interface PatientReply {
  reply: string
  /** History item ids the question was about. Unknown ids are ignored. */
  matched: readonly string[]
}

/**
 * Applies a conversation turn: the reply joins the transcript, and every
 * matched history item counts exactly as if it had been asked (revealed,
 * timed, on the trail), so the case's criteria grade the conversation the
 * same way as the menu-free search. The model never decides a score.
 */
export function conversePatient(def: DiagnosticSimDef, s: DiagnosticSimState, question: string, answer: PatientReply): StepOutcome<DiagnosticSimState> {
  if (!def.patient_chat.enabled) return reject('not_enabled', 'This case does not include talking to the patient.')
  const conversation = s.conversation ?? []
  if (conversation.length >= def.patient_chat.max_questions) return reject('cap_reached', `You have asked the patient ${def.patient_chat.max_questions} questions.`)
  const done = doneIds(s)
  const valid = [...new Set(answer.matched)].filter((id) => def.history.some((h) => h.id === id) && !done.has(id))
  const start = s.clock
  const trail = [...s.trail, ...valid.map((id) => ({ seq: s.actionCount + 1, kind: 'ask', target: id, time: start }))]
  const discovered = [...new Set([...s.discovered, ...valid.map((id) => discoveryKey('history', id))])]
  const next: DiagnosticSimState = {
    ...s,
    clock: start + def.sim.minutes_per_question,
    discovered,
    asked: [...s.asked, ...valid],
    trail,
    conversation: [...conversation, { question, reply: answer.reply.slice(0, 1000), matched: valid }],
  }
  const counted = { ...next, actionCount: s.actionCount + 1 }
  return { ok: true, state: checkLimits(def, fireEvents(def, counted)) }
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
