/**
 * Authoring checks a clinician sees while filling in the form: problems the
 * schema cannot catch because they span fields.
 */
import { normaliseTerm, type LintIssue } from '@challengeforge/engine'
import { CATEGORIES, type DiagnosticSimDef } from './schema'

function duplicateIds(def: DiagnosticSimDef): LintIssue[] {
  const seen = new Set<string>()
  const issues: LintIssue[] = []
  for (const category of CATEGORIES) {
    def[category].forEach((item, i) => {
      if (seen.has(item.id)) {
        issues.push({ path: `${category}.${i}.id`, severity: 'error', message: `The id "${item.id}" is used more than once.` })
      }
      seen.add(item.id)
    })
  }
  return issues
}

function unknownRefs(def: DiagnosticSimDef): LintIssue[] {
  const known = new Set(CATEGORIES.flatMap((c) => def[c].map((i) => i.id)))
  const issues: LintIssue[] = []
  const check = (path: string, ids: readonly string[]) => {
    const missing = ids.filter((id) => !known.has(id))
    if (missing.length > 0) issues.push({ path, severity: 'error', message: `Unknown item: ${missing.join(', ')}.` })
  }
  def.events.forEach((e, i) => check(`events.${i}.unless_done`, e.unless_done))
  def.rubric.ordering.forEach((o, i) => {
    check(`rubric.ordering.${i}.first`, o.first)
    if (o.then !== undefined) check(`rubric.ordering.${i}.then`, [o.then])
  })
  return issues
}

function minimums(def: DiagnosticSimDef): LintIssue[] {
  const essentials = (items: readonly { tag: string }[]) => items.filter((i) => i.tag === 'essential').length
  const pairs: [string, number | undefined, number][] = [
    ['rubric.min_history', def.rubric.min_history, essentials(def.history)],
    ['rubric.min_examination', def.rubric.min_examination, essentials(def.examination)],
    ['rubric.min_investigations', def.rubric.min_investigations, essentials(def.investigations)],
    ['rubric.min_management', def.rubric.min_management, essentials(def.treatments)],
    ['answer.min_differentials', def.answer.min_differentials, def.answer.differentials.length],
  ]
  return pairs
    .filter(([, min, available]) => min !== undefined && min > available)
    .map(([path, min, available]) => ({ path, severity: 'error' as const, message: `Requires ${min}, but only ${available} are listed.` }))
}

function rubricSanity(def: DiagnosticSimDef): LintIssue[] {
  const issues: LintIssue[] = []
  if (Object.values(def.rubric.weights).every((w) => w === 0)) {
    issues.push({ path: 'rubric.weights', severity: 'error', message: 'Give at least one domain a weight.' })
  }
  const diagnosisTerms = new Set(def.answer.diagnosis.accepted.map(normaliseTerm))
  def.answer.differentials.forEach((d, i) => {
    if (d.accepted.some((t) => diagnosisTerms.has(normaliseTerm(t)))) {
      issues.push({ path: `answer.differentials.${i}.accepted`, severity: 'warning', message: 'This differential shares a term with the diagnosis.' })
    }
  })
  return issues
}

export function lintCase(def: DiagnosticSimDef): LintIssue[] {
  return [...duplicateIds(def), ...unknownRefs(def), ...minimums(def), ...rubricSanity(def)]
}
