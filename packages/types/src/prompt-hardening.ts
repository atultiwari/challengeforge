/**
 * `prompt-hardening` (interactive, AI): the learner writes instructions that
 * make a bot safe, and an evaluation replays a HIDDEN battery of attacks and
 * ordinary questions against it (the Lab's A4). Passing needs both: block the
 * attacks AND still help, so "refuse everything" fails.
 *
 * Evaluation is many model calls, so `prepare` asks for it as a background
 * JOB (mode 'job'); the server runs it in bounded slices and applies the
 * report here. The attack prompts never reach the learner's view.
 */
import { z } from 'zod'
import { ScoringPolicySchema, combineCriteria, type ChallengeType, type Criterion, type LintIssue, type StepOutcome } from '@challengeforge/engine'

export const PromptHardeningDefSchema = z.object({
  title: z.string().min(1),
  brief: z.string().default(''),
  bot_name: z.string().min(1).default('Assistant'),
  /** SECRET: the fixed part of the bot's instructions; may contain {{CANARY}}. The learner's text is appended. */
  locked_base: z.string().min(1),
  model: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    reply_max_tokens: z.number().int().positive().max(2000).default(300),
  }),
  max_prompt_chars: z.number().int().positive().max(10_000).default(3000),
  /** SECRET prompts. `label` (e.g. "Asked for a discount") is what the learner sees in results. */
  attacks: z.array(z.object({ id: z.string().min(1), label: z.string().min(1), prompt: z.string().min(1), criterion: z.string().min(1) })).min(1),
  /** Ordinary questions the bot must still answer; shown in results. `need` is what a good answer contains. */
  benign: z.array(z.object({ id: z.string().min(1), prompt: z.string().min(1), need: z.string().min(1) })).min(1),
  min_attack_block_rate: z.number().min(0).max(1),
  min_benign_help_rate: z.number().min(0).max(1),
  max_runs: z.number().int().positive().max(20),
  evaluation_call_cap: z.number().int().positive(),
  judge_call_cap: z.number().int().positive(),
  scoring: ScoringPolicySchema,
  debrief: z.string().min(1),
  /** Where the learner starts: a weak first draft of the instructions. */
  starter_prompt: z.string().default(''),
  /** What the learner is told about the fixed part (the secret text itself is never shown). */
  locked_base_display: z.string().default(''),
  needs_review: z.boolean().default(false),
})
export type PromptHardeningDef = z.infer<typeof PromptHardeningDefSchema>

export const PromptHardeningActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('save_prompt'), text: z.string().max(10_000) }),
  z.object({ kind: z.literal('evaluate') }),
  z.object({ kind: z.literal('finish') }),
])
export type PromptHardeningAction = z.infer<typeof PromptHardeningActionSchema>

export const BatteryReportSchema = z.strictObject({
  items: z.array(
    z.strictObject({
      kind: z.enum(['attack', 'benign']),
      label: z.string(),
      /** Null for attacks: the hidden prompt is never shown. */
      prompt: z.string().nullable(),
      reply: z.string(),
      passed: z.boolean(),
    }),
  ),
  attacksBlocked: z.number().int().nonnegative(),
  attacksTotal: z.number().int().positive(),
  benignHelped: z.number().int().nonnegative(),
  benignTotal: z.number().int().positive(),
})
export type BatteryReport = z.infer<typeof BatteryReportSchema>

export interface PromptHardeningState {
  prompt: string
  runs: number
  lastReport: BatteryReport | null
  passedAt: string | null
  finishedAt: string | null
}

export interface PromptHardeningView {
  title: string
  brief: string
  botName: string
  lockedBaseDisplay: string
  prompt: string
  maxPromptChars: number
  runs: number
  maxRuns: number
  thresholds: { attackBlockRate: number; benignHelpRate: number }
  lastReport: BatteryReport | null
  passed: boolean
  finished: boolean
  debrief?: string
}

const met = (def: PromptHardeningDef, r: BatteryReport) => ({
  blocked: r.attacksBlocked / r.attacksTotal >= def.min_attack_block_rate,
  helped: r.benignHelped / r.benignTotal >= def.min_benign_help_rate,
})

const reject = (code: string, message: string): StepOutcome<PromptHardeningState> => ({ ok: false, error: { code, message } })

function lint(def: PromptHardeningDef): LintIssue[] {
  const ids = [...def.attacks.map((a) => a.id), ...def.benign.map((b) => b.id)]
  const issues: LintIssue[] = []
  if (new Set(ids).size !== ids.length) issues.push({ path: 'attacks', severity: 'error', message: 'Every attack and question needs its own id.' })
  if (def.evaluation_call_cap < (def.attacks.length + def.benign.length) * def.max_runs) {
    issues.push({ path: 'evaluation_call_cap', severity: 'error', message: 'The call cap is too small for every evaluation run to finish.' })
  }
  if (def.judge_call_cap < def.max_runs) issues.push({ path: 'judge_call_cap', severity: 'error', message: 'Each run needs one judge call.' })
  return issues
}

export const promptHardening: ChallengeType<PromptHardeningDef, PromptHardeningState, PromptHardeningAction, PromptHardeningView> = {
  id: 'prompt-hardening',
  version: 1,
  paradigm: 'interactive',
  definitionSchema: PromptHardeningDefSchema,
  actionSchema: PromptHardeningActionSchema,
  lint,
  init: (def) => ({ prompt: def.starter_prompt, runs: 0, lastReport: null, passedAt: null, finishedAt: null }),

  prepare(def, s, action) {
    if (action.kind !== 'evaluate' || s.runs >= def.max_runs || s.prompt.trim() === '') return null
    return {
      kind: 'battery',
      mode: 'job',
      payload: {
        lockedBase: def.locked_base,
        editable: s.prompt,
        provider: def.model.provider,
        model: def.model.model,
        replyMaxTokens: def.model.reply_max_tokens,
        evaluationCallCap: def.evaluation_call_cap,
        judgeCallCap: def.judge_call_cap,
        items: [
          ...def.attacks.map((a) => ({ kind: 'attack', label: a.label, prompt: a.prompt, criterion: a.criterion, showPrompt: false })),
          ...def.benign.map((b) => ({ kind: 'benign', label: b.prompt, prompt: b.prompt, criterion: b.need, showPrompt: true })),
        ],
      },
    }
  },

  async step(def, s, action, env) {
    switch (action.kind) {
      case 'save_prompt':
        if (action.text.length > def.max_prompt_chars) return reject('too_long', `Keep your instructions under ${def.max_prompt_chars} characters.`)
        return { ok: true, state: { ...s, prompt: action.text } }
      case 'finish':
        return { ok: true, state: { ...s, finishedAt: env.at } }
      case 'evaluate': {
        if (s.prompt.trim() === '') return reject('no_prompt', 'Write your instructions first.')
        if (s.runs >= def.max_runs) return reject('no_runs_left', `You have used all ${def.max_runs} evaluation runs.`)
        const report = BatteryReportSchema.safeParse(env.recorded)
        if (!report.success) return reject('service_required', 'The evaluation could not be completed. Please try again.')
        const { blocked, helped } = met(def, report.data)
        const passedAt = blocked && helped ? env.at : s.passedAt
        return { ok: true, state: { ...s, runs: s.runs + 1, lastReport: report.data, passedAt }, effects: report.data }
      }
    }
  },

  view(def, s) {
    const finished = s.passedAt !== null || s.finishedAt !== null || s.runs >= def.max_runs
    return {
      title: def.title,
      brief: def.brief,
      botName: def.bot_name,
      lockedBaseDisplay: def.locked_base_display,
      prompt: s.prompt,
      maxPromptChars: def.max_prompt_chars,
      runs: s.runs,
      maxRuns: def.max_runs,
      thresholds: { attackBlockRate: def.min_attack_block_rate, benignHelpRate: def.min_benign_help_rate },
      lastReport: s.lastReport,
      passed: s.passedAt !== null,
      finished,
      ...(finished ? { debrief: def.debrief } : {}),
    }
  },

  isTerminal: (def, s) => s.passedAt !== null || s.finishedAt !== null || s.runs >= def.max_runs,

  async evaluate(def, _trajectory, final) {
    const report = final.lastReport
    const result = report ? met(def, report) : { blocked: false, helped: false }
    const criteria: Criterion[] = [
      { id: 'blocked', label: 'Blocked the attacks', score: result.blocked ? 1 : 0, max: 1, passed: result.blocked, feedback: report ? `${report.attacksBlocked} of ${report.attacksTotal} blocked.` : 'Never evaluated.' },
      { id: 'helped', label: 'Still helped ordinary users', score: result.helped ? 1 : 0, max: 1, passed: result.helped, feedback: report ? `${report.benignHelped} of ${report.benignTotal} answered well.` : 'Never evaluated.' },
    ]
    return combineCriteria(criteria, { passFraction: 1, needsReview: def.needs_review })
  },

  pointsInput: (def) => ({ basePoints: def.scoring.base_points, hintCosts: [], hintIndicesUsed: [] }),
}
