/**
 * The pure model behind the schema-driven author form (PLAN.md §3.8): given
 * a challenge type's JSON Schema (generated from its Zod schema), build new
 * values, update them immutably by path, and label things in words.
 */
export interface JsonSchema {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: unknown[]
  const?: unknown
  default?: unknown
  oneOf?: JsonSchema[]
  anyOf?: JsonSchema[]
  minItems?: number
  maxItems?: number
  minimum?: number
  maximum?: number
  minLength?: number
  maxLength?: number
  pattern?: string
  description?: string
  title?: string
  /** A map with free-form keys (e.g. vitals: name → value). */
  additionalProperties?: JsonSchema | boolean
}

/** True for a name → value map (no fixed properties), such as vitals. */
export function isMap(schema: JsonSchema): boolean {
  return schema.type === 'object' && !schema.properties && typeof schema.additionalProperties === 'object'
}

/** Renames a key in a map, keeping its position, without mutating. */
export function renameKey(map: Readonly<Record<string, unknown>>, from: string, to: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k === from ? to : k, v]))
}

export type Path = readonly (string | number)[]

export interface Issue {
  path: string
  severity: string
  message: string
}

/** "chief_complaint" → "Chief complaint". */
export function humanize(key: string): string {
  const words = key.replace(/_/g, ' ').trim()
  return words.charAt(0).toUpperCase() + words.slice(1)
}

/** The non-null member of a nullable `anyOf`, if this is one. */
export function nullableInner(schema: JsonSchema): JsonSchema | null {
  if (!schema.anyOf || schema.anyOf.length !== 2) return null
  const nonNull = schema.anyOf.filter((s) => s.type !== 'null')
  return nonNull.length === 1 && schema.anyOf.some((s) => s.type === 'null') ? (nonNull[0] ?? null) : null
}

/** A fresh value of this shape: declared default, const, required fields, first enum value. */
export function defaultFor(schema: JsonSchema): unknown {
  if (schema.default !== undefined) return structuredClone(schema.default)
  if (schema.const !== undefined) return schema.const
  if (nullableInner(schema)) return null
  if (schema.oneOf?.[0]) return defaultFor(schema.oneOf[0])
  if (schema.enum?.length) return schema.enum[0]
  switch (Array.isArray(schema.type) ? schema.type[0] : schema.type) {
    case 'object': {
      const required = new Set(schema.required ?? [])
      const entries = Object.entries(schema.properties ?? {})
        .filter(([key, prop]) => required.has(key) || prop.default !== undefined)
        .map(([key, prop]) => [key, defaultFor(prop)])
      return Object.fromEntries(entries)
    }
    case 'array':
      return Array.from({ length: schema.minItems ?? 0 }, () => defaultFor(schema.items ?? {}))
    case 'number':
    case 'integer':
      return schema.minimum ?? 0
    case 'boolean':
      return false
    default:
      return ''
  }
}

/** A copy of `doc` with the value at `path` replaced; `undefined` removes an object key. */
export function setAt(doc: unknown, path: Path, value: unknown): unknown {
  if (path.length === 0) return value
  const [head, ...rest] = path as [string | number, ...(string | number)[]]
  if (Array.isArray(doc)) {
    return doc.map((item, i) => (i === head ? setAt(item, rest, value) : item))
  }
  const obj = (doc !== null && typeof doc === 'object' ? doc : {}) as Record<string, unknown>
  const next = setAt(obj[head as string], rest, value)
  if (next === undefined && rest.length === 0) {
    const { [head as string]: _removed, ...kept } = obj
    return kept
  }
  return { ...obj, [head as string]: next }
}

export const removeAt = <T>(list: readonly T[], index: number): T[] => list.filter((_, i) => i !== index)

export function moveItem<T>(list: readonly T[], from: number, delta: number): T[] {
  const to = from + delta
  if (to < 0 || to >= list.length) return [...list]
  const next = [...list]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved as T)
  return next
}

/** "history" with history_1, history_3 → "history_4"; plural collection names become singular prefixes. */
export function nextItemId(collection: string, siblings: readonly unknown[]): string {
  const prefix = collection.replace(/ies$/, 'y').replace(/s$/, '')
  const ids = siblings.map((s) => (s as { id?: unknown })?.id).filter((id): id is string => typeof id === 'string')
  const max = ids
    .map((id) => (id.startsWith(`${prefix}_`) ? Number(id.slice(prefix.length + 1)) : 0))
    .filter(Number.isFinite)
    .reduce((a, b) => Math.max(a, b), 0)
  return `${prefix}_${max + 1}`
}

const SUMMARY_KEYS = ['label', 'title', 'prompt', 'name', 'message', 'id'] as const

/** The line shown on a collapsed card: the most human field the item has. */
export function summaryOf(value: unknown): string {
  if (typeof value !== 'object' || value === null) return String(value ?? '')
  const record = value as Record<string, unknown>
  for (const key of SUMMARY_KEYS) {
    const v = record[key]
    if (typeof v === 'string' && v.trim() !== '') return v
  }
  return ''
}

/** Which member of a discriminated union a value belongs to (by its const field); 0 if none match. */
export function variantIndex(schema: JsonSchema, value: unknown): number {
  const record = (value ?? {}) as Record<string, unknown>
  const index = (schema.oneOf ?? []).findIndex((variant) =>
    Object.entries(variant.properties ?? {}).some(([key, prop]) => prop.const !== undefined && record[key] === prop.const),
  )
  return Math.max(0, index)
}

export const pathKey = (path: Path): string => path.join('.')

export function issuesAt(issues: readonly Issue[], path: Path): Issue[] {
  const key = pathKey(path)
  return issues.filter((i) => i.path === key)
}
