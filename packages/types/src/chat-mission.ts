/**
 * `chat-mission` (interactive, AI): the learner talks to a bot defined by the
 * author (e.g. red-team a deliberately weak assistant) and is graded on goals
 * judged over the conversation the SERVER recorded (PLAN.md §3.6, the Lab's A1).
 *
 * The type is pure: it describes the model call (`llm.chat`) and the grading
 * (`grade`) it needs; the server performs both with no lock held, adding
 * secrets such as API keys and the per-learner canary that replaces
 * {{CANARY}} in the system prompt. Neither secret ever reaches the type's view.
 */
import { z } from 'zod'
import {
  RuleSchema,
  ScoringPolicySchema,
  combineCriteria,
  type ChallengeType,
  type Criterion,
  type LintIssue,
  type RuleResult,
  type StepOutcome,
} from '@challengeforge/engine'

export const CANARY_PLACEHOLDER = '{{CANARY}}'

export const ChatMissionDefSchema = z.object({
  title: z.string().min(1),
  brief: z.string().default(''),
  bot_name: z.string().min(1).default('Assistant'),
  /** SECRET: never shown to learners. May contain {{CANARY}} for leak detection. */
  system_prompt: z.string().min(1),
  model: z.object({
    provider: z.string().min(1),
    model: z.string().min(1),
    max_tokens: z.number().int().positive().max(4000).default(400),
    temperature: z.number().min(0).max(2).optional(),
  }),
  /** Pedagogical cap: messages per attempt, enforced even on the learner's own key. */
  message_cap: z.number().int().positive().max(200),
  max_message_chars: z.number().int().positive().max(4000).default(1000),
  max_history_turns: z.number().int().positive().max(100).default(20),
  /** What counts as success: llm_rubric and canary rules, combined with any_n_of / all_of. */
  goals: RuleSchema,
  goal_labels: z.array(z.string().min(1)).default([]),
  /** How the judge is told what it is grading. A generic framing is used when absent. */
  judge_framing: z.string().optional(),
  scoring: ScoringPolicySchema,
  debrief: z.string().min(1),
})
export type ChatMissionDef = z.infer<typeof ChatMissionDefSchema>

export const ChatMissionActionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('send'), text: z.string().trim().min(1).max(4000) }),
  z.object({ kind: z.literal('finish') }),
])
export type ChatMissionAction = z.infer<typeof ChatMissionActionSchema>

export interface Turn {
  role: 'user' | 'assistant'
  content: string
}

export interface ChatMissionState {
  transcript: readonly Turn[]
  messagesUsed: number
  finishedAt: string | null
  verdict: RuleResult | null
}

export interface ChatMissionView {
  title: string
  brief: string
  botName: string
  transcript: readonly Turn[]
  messagesUsed: number
  messageCap: number
  maxMessageChars: number
  finished: boolean
  goals?: readonly { label: string; passed: boolean; message: string }[]
  debrief?: string
}

const ReplySchema = z.strictObject({ text: z.string() })
const VerdictSchema = z.strictObject({
  correct: z.boolean(),
  outcomes: z.array(z.object({ passed: z.boolean(), message: z.string() }).passthrough()),
  pointsPenalty: z.number(),
  foundIds: z.array(z.string()),
})

const leafCount = (rule: ChatMissionDef['goals']): number => (rule.type === 'all_of' || rule.type === 'any_n_of' ? rule.rules.length : 1)
const needService = (): StepOutcome<ChatMissionState> => ({ ok: false, error: { code: 'service_required', message: 'That could not be completed. Please try again.' } })

function lint(def: ChatMissionDef): LintIssue[] {
  const issues: LintIssue[] = []
  if (def.goal_labels.length > 0 && def.goal_labels.length !== leafCount(def.goals)) {
    issues.push({ path: 'goal_labels', severity: 'error', message: `There are ${leafCount(def.goals)} goals but ${def.goal_labels.length} labels.` })
  }
  const leaves = def.goals.type === 'all_of' || def.goals.type === 'any_n_of' ? def.goals.rules : [def.goals]
  if (leaves.some((r) => r.type === 'canary') && !def.system_prompt.includes(CANARY_PLACEHOLDER)) {
    issues.push({ path: 'system_prompt', severity: 'error', message: `A canary goal needs ${CANARY_PLACEHOLDER} in the system prompt.` })
  }
  if (leaves.some((r) => r.type !== 'llm_rubric' && r.type !== 'canary')) {
    issues.push({ path: 'goals', severity: 'warning', message: 'Only judged (llm_rubric) and canary goals read the conversation.' })
  }
  return issues
}

function view(def: ChatMissionDef, s: ChatMissionState): ChatMissionView {
  const base: ChatMissionView = {
    title: def.title,
    brief: def.brief,
    botName: def.bot_name,
    transcript: s.transcript.map((t) => ({ ...t })),
    messagesUsed: s.messagesUsed,
    messageCap: def.message_cap,
    maxMessageChars: def.max_message_chars,
    finished: s.finishedAt !== null,
  }
  if (!s.finishedAt || !s.verdict) return base
  const goals = s.verdict.outcomes.map((o, i) => ({ label: def.goal_labels[i] ?? `Goal ${i + 1}`, passed: o.passed, message: o.message }))
  return { ...base, goals, debrief: def.debrief }
}

export const chatMission: ChallengeType<ChatMissionDef, ChatMissionState, ChatMissionAction, ChatMissionView> = {
  id: 'chat-mission',
  version: 1,
  paradigm: 'interactive',
  definitionSchema: ChatMissionDefSchema,
  actionSchema: ChatMissionActionSchema,
  lint,
  init: () => ({ transcript: [], messagesUsed: 0, finishedAt: null, verdict: null }),

  prepare(def, s, action) {
    if (action.kind === 'finish') {
      // The judge runs on the challenge's pinned model, so grading is the same for every learner.
      return {
        kind: 'grade',
        payload: { rule: def.goals, transcript: s.transcript, framing: def.judge_framing ?? null, provider: def.model.provider, model: def.model.model },
      }
    }
    if (s.messagesUsed >= def.message_cap || action.text.length > def.max_message_chars) return null
    const history = s.transcript.slice(-def.max_history_turns * 2)
    return {
      kind: 'llm.chat',
      payload: {
        purpose: 'chat',
        callCap: def.message_cap,
        provider: def.model.provider,
        model: def.model.model,
        system: def.system_prompt,
        messages: [...history, { role: 'user', content: action.text }],
        maxTokens: def.model.max_tokens,
        ...(def.model.temperature === undefined ? {} : { temperature: def.model.temperature }),
      },
    }
  },

  async step(def, s, action, env) {
    if (action.kind === 'finish') {
      const verdict = VerdictSchema.safeParse(env.recorded)
      if (!verdict.success) return needService()
      return { ok: true, state: { ...s, finishedAt: env.at, verdict: verdict.data }, effects: verdict.data }
    }
    if (s.messagesUsed >= def.message_cap) {
      return { ok: false, error: { code: 'cap_reached', message: `You have used all ${def.message_cap} messages.` } }
    }
    if (action.text.length > def.max_message_chars) {
      return { ok: false, error: { code: 'too_long', message: `Keep messages under ${def.max_message_chars} characters.` } }
    }
    const reply = ReplySchema.safeParse(env.recorded)
    if (!reply.success) return needService()
    const transcript = [...s.transcript, { role: 'user' as const, content: action.text }, { role: 'assistant' as const, content: reply.data.text }]
    return { ok: true, state: { ...s, transcript, messagesUsed: s.messagesUsed + 1 }, effects: reply.data }
  },

  view,
  isTerminal: (_def, s) => s.finishedAt !== null,

  /** Judged goals are graded once, by the server, when the learner finishes; that verdict is final. */
  async evaluate(def, _trajectory, final) {
    const outcomes = final.verdict?.outcomes ?? []
    const won = final.verdict?.correct === true
    const criteria: Criterion[] = outcomes.map((o, i) => ({
      id: `goal_${i + 1}`,
      label: def.goal_labels[i] ?? `Goal ${i + 1}`,
      // Goals are alternatives ("any 2 of 3"): a mission that succeeds earns its full points.
      score: won || o.passed ? 1 : 0,
      max: 1,
      passed: o.passed,
      feedback: o.message,
    }))
    return { ...combineCriteria(criteria, { passFraction: 0 }), passed: final.verdict?.correct === true }
  },

  pointsInput: (def) => ({ basePoints: def.scoring.base_points, hintCosts: [], hintIndicesUsed: [] }),
}
