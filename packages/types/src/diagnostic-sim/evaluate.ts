/**
 * Grades the reasoning path of a diagnostic case with the engine's
 * domain-free trajectory primitives (PLAN.md §3.3). Always evaluated against
 * the CURRENT definition, so a corrected rubric re-grades past attempts.
 */
import {
  avoided,
  before,
  combineCriteria,
  coverage,
  efficiency,
  matchesAnyTerm,
  type Assessment,
  type CriticalPolicy,
  type Criterion,
} from '@challengeforge/engine'
import type { DiagnosticSimDef } from './schema'
import type { DiagnosticSimState } from './state'

function labelsOf(def: DiagnosticSimDef): Record<string, string> {
  const all = [...def.history, ...def.examination, ...def.investigations, ...def.treatments]
  return Object.fromEntries(all.map((i) => [i.id, i.label]))
}

const idsTagged = <T extends { id: string; tag: string }>(items: readonly T[], ...tags: string[]): string[] =>
  items.filter((i) => tags.includes(i.tag)).map((i) => i.id)

function safetyCriterion(def: DiagnosticSimDef, s: DiagnosticSimState, labels: Record<string, string>): Criterion {
  const forbiddenItems = [
    ...def.investigations.filter((i) => i.tag === 'harmful'),
    ...def.treatments.filter((t) => t.tag === 'contraindicated'),
  ]
  const criterion = avoided(
    { id: 'safety', label: 'Avoided harmful actions', weight: 0, critical: true, labels, forbidden: forbiddenItems.map((i) => i.id) },
    s.trail,
  )
  if (criterion.passed) return criterion
  const done = new Set(s.trail.map((t) => t.target))
  const reasons = forbiddenItems.filter((i) => done.has(i.id) && i.reason).map((i) => `${i.label}: ${i.reason}`)
  return { ...criterion, feedback: [criterion.feedback, ...reasons].join(' ') }
}

function diagnosisCriterion(def: DiagnosticSimDef, s: DiagnosticSimState): Criterion {
  const weight = def.rubric.weights.diagnosis
  const passed = s.diagnosis !== null && matchesAnyTerm(s.diagnosis, def.answer.diagnosis.accepted)
  return {
    id: 'diagnosis',
    label: 'Final diagnosis',
    score: passed ? weight : 0,
    max: weight,
    passed,
    feedback: passed ? 'Correct diagnosis.' : `The expected diagnosis was ${def.answer.diagnosis.accepted[0] ?? ''}.`,
  }
}

function differentialsCriterion(def: DiagnosticSimDef, s: DiagnosticSimState): Criterion {
  const weight = def.rubric.weights.differentials
  const terms = s.differential ?? []
  const matched = def.answer.differentials.filter((d) => terms.some((t) => matchesAnyTerm(t, d.accepted)))
  const needed = def.answer.min_differentials
  const passed = matched.length >= needed
  return {
    id: 'differentials',
    label: 'Differential diagnosis',
    score: weight * Math.min(1, matched.length / Math.max(1, needed)),
    max: weight,
    passed,
    feedback: `Considered ${matched.length} of the key differentials: ${def.answer.differentials.map((d) => d.label).join(', ')}.`,
  }
}

function criticalPolicy(def: DiagnosticSimDef): CriticalPolicy {
  const c = def.rubric.critical
  return c.mode === 'cap' ? { mode: 'cap', capFraction: c.cap_fraction } : { mode: 'fail' }
}

export function evaluateCase(def: DiagnosticSimDef, s: DiagnosticSimState): Assessment {
  const { rubric } = def
  const w = rubric.weights
  const labels = labelsOf(def)
  const path = s.trail
  const essentialHistory = idsTagged(def.history, 'essential')
  const essentialExam = idsTagged(def.examination, 'essential')
  const essentialInvestigations = idsTagged(def.investigations, 'essential')
  const essentialTreatments = idsTagged(def.treatments, 'essential')

  const criteria: Criterion[] = [
    coverage({ id: 'history', label: 'History', weight: w.history, labels, kinds: ['ask'], required: essentialHistory, min: rubric.min_history ?? essentialHistory.length }, path),
    coverage({ id: 'examination', label: 'Examination', weight: w.examination, labels, kinds: ['examine'], required: essentialExam, min: rubric.min_examination ?? essentialExam.length }, path),
    coverage({ id: 'investigations', label: 'Key investigations', weight: w.investigations, labels, kinds: ['order'], required: essentialInvestigations, min: rubric.min_investigations ?? essentialInvestigations.length }, path),
    efficiency({ id: 'efficiency', label: 'Avoided unnecessary tests', weight: w.efficiency, labels, counted: idsTagged(def.investigations, 'unnecessary', 'harmful'), maxAllowed: rubric.max_unnecessary }, path),
    coverage({ id: 'management', label: 'Management', weight: w.management, labels, kinds: ['treat'], required: essentialTreatments, min: rubric.min_management ?? essentialTreatments.length }, path),
    safetyCriterion(def, s, labels),
    ...rubric.ordering.map((o) =>
      before(
        {
          id: o.id,
          label: o.label,
          weight: o.weight,
          labels,
          first: o.first,
          ...(o.then === undefined ? {} : { then: o.then }),
          ...(o.by_time === undefined ? {} : { byTime: o.by_time }),
          ...(o.required === undefined ? {} : { required: o.required }),
          ...(o.critical === undefined ? {} : { critical: o.critical }),
        },
        path,
      ),
    ),
    diagnosisCriterion(def, s),
    differentialsCriterion(def, s),
  ]
  return combineCriteria(criteria, { passFraction: rubric.pass_fraction, critical: criticalPolicy(def) })
}
