/**
 * `diagnostic-sim` definition: what a clinician fills in through the author
 * form (PLAN.md §3.5). Every field is plain data; no code is ever needed.
 */
import { z } from 'zod'

const Id = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/, 'Use lowercase letters, digits and underscores, starting with a letter.')
const Text = z.string().min(1)
const Keywords = z.array(Text).default([])
const Minutes = z.number().int().nonnegative()

export const HistoryItemSchema = z.object({
  id: Id,
  label: Text,
  keywords: Keywords,
  response: Text,
  tag: z.enum(['essential', 'useful', 'neutral']),
  category: z.string().optional(),
})

export const InvestigationSchema = z.object({
  id: Id,
  label: Text,
  keywords: Keywords,
  result: Text,
  /** Simulated minutes from ordering until the result is visible. */
  turnaround: Minutes,
  cost: z.number().nonnegative().default(0),
  tag: z.enum(['essential', 'useful', 'unnecessary', 'harmful']),
  /** Shown in the debrief when the tag counts against the learner. */
  reason: z.string().optional(),
})

export const TreatmentSchema = z.object({
  id: Id,
  label: Text,
  keywords: Keywords,
  response: Text,
  tag: z.enum(['essential', 'useful', 'neutral', 'contraindicated']),
  reason: z.string().optional(),
})

export const TimedEventSchema = z.object({
  id: Id,
  at_time: Minutes,
  /** The event does not happen if ALL of these were done before at_time. */
  unless_done: z.array(Id).default([]),
  message: Text,
  vitals: z.record(z.string(), z.string()).default({}),
})

export const OrderingRuleSchema = z.object({
  id: Id,
  label: Text,
  /** Any of these counts (e.g. potassium from a gas OR a lab panel). */
  first: z.array(Id).min(1),
  then: Id.optional(),
  by_time: Minutes.optional(),
  required: z.boolean().optional(),
  critical: z.boolean().optional(),
  weight: z.number().nonnegative().default(0),
})

const Weight = z.number().nonnegative().default(0)

export const RubricSchema = z.object({
  weights: z.object({
    history: Weight,
    examination: Weight,
    investigations: Weight,
    efficiency: Weight,
    diagnosis: Weight,
    differentials: Weight,
    management: Weight,
    ordering: Weight,
  }),
  /** Minimum essential items to pass each domain. Default: all of them. */
  min_history: z.number().int().nonnegative().optional(),
  min_examination: z.number().int().nonnegative().optional(),
  min_investigations: z.number().int().nonnegative().optional(),
  min_management: z.number().int().nonnegative().optional(),
  max_unnecessary: z.number().int().nonnegative().default(0),
  ordering: z.array(OrderingRuleSchema).default([]),
  pass_fraction: z.number().min(0).max(1).default(0.6),
  critical: z
    .discriminatedUnion('mode', [
      z.object({ mode: z.literal('fail') }),
      z.object({ mode: z.literal('cap'), cap_fraction: z.number().min(0).max(1) }),
    ])
    .default({ mode: 'fail' }),
})

export const DiagnosticSimDefSchema = z.object({
  title: Text,
  summary: z.string().default(''),
  review: z
    .object({ status: z.enum(['draft', 'in_review', 'approved']).default('draft'), notes: z.string().optional() })
    .default({ status: 'draft' }),
  presentation: z.object({
    setting: Text,
    patient: z.object({ age: z.number().int().nonnegative(), sex: Text }),
    chief_complaint: Text,
    vignette: Text,
    vitals: z.record(z.string(), z.string()).default({}),
  }),
  sim: z
    .object({
      minutes_per_question: Minutes.default(2),
      minutes_per_examination: Minutes.default(3),
      minutes_per_order: Minutes.default(1),
      minutes_per_treatment: Minutes.default(2),
      time_budget: z.number().int().positive().nullable().default(null),
      max_actions: z.number().int().positive().default(200),
    })
    .default({
      minutes_per_question: 2,
      minutes_per_examination: 3,
      minutes_per_order: 1,
      minutes_per_treatment: 2,
      time_budget: null,
      max_actions: 200,
    }),
  history: z.array(HistoryItemSchema).min(1),
  examination: z.array(HistoryItemSchema).default([]),
  investigations: z.array(InvestigationSchema).default([]),
  treatments: z.array(TreatmentSchema).default([]),
  events: z.array(TimedEventSchema).default([]),
  gates: z.object({ differential_before_investigations: z.boolean().default(false) }).default({ differential_before_investigations: false }),
  answer: z.object({
    diagnosis: z.object({ accepted: z.array(Text).min(1) }),
    differentials: z.array(z.object({ id: Id, label: Text, accepted: z.array(Text).min(1) })).default([]),
    min_differentials: z.number().int().nonnegative().default(0),
  }),
  rubric: RubricSchema,
  debrief: Text,
  model_pathway: z.array(Text).default([]),
})
export type DiagnosticSimDef = z.infer<typeof DiagnosticSimDefSchema>

export const CATEGORIES = ['history', 'examination', 'investigations', 'treatments'] as const
export type Category = (typeof CATEGORIES)[number]

const ItemRef = { item: Id }
export const DiagnosticSimActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('search'), category: z.enum(CATEGORIES), query: z.string().min(1).max(60) }),
  z.object({ kind: z.literal('ask'), ...ItemRef }),
  z.object({ kind: z.literal('examine'), ...ItemRef }),
  z.object({ kind: z.literal('order'), ...ItemRef }),
  z.object({ kind: z.literal('treat'), ...ItemRef }),
  z.object({ kind: z.literal('advance_time'), minutes: z.number().int().min(1).max(240) }),
  z.object({ kind: z.literal('record_differential'), terms: z.array(z.string().min(1).max(80)).min(1).max(8) }),
  z.object({ kind: z.literal('submit_diagnosis'), text: z.string().min(1).max(120) }),
  z.object({ kind: z.literal('end') }),
])
export type DiagnosticSimAction = z.infer<typeof DiagnosticSimActionSchema>
