/** A question a learner answers after studying the evidence. Which answer is right lives in the answer key. */
export interface ChoiceQuestion {
  id: string
  prompt: string
  help?: string
  /** single: choose one; multi: choose all that apply. */
  type: 'single' | 'multi'
  options: { id: string; text: string }[]
}

export interface NumericQuestion {
  id: string
  prompt: string
  help?: string
  type: 'numeric'
  unit?: string
  placeholder?: string
}

export type Question = ChoiceQuestion | NumericQuestion

export type AnswerValue = string | readonly string[]
export type Answers = Readonly<Record<string, AnswerValue>>

export function isAnswered(value: AnswerValue | undefined): boolean {
  if (Array.isArray(value)) return value.length > 0
  return typeof value === 'string' && value.trim() !== ''
}
