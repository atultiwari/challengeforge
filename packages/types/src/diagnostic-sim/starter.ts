import type { DiagnosticSimDef } from './schema'

/**
 * A new case starts as a small but complete skeleton, so a clinician edits
 * something that already works (and previews it) rather than a blank form.
 */
export function starterDiagnosticSim(): DiagnosticSimDef {
  return {
    title: 'New diagnostic case',
    summary: '',
    review: { status: 'draft' },
    presentation: {
      setting: 'Emergency department',
      patient: { age: 45, sex: 'female' },
      chief_complaint: 'Describe the presenting complaint',
      vignette: 'Describe what the learner sees when they first meet the patient.',
      vitals: { 'Heart rate': '80 /min', 'Blood pressure': '120/80 mmHg' },
    },
    sim: { minutes_per_question: 2, minutes_per_examination: 3, minutes_per_order: 1, minutes_per_treatment: 2, time_budget: 120, max_actions: 200 },
    history: [
      { id: 'history_1', label: 'When did this start?', keywords: ['onset', 'start', 'when'], response: 'Write the patient’s answer.', tag: 'essential' },
    ],
    examination: [
      { id: 'examination_1', label: 'General inspection', keywords: ['general', 'inspection', 'look'], response: 'Write the finding.', tag: 'useful' },
    ],
    investigations: [
      {
        id: 'investigation_1',
        label: 'Full blood count',
        keywords: ['fbc', 'blood count'],
        result: 'Write the result.',
        turnaround: 30,
        cost: 1,
        repeatable: false,
        serial_results: [],
        tag: 'useful',
      },
    ],
    treatments: [],
    events: [],
    gates: { differential_before_investigations: false },
    patient_chat: { enabled: false, model: { provider: 'google', model: 'gemini-3.1-flash-lite' }, persona: '', max_questions: 30 },
    answer: { diagnosis: { accepted: ['the diagnosis', 'its abbreviation'] }, differentials: [], min_differentials: 0 },
    rubric: {
      weights: { history: 20, examination: 10, investigations: 10, efficiency: 0, diagnosis: 60, differentials: 0, management: 0 },
      max_unnecessary: 0,
      ordering: [],
      monitoring: [],
      pass_fraction: 0.6,
      critical: { mode: 'fail' },
    },
    debrief: 'Explain the case: what mattered and why.',
    model_pathway: [],
  }
}
