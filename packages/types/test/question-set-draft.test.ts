import { describe, it, expect } from 'vitest'
import { emptyQuestionSet, newItem, changeItemType, nextId, slugify } from '../src/question-set-draft'
import { questionSet } from '../src/question-set'

describe('question-set authoring model', () => {
  it('starts from a draft that already passes the schema', () => {
    expect(questionSet.definitionSchema.safeParse(emptyQuestionSet()).success).toBe(true)
  })

  it('gives each new item a fresh id and a valid shape for its type', () => {
    const existing = ['q1', 'q2']
    for (const type of ['single', 'multi', 'numeric', 'short_text'] as const) {
      const item = newItem(type, existing)
      expect(item.id).toBe('q3')
      const draft = { ...emptyQuestionSet(), items: [item] }
      expect(questionSet.definitionSchema.safeParse(draft).success).toBe(true)
    }
  })

  it('keeps the prompt, weight and explanation when the type changes', () => {
    const single = { ...newItem('single', []), prompt: 'Which?', weight: 3, explanation: 'Because.' }
    const changed = changeItemType(single, 'short_text')
    expect(changed).toMatchObject({ id: single.id, type: 'short_text', prompt: 'Which?', weight: 3, explanation: 'Because.' })
    expect(single.type).toBe('single')
  })

  it('carries options across between single and multi choice', () => {
    const single = newItem('single', [])
    const multi = changeItemType(single, 'multi')
    expect(multi.type === 'multi' && multi.options).toEqual(single.type === 'single' && single.options)
  })

  it('nextId never collides', () => {
    expect(nextId('q', ['q1', 'q3'])).toBe('q4')
    expect(nextId('o', [])).toBe('o1')
  })

  it('slugify makes URL-safe slugs', () => {
    expect(slugify('  Chest pain: a 64-year-old!  ')).toBe('chest-pain-a-64-year-old')
    expect(slugify('***')).toBe('challenge')
  })
})
