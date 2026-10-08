/**
 * Safe accessors for learner-submitted JSON. Submissions come from a browser,
 * so every read has to survive a hostile or simply broken payload.
 */

/** Reads `field` (dot-path supported) from an unknown payload, or undefined. */
export function readField(payload: unknown, field: string): unknown {
  if (payload === null || typeof payload !== 'object') return undefined
  let current: unknown = payload
  for (const part of field.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    if (!Object.prototype.hasOwnProperty.call(current, part)) return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * Parses a learner-typed number. Accepts "12", "-3", ".5", "12.5", " 12 % ", "12%".
 * Rejects empty strings, NaN, and non-finite values so they cannot slip past a
 * tolerance check.
 */
export function parseLearnerNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value !== 'string') return null
  // Plain decimals only: no hex, exponents or stray percent signs ("1%2%").
  const match = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+))\s*%?\s*$/.exec(value)
  if (!match?.[1]) return null
  const n = Number(match[1])
  return Number.isFinite(n) ? n : null
}

export function readString(payload: unknown, field: string): string | null {
  const v = readField(payload, field)
  return typeof v === 'string' ? v : null
}

export function readArray(payload: unknown, field: string): unknown[] | null {
  const v = readField(payload, field)
  return Array.isArray(v) ? v : null
}
