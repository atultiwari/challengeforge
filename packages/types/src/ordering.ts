/**
 * `ordering` (static): put the steps of a procedure in the right order, e.g.
 * the sequence of a sterile dressing change or a resuscitation algorithm.
 *
 * This type is also the worked example in docs/TYPE-SDK.md: it uses only the
 * public contract from @challengeforge/engine and nothing platform-specific.
 *
 * Grading: each step earns its mark when it follows the step that should come
 * before it (the first step: when it is placed first). One displaced block
 * therefore costs only the steps around it, not everything after it. Authors
 * may add "critical" pairs (X must come before Y) that fail the attempt.
 */
import { z } from 'zod'
import { combineCriteria, type ChallengeType, type Criterion, type LintIssue } from '@challengeforge/engine'

const Id = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i, 'Use letters, digits, - and _.')
const Text = z.string().trim().min(1)

export const OrderingDefSchema = z.object({
  title: Text,
  intro: z.string().default('').describe('Shown above the steps: what is being ordered and when.'),
  steps: z
    .array(z.object({ id: Id, text: Text.max(300), explanation: z.string().max(1000).default('') }))
    .min(2)
    .max(20)
    .describe('The steps IN THE CORRECT ORDER. Learners see them shuffled.'),
  critical_pairs: z
    .array(z.object({ before: Id, after: Id, message: z.string().max(300).default('') }))
    .max(20)
    .default([])
    .describe('Pairs that must never be reversed (e.g. hand hygiene before gloves). Reversing one fails the attempt.'),
  pass_fraction: z.number().min(0).max(1).default(0.7),
  scoring: z.object({ base_points: z.number().int().positive().default(100) }).default({ base_points: 100 }),
  debrief: z.string().default(''),
})
export type OrderingDef = z.infer<typeof OrderingDefSchema>

export const OrderingActionSchema = z.object({ kind: z.literal('submit'), order: z.array(Id).min(1).max(20) })
export type OrderingAction = z.infer<typeof OrderingActionSchema>

export interface OrderingState {
  /** The shuffled order the learner starts from (fixed per attempt by its seed). */
  shown: readonly string[]
  order: readonly string[] | null
  submittedAt: string | null
}

export interface OrderingView {
  title: string
  intro: string
  steps: readonly { id: string; text: string }[]
  submitted: boolean
  results?: {
    yourOrder: readonly { id: string; text: string; correct: boolean }[]
    correctOrder: readonly { id: string; text: string; explanation: string }[]
    brokenRules: readonly string[]
  }
  debrief?: string
}

/** A small seeded generator (mulberry32), so the shuffle replays identically. */
function random(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function shuffledIds(ids: readonly string[], seed: number): string[] {
  const next = random(seed)
  const out = [...ids]
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(next() * (i + 1))
    ;[out[i], out[j]] = [out[j]!, out[i]!]
  }
  // Never start from the answer.
  return out.every((id, i) => id === ids[i]) ? [...out.slice(1), out[0]!] : out
}

/** A submitted order is usable only if it is exactly the case's steps, each once. */
function validOrder(def: OrderingDef, order: readonly string[]): boolean {
  return order.length === def.steps.length && new Set(order).size === order.length && order.every((id) => def.steps.some((s) => s.id === id))
}

/** Each step's mark: does it follow the step that should come right before it? */
export function stepsInPlace(def: OrderingDef, order: readonly string[]): Map<string, boolean> {
  const correct = def.steps.map((s) => s.id)
  return new Map(
    order.map((id, i) => {
      const shouldFollow = correct[correct.indexOf(id) - 1]
      return [id, shouldFollow === undefined ? i === 0 : order[i - 1] === shouldFollow]
    }),
  )
}

function brokenPairs(def: OrderingDef, order: readonly string[]) {
  return def.critical_pairs.filter((p) => order.indexOf(p.before) > order.indexOf(p.after))
}

function lint(def: OrderingDef): LintIssue[] {
  const issues: LintIssue[] = []
  const ids = new Set<string>()
  def.steps.forEach((s, i) => {
    if (ids.has(s.id)) issues.push({ path: `steps.${i}.id`, severity: 'error', message: `The id "${s.id}" is used more than once.` })
    ids.add(s.id)
  })
  def.critical_pairs.forEach((p, i) => {
    if (!ids.has(p.before) || !ids.has(p.after)) issues.push({ path: `critical_pairs.${i}`, severity: 'error', message: 'Both steps of a critical pair must be in the list.' })
    else if (p.before === p.after) issues.push({ path: `critical_pairs.${i}`, severity: 'error', message: 'A step cannot come before itself.' })
    else if (def.steps.findIndex((s) => s.id === p.before) > def.steps.findIndex((s) => s.id === p.after)) {
      issues.push({ path: `critical_pairs.${i}`, severity: 'error', message: 'This pair contradicts the order of the steps.' })
    }
  })
  return issues
}

export const ordering: ChallengeType<OrderingDef, OrderingState, OrderingAction, OrderingView> = {
  id: 'ordering',
  version: 1,
  paradigm: 'static',
  definitionSchema: OrderingDefSchema,
  actionSchema: OrderingActionSchema,
  lint,
  init: (def, ctx) => ({ shown: shuffledIds(def.steps.map((s) => s.id), ctx.seed), order: null, submittedAt: null }),
  async step(def, _state, action, env) {
    if (!validOrder(def, action.order)) return { ok: false, error: { code: 'bad_order', message: 'Put every step in the list exactly once.' } }
    return { ok: true, state: { ..._state, order: [...action.order], submittedAt: env.at } }
  },
  view(def, s) {
    const text = (id: string) => def.steps.find((st) => st.id === id)?.text ?? ''
    const base: OrderingView = { title: def.title, intro: def.intro, steps: s.shown.map((id) => ({ id, text: text(id) })), submitted: s.submittedAt !== null }
    if (s.order === null) return base
    const placed = stepsInPlace(def, s.order)
    return {
      ...base,
      results: {
        yourOrder: s.order.map((id) => ({ id, text: text(id), correct: placed.get(id) === true })),
        correctOrder: def.steps.map((st) => ({ id: st.id, text: st.text, explanation: st.explanation })),
        brokenRules: brokenPairs(def, s.order).map((p) => p.message || `“${text(p.before)}” must come before “${text(p.after)}”.`),
      },
      debrief: def.debrief,
    }
  },
  isTerminal: (_def, s) => s.submittedAt !== null,
  async evaluate(def, _trajectory, final) {
    const order = final.order ?? []
    const placed = stepsInPlace(def, order)
    const broken = new Set(brokenPairs(def, order))
    const criteria: Criterion[] = [
      ...def.steps.map((st) => ({
        id: st.id,
        label: st.text.slice(0, 80),
        score: placed.get(st.id) === true ? 1 : 0,
        max: 1,
        passed: placed.get(st.id) === true,
        feedback: st.explanation,
      })),
      ...def.critical_pairs.map((p, i) => ({
        id: `rule-${i + 1}`,
        label: p.message || `${p.before} before ${p.after}`,
        score: 0,
        max: 0,
        passed: !broken.has(p),
        feedback: p.message,
        critical: true,
      })),
    ]
    return combineCriteria(criteria, { passFraction: def.pass_fraction })
  },
  pointsInput: (def) => ({ basePoints: def.scoring.base_points, hintCosts: [], hintIndicesUsed: [] }),
}
