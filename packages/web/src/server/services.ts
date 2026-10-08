import 'server-only'
import { createHmac } from 'node:crypto'
import { z } from 'zod'
import { evaluateRule, RuleSchema, type Judge } from '@challengeforge/engine'
import { mysqlLlmStore, type ServiceRunner } from '@challengeforge/db'
import {
  buildJudgeRequest,
  complete,
  createProviderRegistry,
  deriveCanary,
  GENERIC_JUDGE_FRAMING,
  LlmUserFacingError,
  parseGatewayConfig,
  parseJudgeVerdict,
  type GatewayConfig,
} from '@challengeforge/llm-gateway'
import { db } from './db'
import { env } from './env'

/**
 * Performs the services challenge types ask for (PLAN.md §3.2): model
 * replies and judged grading. Secrets are added HERE, never in a type: API
 * keys, and the per-learner canary that replaces {{CANARY}} in a system prompt.
 * Every model call goes through the gateway (caps, budget, logging).
 */
const CANARY_PLACEHOLDER = '{{CANARY}}'
/** Judge calls per attempt: one per goal plus retries, bounded. */
const JUDGE_CALL_CAP = 12

const registry = createProviderRegistry()

let gatewayConfig: GatewayConfig | null = null
function config(): GatewayConfig {
  if (gatewayConfig) return gatewayConfig
  const e = env()
  const keys: Record<string, string | undefined> = {
    anthropic: e.ANTHROPIC_API_KEY,
    openai: e.OPENAI_API_KEY,
    google: e.GOOGLE_API_KEY,
    openrouter: e.OPENROUTER_API_KEY,
  }
  gatewayConfig = parseGatewayConfig({
    llmMock: e.LLM_MODE === 'mock',
    platformBudgetUsdPerUser: e.LLM_BUDGET_USD_PER_USER,
    byokEnabled: Boolean(e.BYOK_ENCRYPTION_KEY),
    byokEncryptionKey: e.BYOK_ENCRYPTION_KEY ?? null,
    enabledProviders: registry.knownProviders(),
    platformKeys: keys,
  })
  return gatewayConfig
}

function canarySecret(): string {
  const e = env()
  return e.CANARY_SECRET ?? createHmac('sha256', e.BETTER_AUTH_SECRET).update('challengeforge:canary').digest('hex')
}

const ChatPayload = z.object({
  purpose: z.string().min(1),
  callCap: z.number().int().positive(),
  provider: z.string().min(1),
  model: z.string().min(1),
  system: z.string().min(1),
  messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })).min(1),
  maxTokens: z.number().int().positive(),
  temperature: z.number().optional(),
})

const GradePayload = z.object({
  rule: RuleSchema,
  transcript: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })),
  framing: z.string().nullable(),
  provider: z.string().min(1),
  model: z.string().min(1),
})

/** User-facing gateway errors (cap reached, budget, bad key) keep their message for the learner. */
function userFacing(err: unknown): never {
  if (err instanceof LlmUserFacingError) throw Object.assign(new Error(err.message), { userMessage: err.message, cause: err })
  throw err
}

export const serviceRunner: ServiceRunner = async (request, context) => {
  const store = mysqlLlmStore(db(), context.siteId)
  const deps = { store, config: config(), providers: registry }
  const canary = deriveCanary(context.userId, context.challengeId, canarySecret())

  if (request.kind === 'llm.chat') {
    const p = ChatPayload.parse(request.payload)
    const result = await complete(
      {
        userId: context.userId,
        challengeId: context.challengeId,
        purpose: p.purpose,
        provider: p.provider,
        model: p.model,
        callCap: p.callCap,
        request: {
          system: p.system.replaceAll(CANARY_PLACEHOLDER, canary),
          messages: p.messages,
          maxTokens: p.maxTokens,
          ...(p.temperature === undefined ? {} : { temperature: p.temperature }),
        },
      },
      deps,
    ).catch(userFacing)
    return { text: result.text }
  }

  if (request.kind === 'grade') {
    const p = GradePayload.parse(request.payload)
    const judge: Judge = async (rubric, transcript, options) => {
      const judgeRequest = buildJudgeRequest(rubric, transcript, { framing: p.framing ?? GENERIC_JUDGE_FRAMING, showPatient: options?.showPatient === true })
      const result = await complete(
        { userId: context.userId, challengeId: context.challengeId, purpose: 'judge', provider: p.provider, model: p.model, callCap: JUDGE_CALL_CAP, billing: 'platform_only', request: judgeRequest },
        deps,
      ).catch(userFacing)
      return parseJudgeVerdict(result.text)
    }
    return evaluateRule(p.rule, {}, { challengeId: context.challengeId, userId: context.userId, transcript: p.transcript, canary, judge })
  }

  throw new Error(`No service for "${request.kind}".`)
}
