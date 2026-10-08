/**
 * The set of challenge types an installation knows about. Challenges name
 * their type as `id@version`, so a type can evolve without breaking
 * challenges (and attempts) authored against an older version.
 */
import type { AnyChallengeType, LintIssue } from './contract'

export type ParseResult =
  | { ok: true; definition: unknown; warnings: LintIssue[] }
  | { ok: false; issues: LintIssue[] }

export interface TypeRegistry {
  get(id: string, version: number): AnyChallengeType | undefined
  list(): readonly AnyChallengeType[]
  /**
   * Validates authored data against its type's schema, then its lint: a
   * definition with lint ERRORS is not usable. Never throws.
   */
  parseDefinition(id: string, version: number, raw: unknown): ParseResult
}

const keyOf = (id: string, version: number): string => `${id}@${version}`

export function createTypeRegistry(types: readonly AnyChallengeType[]): TypeRegistry {
  const byKey = new Map<string, AnyChallengeType>()
  for (const type of types) {
    const key = keyOf(type.id, type.version)
    if (byKey.has(key)) throw new Error(`Challenge type ${key} is registered twice.`)
    byKey.set(key, type)
  }
  const all = [...types]

  return {
    get: (id, version) => byKey.get(keyOf(id, version)),
    list: () => all,
    parseDefinition(id, version, raw) {
      const type = byKey.get(keyOf(id, version))
      if (!type) return { ok: false, issues: [{ path: '', severity: 'error', message: `Unknown challenge type ${keyOf(id, version)}.` }] }
      const parsed = type.definitionSchema.safeParse(raw)
      if (parsed.success) {
        const lint = type.lint(parsed.data)
        const errors = lint.filter((i) => i.severity === 'error')
        if (errors.length > 0) return { ok: false, issues: errors }
        return { ok: true, definition: parsed.data, warnings: lint.filter((i) => i.severity === 'warning') }
      }
      return {
        ok: false,
        issues: parsed.error.issues.map((i) => ({ path: i.path.join('.'), severity: 'error' as const, message: i.message })),
      }
    },
  }
}
