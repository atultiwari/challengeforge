import 'server-only'
import { ValidationError } from '@challengeforge/db'

/** Reads a required string field from a JSON body; a missing or oversized one is a 422 naming the field. */
export function text(body: Record<string, unknown>, key: string, max = 200): string {
  const v = body[key]
  if (typeof v !== 'string' || v.trim() === '' || v.length > max) throw new ValidationError(`Fill in "${key}" (up to ${max} characters).`)
  return v
}

export function optionalText(body: Record<string, unknown>, key: string, max = 200): string | undefined {
  return body[key] === undefined || body[key] === '' ? undefined : text(body, key, max)
}

export function optionalBool(body: Record<string, unknown>, key: string): boolean | undefined {
  const v = body[key]
  if (v === undefined) return undefined
  if (typeof v !== 'boolean') throw new ValidationError(`"${key}" must be true or false.`)
  return v
}

/** An ISO date-time, or undefined; anything unparseable is a 422. */
export function optionalDate(body: Record<string, unknown>, key: string): Date | undefined {
  const v = optionalText(body, key, 40)
  if (v === undefined) return undefined
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) throw new ValidationError(`"${key}" is not a valid date.`)
  return d
}

export function oneOf<T extends string>(body: Record<string, unknown>, key: string, allowed: readonly T[]): T {
  const v = body[key]
  if (typeof v !== 'string' || !(allowed as readonly string[]).includes(v)) throw new ValidationError(`"${key}" must be one of: ${allowed.join(', ')}.`)
  return v as T
}
