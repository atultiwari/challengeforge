/**
 * Pure helpers for the question-set author form: every edit returns a new
 * object, and every new item already has a valid shape for its type, so the
 * form never has to invent structure.
 */
import type { QuestionItem, QuestionSetDef } from './question-set'

export type ItemType = QuestionItem['type']

/** The next free id with this prefix: q1, q2... never reusing one in `taken`. */
export function nextId(prefix: string, taken: readonly string[]): string {
  const used = new Set(taken)
  const highest = taken
    .map((id) => (id.startsWith(prefix) ? Number(id.slice(prefix.length)) : 0))
    .filter(Number.isFinite)
    .reduce((max, n) => Math.max(max, n), 0)
  let n = highest + 1
  while (used.has(`${prefix}${n}`)) n += 1
  return `${prefix}${n}`
}

const defaultOptions = () => [
  { id: 'o1', text: 'Option 1' },
  { id: 'o2', text: 'Option 2' },
]

export function newItem(type: ItemType, takenIds: readonly string[]): QuestionItem {
  const base = { id: nextId('q', takenIds), prompt: 'New question', weight: 1, explanation: '' }
  switch (type) {
    case 'single':
      return { ...base, type, options: defaultOptions(), answer: 'o1' }
    case 'multi':
      return { ...base, type, options: defaultOptions(), answers: ['o1'] }
    case 'numeric':
      return { ...base, type, value: 0, tolerance: 0 }
    case 'short_text':
      return { ...base, type, accepted: ['answer'] }
  }
}

/** Switches an item's type, keeping what both shapes share (and the options between choice types). */
export function changeItemType(item: QuestionItem, type: ItemType): QuestionItem {
  if (item.type === type) return item
  const fresh = newItem(type, [])
  const shared = { id: item.id, prompt: item.prompt, weight: item.weight, explanation: item.explanation }
  const options = item.type === 'single' || item.type === 'multi' ? item.options.map((o) => ({ ...o })) : null
  if (type === 'single' && options) return { ...shared, type, options, answer: options[0]?.id ?? 'o1' }
  if (type === 'multi' && options) return { ...shared, type, options, answers: [options[0]?.id ?? 'o1'] }
  return { ...fresh, ...shared } as QuestionItem
}

export function emptyQuestionSet(): QuestionSetDef {
  return {
    title: 'Untitled question set',
    intro: '',
    items: [newItem('single', [])],
    pass_fraction: 0.6,
    scoring: { base_points: 100 },
    debrief: '',
  }
}

export function slugify(text: string): string {
  const slug = text
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
  return slug || 'challenge'
}
