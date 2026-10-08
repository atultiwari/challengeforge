/**
 * Performs what challenge types ask for (PLAN.md §3.2). Secrets are added
 * HERE, never in a type: API keys, and the per-learner canary that replaces
 * {{CANARY}}. Every model call goes through the gateway (caps, budget, log).
 */
import { evaluateRule, type Judge } from '@challengeforge/engine'
import { mysqlLlmStore, type Db, type JobSliceRunner, type ServiceRunner } from '@challengeforge/db'
import {
  buildBatchJudgeRequest,
  buildJudgeRequest,
  complete,
  createProviderRegistry,
  deriveCanary,
  GENERIC_JUDGE_FRAMING,
  LlmUserFacingError,
  parseBatchVerdicts,
  parseJudgeVerdict,
  type GatewayCall,
  type GatewayConfig,
} from '@challengeforge/llm-gateway'
import { BatteryPayload, BatteryProgress, ChatPayload, GradePayload } from './payloads'

export const CANARY_PLACEHOLDER = '{{CANARY}}'
/** Judge calls per attempt: one per goal plus retries, bounded. */
const JUDGE_CALL_CAP = 12
/** Battery items per job slice: each is one model call, so a slice stays well under any timeout. */
export const BATTERY_ITEMS_PER_SLICE = 3
/** Free-tier keys rate-limit hard: wait briefly and retry within a slice rather than failing it. */
const RATE_LIMIT_RETRY = { maxAttempts: 3, maxWaitSeconds: 20 }

export interface ServicesConfig {
  gateway: GatewayConfig
  /** Secret for per-learner canaries (never sent to a browser). */
  canarySecret: string
}

type Context = Parameters<ServiceRunner>[1]

/** User-facing gateway errors (cap reached, budget, bad key) keep their message for the learner. */
function userFacing(err: unknown): never {
  if (err instanceof LlmUserFacingError) throw Object.assign(new Error(err.message), { userMessage: err.message, cause: err })
  throw err
}

export function createServiceRunners(db: Db, config: ServicesConfig): { runService: ServiceRunner; runJobSlice: JobSliceRunner } {
  const providers = createProviderRegistry()
  const call = (context: Context, c: Omit<GatewayCall, 'userId' | 'challengeId'>) =>
    complete({ ...c, userId: context.userId, challengeId: context.challengeId }, { store: mysqlLlmStore(db, context.siteId), config: config.gateway, providers }).catch(userFacing)
  const canaryFor = (context: Context) => deriveCanary(context.userId, context.challengeId, config.canarySecret)

  const runService: ServiceRunner = async (request, context) => {
    const canary = canaryFor(context)
    if (request.kind === 'llm.chat') {
      const p = ChatPayload.parse(request.payload)
      const result = await call(context, {
        purpose: p.purpose,
        provider: p.provider,
        model: p.model,
        callCap: p.callCap,
        request: { system: p.system.replaceAll(CANARY_PLACEHOLDER, canary), messages: p.messages, maxTokens: p.maxTokens, ...(p.temperature === undefined ? {} : { temperature: p.temperature }) },
      })
      return { text: result.text }
    }
    if (request.kind === 'grade') {
      const p = GradePayload.parse(request.payload)
      const judge: Judge = async (rubric, transcript, options) => {
        const judged = await call(context, {
          purpose: 'judge',
          provider: p.provider,
          model: p.model,
          callCap: JUDGE_CALL_CAP,
          billing: 'platform_only',
          request: buildJudgeRequest(rubric, transcript, { framing: p.framing ?? GENERIC_JUDGE_FRAMING, showPatient: options?.showPatient === true }),
        })
        return parseJudgeVerdict(judged.text)
      }
      return evaluateRule(p.rule, {}, { challengeId: context.challengeId, userId: context.userId, transcript: p.transcript, canary, judge })
    }
    throw new Error(`No service for "${request.kind}".`)
  }

  const runJobSlice: JobSliceRunner = async (request, progress, context) => {
    if (request.kind !== 'battery') throw new Error(`No job for "${request.kind}".`)
    const p = BatteryPayload.parse(request.payload)
    const done = progress === null ? [] : BatteryProgress.parse(progress).replies
    const canary = canaryFor(context)
    const system = `${p.lockedBase.replaceAll(CANARY_PLACEHOLDER, canary).trim()}\n\n${p.editable.trim()}`

    if (done.length < p.items.length) {
      const next = p.items.slice(done.length, done.length + BATTERY_ITEMS_PER_SLICE)
      const replies: string[] = []
      for (const item of next) {
        const r = await call(context, {
          purpose: 'evaluation',
          billing: 'learner_first',
          rateLimitRetry: RATE_LIMIT_RETRY,
          provider: p.provider,
          model: p.model,
          callCap: p.evaluationCallCap,
          request: { system, messages: [{ role: 'user', content: item.prompt }], maxTokens: p.replyMaxTokens },
        })
        replies.push(r.text)
      }
      return { done: false, progress: { replies: [...done, ...replies] } }
    }
    return { done: true, result: await judgeBattery(context, p, done, canary) }
  }

  async function judgeBattery(context: Context, p: BatteryPayload, replies: readonly string[], canary: string) {
    const batch = p.items.map((item, i) => ({
      n: i + 1,
      kind: item.kind,
      criterion: item.criterion,
      ...(item.kind === 'benign' ? { question: item.prompt } : {}),
      reply: replies[i] ?? '',
    }))
    const judged = await call(context, {
      purpose: 'judge',
      billing: 'platform_only',
      rateLimitRetry: RATE_LIMIT_RETRY,
      provider: p.provider,
      model: p.model,
      callCap: p.judgeCallCap,
      request: buildBatchJudgeRequest(batch),
    })
    const verdicts = parseBatchVerdicts(judged.text, batch.map((b) => b.n))
    const needle = canary.toLowerCase()
    const items = p.items.map((item, i) => {
      const reply = replies[i] ?? ''
      // A canary in the reply is a leak, whatever the judge says.
      const passed = verdicts.get(i + 1) === true && !(item.kind === 'attack' && reply.toLowerCase().includes(needle))
      return { kind: item.kind, label: item.label, prompt: item.showPrompt ? item.prompt : null, reply, passed }
    })
    const attacks = items.filter((i) => i.kind === 'attack')
    const benign = items.filter((i) => i.kind === 'benign')
    return {
      items,
      attacksBlocked: attacks.filter((i) => i.passed).length,
      attacksTotal: attacks.length,
      benignHelped: benign.filter((i) => i.passed).length,
      benignTotal: benign.length,
    }
  }

  return { runService, runJobSlice }
}
export { servicesConfigFromEnv } from './config'
