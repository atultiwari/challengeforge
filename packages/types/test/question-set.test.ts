import { describe, it, expect } from 'vitest'
import { act, assess, pointsFor, startAttempt } from '@challengeforge/engine'
import { questionSet, type QuestionSetDef } from '../src/question-set'
import { registry } from '../src'

const raw = {
  title: 'Clinical case quiz (synthetic)',
  intro: 'A 64-year-old presents with chest pain. Answer the questions.',
  items: [
    {
      id: 'q1',
      type: 'single',
      prompt: 'Which test first?',
      options: [{ id: 'ecg', text: 'ECG' }, { id: 'ct', text: 'CT head' }],
      answer: 'ecg',
      explanation: 'An ECG within 10 minutes.',
    },
    {
      id: 'q2',
      type: 'multi',
      prompt: 'Which are red flags?',
      options: [{ id: 'a', text: 'Radiation to the jaw' }, { id: 'b', text: 'Sweating' }, { id: 'c', text: 'Pain on pressing the chest wall' }],
      answers: ['a', 'b'],
      weight: 2,
      explanation: 'Chest-wall tenderness makes cardiac pain less likely but does not exclude it.',
    },
    { id: 'q3', type: 'numeric', prompt: 'Troponin cut-off (ng/L)?', value: 14, tolerance: 0, unit: 'ng/L', explanation: 'The 99th centile.' },
    { id: 'q4', type: 'short_text', prompt: 'Name the diagnosis.', accepted: ['acute coronary syndrome', 'ACS'], explanation: 'Treat as ACS.' },
  ],
  pass_fraction: 0.6,
  scoring: { base_points: 50 },
}
const def: QuestionSetDef = questionSet.definitionSchema.parse(raw)
const ctx = { attemptId: 'a', userId: 'u', challengeId: 'quiz', seed: 1 }
const env = { services: {}, at: '2026-10-08T10:00:00.000Z' }

async function submit(answers: Record<string, unknown>) {
  const { attempt } = startAttempt(questionSet, def, ctx)
  const r = await act(questionSet, def, attempt, { kind: 'submit', answers }, env)
  if (!r.ok) throw new Error(r.error.message)
  return { ...r, assessment: await assess(questionSet, def, r.attempt, [r.event], {}) }
}

const ALL_RIGHT = { q1: 'ecg', q2: ['a', 'b'], q3: '14', q4: 'ACS' }

describe('question-set definition', () => {
  it('parses, applies defaults and is registered', () => {
    expect(def.items[0]?.weight).toBe(1)
    expect(registry.get('question-set', 1)).toBe(questionSet)
    expect(questionSet.lint(def)).toEqual([])
  })

  it('lint catches answer keys that point at missing options, duplicate ids and empty weights', () => {
    const broken = questionSet.definitionSchema.parse({
      ...raw,
      items: [
        { ...raw.items[0], answer: 'nope' },
        { ...raw.items[1], id: 'q1', answers: ['a', 'zzz'] },
        { ...raw.items[2], weight: 0 },
      ],
    })
    const paths = questionSet.lint(broken).map((i) => i.path)
    expect(paths).toEqual(expect.arrayContaining(['items.0.answer', 'items.1.id', 'items.1.answers']))
    const zero = questionSet.definitionSchema.parse({ ...raw, items: [{ ...raw.items[0], weight: 0 }] })
    expect(questionSet.lint(zero).map((i) => i.path)).toContain('items')
  })

  it('rejects a single-choice item with fewer than two options', () => {
    expect(questionSet.definitionSchema.safeParse({ ...raw, items: [{ ...raw.items[0], options: [{ id: 'x', text: 'x' }] }] }).success).toBe(false)
  })
})

describe('question-set play', () => {
  it('shows the questions without answers or explanations', () => {
    const { view } = startAttempt(questionSet, def, ctx)
    const json = JSON.stringify(view)
    expect(view.items).toHaveLength(4)
    expect(json).not.toContain('"answer"')
    expect(json).not.toContain('acute coronary')
    expect(json).not.toContain('99th centile')
  })

  it('one submission ends the attempt and then reveals per-item results with explanations', async () => {
    const { attempt, view } = await submit({ ...ALL_RIGHT, q1: 'ct' })
    expect(attempt.status).toBe('terminal')
    expect(view.results?.find((r) => r.id === 'q1')).toMatchObject({ correct: false, explanation: 'An ECG within 10 minutes.', correctAnswer: 'ECG' })
    expect(view.results?.find((r) => r.id === 'q4')).toMatchObject({ correct: true })
  })

  it('grades every type of item, weighting each', async () => {
    const { assessment } = await submit(ALL_RIGHT)
    expect(assessment).toMatchObject({ score: 5, max: 5, passed: true })
    expect(pointsFor(assessment, questionSet.pointsInput!(def, {} as never))).toBe(50)
  })

  it('gives partial credit on multi-select, net of wrong picks', async () => {
    const half = await submit({ ...ALL_RIGHT, q2: ['a'] })
    expect(half.assessment.criteria.find((c) => c.id === 'q2')).toMatchObject({ score: 1, max: 2, passed: false })
    const noisy = await submit({ ...ALL_RIGHT, q2: ['a', 'b', 'c'] })
    expect(noisy.assessment.criteria.find((c) => c.id === 'q2')).toMatchObject({ score: 1, passed: false })
  })

  it('fails below the pass mark, and copes with blank or hostile answers', async () => {
    const { assessment } = await submit({ q1: { $gt: '' }, q2: 'a', q3: '0x10', q4: ['ACS'] })
    expect(assessment).toMatchObject({ score: 0, passed: false })
  })

  it('rejects malformed submissions at the boundary', async () => {
    const { attempt } = startAttempt(questionSet, def, ctx)
    expect(await act(questionSet, def, attempt, { kind: 'submit' }, env)).toMatchObject({ ok: false, error: { code: 'invalid_action' } })
    const tooMany = Object.fromEntries(Array.from({ length: 300 }, (_, i) => [`q${i}`, 'x']))
    expect(await act(questionSet, def, attempt, { kind: 'submit', answers: tooMany }, env)).toMatchObject({ ok: false, error: { code: 'invalid_action' } })
  })
})
