/**
 * What the author UI needs from a type: a starter definition and the
 * definition's JSON Schema, which the generic form renders (PLAN.md §3.8).
 * JSON Schema is plain data, so it can go to the browser; it describes the
 * shape of a challenge, never a challenge's answers.
 */
import { z } from 'zod'
import { DiagnosticSimDefSchema } from './diagnostic-sim'
import { starterDiagnosticSim } from './diagnostic-sim/starter'
import { QuestionSetDefSchema } from './question-set'
import { emptyQuestionSet } from './question-set-draft'

export const FORM_AUTHORED_TYPES = ['question-set', 'diagnostic-sim'] as const
export type FormAuthoredType = (typeof FORM_AUTHORED_TYPES)[number]

const SCHEMAS: Record<FormAuthoredType, z.ZodType> = {
  'question-set': QuestionSetDefSchema,
  'diagnostic-sim': DiagnosticSimDefSchema,
}

const STARTERS: Record<FormAuthoredType, () => unknown> = {
  'question-set': emptyQuestionSet,
  'diagnostic-sim': starterDiagnosticSim,
}

export const isFormAuthored = (typeId: string): typeId is FormAuthoredType => (FORM_AUTHORED_TYPES as readonly string[]).includes(typeId)

export function authoringSchema(typeId: string): unknown {
  if (!isFormAuthored(typeId)) throw new Error(`Challenge type ${typeId} is not authored through a form.`)
  // 'input' so fields with defaults are optional in the form, as they are when authoring.
  const schema = z.toJSONSchema(SCHEMAS[typeId], { io: 'input', unrepresentable: 'any' })
  // Round-trip to plain JSON: the result crosses to the browser as data.
  return JSON.parse(JSON.stringify(schema)) as unknown
}

export function starterDefinition(typeId: string): unknown {
  if (!isFormAuthored(typeId)) throw new Error(`Challenge type ${typeId} is not authored through a form.`)
  return STARTERS[typeId]()
}
