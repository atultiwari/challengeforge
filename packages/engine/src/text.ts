/**
 * Text helpers for authored vocabularies: accepted answer terms and
 * searchable catalogs (search-to-reveal, PLAN.md §3.5).
 */

/** Lowercase, strip accents, turn punctuation into spaces, collapse whitespace. */
export function normaliseTerm(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Whole-term match against any accepted term (and its synonyms), after normalisation. */
export function matchesAnyTerm(input: string, accepted: readonly string[]): boolean {
  const needle = normaliseTerm(input)
  if (needle === '') return false
  return accepted.some((term) => normaliseTerm(term) === needle)
}

export interface SearchableItem {
  id: string
  label: string
  keywords?: readonly string[]
}

export interface SearchOptions {
  /** Shortest query accepted, so a learner cannot list the catalog with "a". */
  minLength?: number
  limit?: number
}

const DEFAULT_MIN_LENGTH = 2
const DEFAULT_LIMIT = 8

function wordsOf(item: SearchableItem): string[] {
  return [item.label, ...(item.keywords ?? [])].flatMap((t) => normaliseTerm(t).split(' ')).filter(Boolean)
}

/**
 * Items whose label or keywords contain a word starting with every word of
 * the query. Prefix matching keeps "gluc" useful without letting "lucose" in.
 */
export function searchCatalog<T extends SearchableItem>(items: readonly T[], query: string, options: SearchOptions = {}): T[] {
  const q = normaliseTerm(query)
  if (q.length < (options.minLength ?? DEFAULT_MIN_LENGTH)) return []
  const queryWords = q.split(' ')
  return items
    .filter((item) => {
      const words = wordsOf(item)
      return queryWords.every((qw) => words.some((w) => w.startsWith(qw)))
    })
    .slice(0, options.limit ?? DEFAULT_LIMIT)
}
