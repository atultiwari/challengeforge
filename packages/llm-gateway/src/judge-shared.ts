/** Shared by the single and batch judges (and recognised by the mock provider). */

/** The user message of a single-judge request starts with this label. */
export const JUDGE_CRITERION_LABEL = 'CRITERION:'
/** Present in every batch-judge system prompt. */
export const BATCH_MODE_MARKER = 'BATCH mode'

export const MAX_REPLY_CHARS = 4_000
export const MAX_FRAMING_CHARS = 4_000

/**
 * Stops a reply from closing the wrapper and speaking to the judge directly.
 * Truncates first, so a tag cannot be split across the cut.
 */
export function neutralise(text: string, max = MAX_REPLY_CHARS): string {
  return text
    .slice(0, max)
    .replace(/<\/?\s*(bot_repl(y|ies)|item|user_message|patient_message|conversation)\b[^>]*>/gi, '[tag removed]')
}

/**
 * Framing is operator-authored (pack content), not learner input, but it is
 * still checked at the boundary so an empty or runaway framing fails fast.
 */
export function checkFraming(framing: string): string {
  const trimmed = framing.trim()
  if (trimmed === '') throw new Error('Judge framing must not be empty.')
  if (trimmed.length > MAX_FRAMING_CHARS) {
    throw new Error(`Judge framing must be at most ${MAX_FRAMING_CHARS} characters.`)
  }
  return trimmed
}
