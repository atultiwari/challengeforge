/** The shapes of the service requests the built-in types make, checked at the boundary. */
import { z } from 'zod'
import { RuleSchema } from '@challengeforge/engine'

const Turn = z.object({ role: z.enum(['user', 'assistant']), content: z.string() })

export const ChatPayload = z.object({
  purpose: z.string().min(1),
  callCap: z.number().int().positive(),
  provider: z.string().min(1),
  model: z.string().min(1),
  system: z.string().min(1),
  messages: z.array(Turn).min(1),
  maxTokens: z.number().int().positive(),
  temperature: z.number().optional(),
})

export const GradePayload = z.object({
  rule: RuleSchema,
  transcript: z.array(Turn),
  framing: z.string().nullable(),
  provider: z.string().min(1),
  model: z.string().min(1),
})

export const BatteryPayload = z.object({
  lockedBase: z.string().min(1),
  editable: z.string(),
  provider: z.string().min(1),
  model: z.string().min(1),
  replyMaxTokens: z.number().int().positive(),
  evaluationCallCap: z.number().int().positive(),
  judgeCallCap: z.number().int().positive(),
  items: z
    .array(z.object({ kind: z.enum(['attack', 'benign']), label: z.string(), prompt: z.string().min(1), criterion: z.string().min(1), showPrompt: z.boolean() }))
    .min(1),
})
export type BatteryPayload = z.infer<typeof BatteryPayload>

export const BatteryProgress = z.object({ replies: z.array(z.string()) })
