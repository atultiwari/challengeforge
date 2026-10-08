import type { SetMatchRule } from './schema'
import type { Validator } from './types'
import { readArray } from '../payload'


interface SubmittedFlag {
  id: string
  category: string | null
}

/**
 * Pulls well-formed entries out of an untrusted array: {id, category} objects
 * (flagging), or plain ids (a "choose all that apply" question).
 */
function parseFlags(raw: unknown[]): SubmittedFlag[] | null {
  const out: SubmittedFlag[] = []
  for (const entry of raw) {
    if (typeof entry === 'string' && entry !== '') {
      out.push({ id: entry, category: null })
      continue
    }
    if (entry === null || typeof entry !== 'object') return null
    const { id, category } = entry as Record<string, unknown>
    if (typeof id !== 'string' || id === '') return null
    out.push({ id, category: typeof category === 'string' ? category : null })
  }
  return out
}

/** Keeps the first submission for each sentence; re-flagging is not extra credit. */
function dedupe(flags: SubmittedFlag[]): SubmittedFlag[] {
  const seen = new Set<string>()
  return flags.filter((f) => (seen.has(f.id) ? false : (seen.add(f.id), true)))
}

export const validateSetMatch: Validator<SetMatchRule> = (rule, payload) => {
  const raw = readArray(payload, rule.field)
  if (raw === null) return { passed: false, message: 'No flags were submitted.' }

  const parsed = parseFlags(raw)
  if (parsed === null) return { passed: false, message: 'The submitted flags were not in a readable form.' }

  // Aliases first, so both copies of a duplicate collapse to one item.
  const own = <V>(record: Readonly<Record<string, V>>, key: string): V | undefined =>
    Object.hasOwn(record, key) ? record[key] : undefined
  const flags = dedupe(parsed.map((f) => ({ ...f, id: own(rule.aliases, f.id) ?? f.id })))
  const expected = new Set(rule.expected_ids)

  let hits = 0
  let falsePositives = 0
  const foundIds: string[] = []
  for (const f of flags) {
    if (!expected.has(f.id)) {
      // Flagging a sentence that is actually fine.
      falsePositives += 1
      continue
    }
    // A real error tagged with the wrong category is a miss, not a false flag:
    // the learner did spot the sentence, they just misread why it is dangerous.
    const accepted = f.category !== null && (own(rule.categories, f.id) === f.category || (own(rule.also_accept, f.id) ?? []).includes(f.category))
    if (rule.require_category && !accepted) continue
    hits += 1
    foundIds.push(f.id)
  }

  const passed = hits >= rule.min_hits && falsePositives <= rule.max_false_positives
  const message = passed
    ? 'Correct.'
    : hits < rule.min_hits
      ? 'You have not found enough of the problems yet.'
      : 'You flagged too many passages that were actually fine.'

  return { passed, message, detail: { found: hits, required: rule.min_hits, falsePositives }, foundIds }
}
