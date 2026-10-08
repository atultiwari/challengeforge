/**
 * Trajectory primitives (PLAN.md §3.3): grade the PATH an interactive attempt
 * took, not just where it ended. Each returns a Criterion for combineCriteria.
 *
 * Types translate their own events into TrajectorySteps, so these primitives
 * know nothing about medicine, security or any other domain.
 */
import type { Criterion } from './assessment'

export interface TrajectoryStep {
  seq: number
  /** Type-defined verb, e.g. 'ask', 'order', 'treat'. */
  kind: string
  /** The catalog item acted on. */
  target: string
  /** Simulated time (type-defined units, e.g. minutes) when it happened. */
  time: number
}

interface BaseSpec {
  id: string
  label: string
  weight: number
  critical?: boolean
  /** Item labels for learner-facing feedback; ids are used when absent. */
  labels?: Readonly<Record<string, string>>
}

const nameOf = (spec: BaseSpec, id: string): string => spec.labels?.[id] ?? id
const firstNames = (spec: BeforeSpec): string =>
  (typeof spec.first === 'string' ? [spec.first] : spec.first).map((id) => nameOf(spec, id)).join(' or ')
const criticalFlag = (spec: BaseSpec): Pick<Criterion, 'critical'> => (spec.critical ? { critical: true } : {})

/** Earlier in simulated time; same-time ties go to the lower sequence number. */
const isEarlier = (a: TrajectoryStep, b: TrajectoryStep): boolean => a.time < b.time || (a.time === b.time && a.seq < b.seq)

/** The earliest step acting on any of the targets (optionally only of some kinds). */
function earliest(
  steps: readonly TrajectoryStep[],
  targets: string | readonly string[],
  kinds?: readonly string[],
): TrajectoryStep | undefined {
  const wanted = typeof targets === 'string' ? [targets] : targets
  return steps
    .filter((s) => wanted.includes(s.target) && (kinds === undefined || kinds.includes(s.kind)))
    .reduce<TrajectoryStep | undefined>((best, s) => (best === undefined || isEarlier(s, best) ? s : best), undefined)
}

export interface CoverageSpec extends BaseSpec {
  required: readonly string[]
  /** How many of `required` must be covered to pass. */
  min: number
  /** Only count steps of these kinds. Default: any kind. */
  kinds?: readonly string[]
}

/** "Covered at least N of the essential items", with proportional credit. */
export function coverage(spec: CoverageSpec, steps: readonly TrajectoryStep[]): Criterion {
  const counted = spec.kinds ? steps.filter((s) => spec.kinds?.includes(s.kind)) : steps
  const done = new Set(counted.map((s) => s.target))
  const hit = spec.required.filter((id) => done.has(id))
  const missed = spec.required.filter((id) => !done.has(id))
  const fraction = spec.required.length === 0 ? 1 : hit.length / spec.required.length
  return {
    id: spec.id,
    label: spec.label,
    score: spec.weight * fraction,
    max: spec.weight,
    passed: hit.length >= spec.min,
    feedback:
      missed.length === 0
        ? `Covered all ${spec.required.length}.`
        : `Covered ${hit.length} of ${spec.required.length}. Missed: ${missed.map((id) => nameOf(spec, id)).join(', ')}.`,
    ...criticalFlag(spec),
  }
}

export interface AvoidedSpec extends BaseSpec {
  forbidden: readonly string[]
}

/** "Did none of these" — harmful drugs, contraindicated tests. */
export function avoided(spec: AvoidedSpec, steps: readonly TrajectoryStep[]): Criterion {
  const done = new Set(steps.map((s) => s.target))
  const violations = spec.forbidden.filter((id) => done.has(id))
  const passed = violations.length === 0
  return {
    id: spec.id,
    label: spec.label,
    score: passed ? spec.weight : 0,
    max: spec.weight,
    passed,
    feedback: passed ? 'None of these were done.' : `Should have been avoided: ${violations.map((id) => nameOf(spec, id)).join(', ')}.`,
    ...criticalFlag(spec),
  }
}

export interface BeforeSpec extends BaseSpec {
  /** One item, or any of several (the earliest counts). */
  first: string | readonly string[]
  /**
   * Only steps of these kinds count for `first`, e.g. ['result'] so that a
   * test whose result is not back yet does not count as "known".
   */
  firstKinds?: readonly string[]
  /** `first` must happen before this, if this happens. */
  then?: string
  /** `first` must happen at or before this simulated time. */
  byTime?: number
  /** Fail if `first` never happens, even when `then` never does. */
  required?: boolean
}

/**
 * Ordering and deadlines, compared in simulated time: "potassium result back
 * before insulin", "antibiotics within 60 minutes".
 */
export function before(spec: BeforeSpec, steps: readonly TrajectoryStep[]): Criterion {
  const firstStep = earliest(steps, spec.first, spec.firstKinds)
  const thenStep = spec.then === undefined ? undefined : earliest(steps, spec.then)

  const orderOk = thenStep === undefined || (firstStep !== undefined && isEarlier(firstStep, thenStep))
  const deadlineOk = spec.byTime === undefined || (firstStep !== undefined && firstStep.time <= spec.byTime)
  const requiredOk = !spec.required || firstStep !== undefined
  const passed = orderOk && deadlineOk && requiredOk

  return {
    id: spec.id,
    label: spec.label,
    score: passed ? spec.weight : 0,
    max: spec.weight,
    passed,
    feedback: passed ? 'Done in time.' : `${firstNames(spec)} was not done when it needed to be.`,
    ...criticalFlag(spec),
  }
}

export interface EfficiencySpec extends BaseSpec {
  /** Items that count against the learner, e.g. unnecessary investigations. */
  counted: readonly string[]
  maxAllowed: number
  /** Default: a quarter of the weight per extra item. */
  penaltyPerExtra?: number
}

/** "Didn't over-investigate": a deduction per unnecessary item beyond an allowance. */
export function efficiency(spec: EfficiencySpec, steps: readonly TrajectoryStep[]): Criterion {
  const done = new Set(steps.map((s) => s.target))
  const used = spec.counted.filter((id) => done.has(id))
  const extra = Math.max(0, used.length - spec.maxAllowed)
  const penalty = spec.penaltyPerExtra ?? spec.weight / 4
  const passed = extra === 0
  return {
    id: spec.id,
    label: spec.label,
    score: Math.max(0, spec.weight - extra * penalty),
    max: spec.weight,
    passed,
    feedback: used.length === 0 ? 'No unnecessary items.' : `Not needed here: ${used.map((id) => nameOf(spec, id)).join(', ')}.`,
    ...criticalFlag(spec),
  }
}

export interface FrequencySpec extends BaseSpec {
  /** Any of these items counts, e.g. a gas or a lab panel for potassium. */
  items: readonly string[]
  minCount: number
  kinds?: readonly string[]
}

/** "Monitored repeatedly": done at least N times, with proportional credit. */
export function frequency(spec: FrequencySpec, steps: readonly TrajectoryStep[]): Criterion {
  const count = steps.filter((s) => spec.items.includes(s.target) && (spec.kinds === undefined || spec.kinds.includes(s.kind))).length
  const passed = count >= spec.minCount
  return {
    id: spec.id,
    label: spec.label,
    score: spec.weight * Math.min(1, count / Math.max(1, spec.minCount)),
    max: spec.weight,
    passed,
    feedback: `Done ${count} of the ${spec.minCount} times expected.`,
    ...criticalFlag(spec),
  }
}
