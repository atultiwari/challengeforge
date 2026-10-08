import { describe, it, expect } from 'vitest'
import { normaliseTerm, matchesAnyTerm, searchCatalog } from '../src/text'
import { evaluateRule } from '../src/rules'

describe('normaliseTerm', () => {
  it('lowercases, strips accents and punctuation, and collapses spaces', () => {
    expect(normaliseTerm('  Diabetic   Keto-Acidosis! ')).toBe('diabetic keto acidosis')
    expect(normaliseTerm('Ménière’s disease')).toBe('meniere s disease')
  })
})

describe('matchesAnyTerm', () => {
  const accepted = ['diabetic ketoacidosis', 'DKA']

  it('matches any accepted term after normalisation', () => {
    expect(matchesAnyTerm('Diabetic Ketoacidosis', accepted)).toBe(true)
    expect(matchesAnyTerm(' dka. ', accepted)).toBe(true)
  })

  it('does not match a different condition that merely contains a word', () => {
    expect(matchesAnyTerm('diabetic', accepted)).toBe(false)
    expect(matchesAnyTerm('hyperosmolar state', accepted)).toBe(false)
  })

  it('treats empty input as no match', () => {
    expect(matchesAnyTerm('   ', accepted)).toBe(false)
  })
})

describe('term_match rule', () => {
  const rule = { type: 'term_match' as const, field: 'diagnosis', accepted: ['diabetic ketoacidosis', 'DKA'] }
  const ctx = { challengeId: 'c', userId: 'u' }

  it('passes on any accepted term', async () => {
    expect((await evaluateRule(rule, { diagnosis: 'DKA' }, ctx)).correct).toBe(true)
  })

  it('fails without revealing the accepted terms', async () => {
    const r = await evaluateRule(rule, { diagnosis: 'sepsis' }, ctx)
    expect(r.correct).toBe(false)
    expect(r.outcomes[0]?.message).not.toMatch(/ketoacidosis|dka/i)
  })

  it('fails on a missing or non-text answer', async () => {
    expect((await evaluateRule(rule, {}, ctx)).correct).toBe(false)
    expect((await evaluateRule(rule, { diagnosis: 42 }, ctx)).correct).toBe(false)
  })
})

describe('searchCatalog', () => {
  const items = [
    { id: 'i_glucose', label: 'Capillary blood glucose', keywords: ['sugar', 'cbg', 'bm'] },
    { id: 'i_ketones', label: 'Blood ketones', keywords: ['beta hydroxybutyrate', 'ketone'] },
    { id: 'i_vbg', label: 'Venous blood gas', keywords: ['vbg', 'ph', 'bicarbonate'] },
  ]

  it('matches on label words and keywords, case-insensitively', () => {
    expect(searchCatalog(items, 'Sugar').map((i) => i.id)).toEqual(['i_glucose'])
    expect(searchCatalog(items, 'blood').map((i) => i.id)).toEqual(['i_glucose', 'i_ketones', 'i_vbg'])
    expect(searchCatalog(items, 'ketone').map((i) => i.id)).toEqual(['i_ketones'])
  })

  it('needs a minimum query length so learners cannot list the whole catalog', () => {
    expect(searchCatalog(items, 'b')).toEqual([])
    expect(searchCatalog(items, '  ')).toEqual([])
    expect(searchCatalog(items, 'b v')).toEqual([])
  })

  it('matches prefixes of words, not arbitrary substrings', () => {
    expect(searchCatalog(items, 'gluc').map((i) => i.id)).toEqual(['i_glucose'])
    expect(searchCatalog(items, 'lucose')).toEqual([])
  })

  it('caps the number of results', () => {
    expect(searchCatalog(items, 'blood', { limit: 2 })).toHaveLength(2)
  })
})
