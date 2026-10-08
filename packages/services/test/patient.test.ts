import { describe, expect, it } from 'vitest'
import { groundPatientAnswer, patientSystemPrompt } from '../src'

const payload = {
  provider: 'mock',
  model: 'mock-model',
  callCap: 10,
  persona: 'tired',
  patient: { age: 19, sex: 'female', chief_complaint: 'vomiting' },
  items: [
    { id: 'h_onset', label: 'Onset', response: 'It started two days ago.', keywords: ['onset', 'start', 'how long'] },
    { id: 'h_insulin', label: 'Insulin', response: 'I ran out of insulin.', keywords: ['insulin', 'missed', 'doses'] },
  ],
  recent: [],
  question: 'Have you missed any insulin doses?',
}

describe('the simulated patient is grounded in the case', () => {
  it('keeps a well-formed reply and only ids that exist', () => {
    expect(groundPatientAnswer(payload, 'Sure: {"reply": "I ran out on Monday.", "matched": ["h_insulin", "made-up"]}')).toEqual({ reply: 'I ran out on Monday.', matched: ['h_insulin'] })
  })

  it('falls back to the catalogue search when the model does not answer in JSON (and the mock never does)', () => {
    expect(groundPatientAnswer(payload, 'Happy to help. We are open 9 to 5.')).toEqual({ reply: 'I ran out of insulin.', matched: ['h_insulin'] })
    expect(groundPatientAnswer({ ...payload, question: 'Do you like football?' }, 'not json')).toEqual({ reply: "I'm not sure what you mean. Could you ask me another way?", matched: [] })
  })

  it('tells the model to stay in role, use only the facts, and never diagnose', () => {
    const prompt = patientSystemPrompt(payload)
    expect(prompt).toContain('[h_onset] Onset: It started two days ago.')
    expect(prompt).toMatch(/ONLY use the facts/)
    expect(prompt).toMatch(/Never name a diagnosis/)
  })
})
