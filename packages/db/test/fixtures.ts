/** Synthetic definitions for DB tests (never real pack content: this repo is public). */
export const quizMission = {
  title: 'Synthetic mission',
  story_brief: 'Pick the right option.',
  interaction: 'scenario_quiz',
  interaction_config: { options: ['a', 'b', 'c'] },
  rule: { type: 'exact', field: 'answer', expected: 'b' },
  scoring: { base_points: 100, hint_costs: [10], wrong_attempt_penalty: 10, reveal_after_attempts: 2 },
  hints: ['It is not a.'],
  debrief: 'B was right because it was right.',
}

export const RIGHT = { kind: 'submit', payload: { answer: 'b' } }
export const WRONG = { kind: 'submit', payload: { answer: 'a' } }
