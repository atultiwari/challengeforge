/**
 * `question-set` (static): the first type a non-engineer authors through a
 * form. Single choice, multiple choice, numeric and short text items, each
 * weighted with an explanation. One submission ends the attempt; results and
 * explanations are revealed only after it.
 */
import { z } from 'zod'
import {
  combineCriteria,
  matchesAnyTerm,
  parseLearnerNumber,
  type ChallengeType,
  type Criterion,
  type LintIssue,
} from '@challengeforge/engine'

const Id = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/i, 'Use letters, digits, - and _.')
const Text = z.string().trim().min(1)
const Option = z.object({ id: Id, text: Text })
const MAX_ITEMS = 100

const base = {
  id: Id,
  prompt: Text,
  weight: z.number().nonnegative().default(1),
  /** Shown after submission, whether the learner was right or wrong. */
  explanation: z.string().default(''),
}

export const QuestionItemSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('single'), options: z.array(Option).min(2).max(12), answer: Id }),
  z.object({ ...base, type: z.literal('multi'), options: z.array(Option).min(2).max(12), answers: z.array(Id).min(1) }),
  z.object({ ...base, type: z.literal('numeric'), value: z.number(), tolerance: z.number().nonnegative().default(0), unit: z.string().optional() }),
  z.object({ ...base, type: z.literal('short_text'), accepted: z.array(Text).min(1) }),
])
export type QuestionItem = z.infer<typeof QuestionItemSchema>

export const QuestionSetDefSchema = z.object({
  title: Text,
  intro: z.string().default(''),
  items: z.array(QuestionItemSchema).min(1).max(MAX_ITEMS),
  pass_fraction: z.number().min(0).max(1).default(0.6),
  scoring: z.object({ base_points: z.number().int().positive().default(100) }).default({ base_points: 100 }),
  debrief: z.string().default(''),
})
export type QuestionSetDef = z.infer<typeof QuestionSetDefSchema>

export const QuestionSetActionSchema = z.object({
  kind: z.literal('submit'),
  answers: z
    .record(z.string().max(64), z.unknown())
    .refine((a) => Object.keys(a).length <= MAX_ITEMS, 'Too many answers.'),
})
export type QuestionSetAction = z.infer<typeof QuestionSetActionSchema>

export interface QuestionSetState {
  submittedAt: string | null
  answers: Readonly<Record<string, unknown>> | null
}

export interface ItemResult {
  id: string
  correct: boolean
  fraction: number
  correctAnswer: string
  explanation: string
}

export interface QuestionSetView {
  title: string
  intro: string
  items: readonly {
    id: string
    type: QuestionItem['type']
    prompt: string
    options?: readonly { id: string; text: string }[]
    unit?: string
  }[]
  submitted: boolean
  answers: Readonly<Record<string, unknown>> | null
  results?: readonly ItemResult[]
  debrief?: string
}

/** Fraction of the item earned, 0..1. Hostile or malformed answers earn 0. */
export function gradeItem(item: QuestionItem, answer: unknown): number {
  switch (item.type) {
    case 'single':
      return typeof answer === 'string' && answer === item.answer ? 1 : 0
    case 'multi': {
      if (!Array.isArray(answer)) return 0
      const picked = new Set(answer.filter((a): a is string => typeof a === 'string'))
      const correct = new Set(item.answers)
      const hits = [...picked].filter((a) => correct.has(a)).length
      const wrong = picked.size - hits
      return Math.max(0, (hits - wrong) / correct.size)
    }
    case 'numeric': {
      const n = parseLearnerNumber(answer)
      return n !== null && Math.abs(n - item.value) <= item.tolerance ? 1 : 0
    }
    case 'short_text':
      return typeof answer === 'string' && answer.length <= 200 && matchesAnyTerm(answer, item.accepted) ? 1 : 0
  }
}

function correctAnswerText(item: QuestionItem): string {
  switch (item.type) {
    case 'single':
      return item.options.find((o) => o.id === item.answer)?.text ?? ''
    case 'multi':
      return item.options.filter((o) => item.answers.includes(o.id)).map((o) => o.text).join(', ')
    case 'numeric':
      return item.unit ? `${item.value} ${item.unit}` : String(item.value)
    case 'short_text':
      return item.accepted[0] ?? ''
  }
}

const answerOf = (answers: Readonly<Record<string, unknown>> | null, id: string): unknown =>
  answers !== null && Object.hasOwn(answers, id) ? answers[id] : undefined

function results(def: QuestionSetDef, answers: Readonly<Record<string, unknown>> | null): ItemResult[] {
  return def.items.map((item) => {
    const fraction = gradeItem(item, answerOf(answers, item.id))
    return { id: item.id, correct: fraction === 1, fraction, correctAnswer: correctAnswerText(item), explanation: item.explanation }
  })
}

function lint(def: QuestionSetDef): LintIssue[] {
  const issues: LintIssue[] = []
  const seen = new Set<string>()
  def.items.forEach((item, i) => {
    if (seen.has(item.id)) issues.push({ path: `items.${i}.id`, severity: 'error', message: `The id "${item.id}" is used more than once.` })
    seen.add(item.id)
    if (item.type === 'single' && !item.options.some((o) => o.id === item.answer)) {
      issues.push({ path: `items.${i}.answer`, severity: 'error', message: 'The correct answer must be one of the options.' })
    }
    if (item.type === 'multi' && item.answers.some((a) => !item.options.some((o) => o.id === a))) {
      issues.push({ path: `items.${i}.answers`, severity: 'error', message: 'Every correct answer must be one of the options.' })
    }
    if (item.explanation.trim() === '') {
      issues.push({ path: `items.${i}.explanation`, severity: 'warning', message: 'Learners learn most from an explanation.' })
    }
  })
  if (def.items.every((item) => item.weight === 0)) {
    issues.push({ path: 'items', severity: 'error', message: 'At least one question must carry marks.' })
  }
  return issues
}

export const questionSet: ChallengeType<QuestionSetDef, QuestionSetState, QuestionSetAction, QuestionSetView> = {
  id: 'question-set',
  version: 1,
  paradigm: 'static',
  definitionSchema: QuestionSetDefSchema,
  actionSchema: QuestionSetActionSchema,
  lint,
  init: () => ({ submittedAt: null, answers: null }),
  step: async (_def, _state, action, env) => ({ ok: true, state: { submittedAt: env.at, answers: { ...action.answers } } }),
  view(def, s) {
    const submitted = s.submittedAt !== null
    const base: QuestionSetView = {
      title: def.title,
      intro: def.intro,
      items: def.items.map((item) => ({
        id: item.id,
        type: item.type,
        prompt: item.prompt,
        ...(item.type === 'single' || item.type === 'multi' ? { options: item.options.map((o) => ({ ...o })) } : {}),
        ...(item.type === 'numeric' && item.unit ? { unit: item.unit } : {}),
      })),
      submitted,
      answers: s.answers === null ? null : { ...s.answers },
    }
    return submitted ? { ...base, results: results(def, s.answers), debrief: def.debrief } : base
  },
  isTerminal: (_def, s) => s.submittedAt !== null,
  async evaluate(def, _trajectory, final) {
    const graded = results(def, final.answers)
    const criteria: Criterion[] = def.items.map((item, i) => ({
      id: item.id,
      label: item.prompt.slice(0, 80),
      score: item.weight * (graded[i]?.fraction ?? 0),
      max: item.weight,
      passed: graded[i]?.correct ?? false,
      feedback: item.explanation,
    }))
    return combineCriteria(criteria, { passFraction: def.pass_fraction })
  },
  pointsInput: (def) => ({ basePoints: def.scoring.base_points, hintCosts: [], hintIndicesUsed: [] }),
}
