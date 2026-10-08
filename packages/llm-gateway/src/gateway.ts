import { assertPlatformBudget, reserveChallengeCall } from './caps'
import type { GatewayConfig } from './config'
import { resolveCredential } from './credentials/resolve'
import type { ResolvedCredential } from './credentials/resolve'
import { MOCK_CONFIG, mockProvider } from './providers/mock'
import { createProviderRegistry } from './providers/registry'
import type { ProviderRegistry } from './providers/registry'
import { LlmProviderError } from './providers/types'
import type { LlmProvider, LlmRequest, LlmResponse, ProviderConfig } from './providers/types'
import type { CredentialSource, LlmStore } from './store'
import { toUserFacing } from './user-facing'

/**
 * THE single entry point for every model call.
 *
 * Nothing else in the codebase may call a provider directly. Routing
 * everything through here is what makes the call caps, the token logging and
 * the BYOK accounting true rather than aspirational.
 *
 * The caller supplies the provider and model. For graded challenges these are
 * PINNED by the challenge content, so the bot a learner attacks is the same
 * one every other learner attacks, whoever pays for the call.
 */
export interface GatewayCall {
  readonly userId: string
  readonly challengeId: string
  /** Separates cap budgets, e.g. 'chat' vs 'judge' vs 'evaluation'. */
  readonly purpose: string
  readonly provider: string
  readonly model: string
  /** Pedagogical cap for this purpose. Enforced for BYOK too. */
  readonly callCap: number
  /**
   * 'learner_first' (default): the learner's own key if they saved one, else
   * the platform's. 'platform_only': grading calls, always on the platform key
   * and bounded by their own call cap rather than the per-learner budget.
   */
  readonly billing?: 'learner_first' | 'platform_only'
  /**
   * Opt-in: when the provider says "too many requests", wait the time it asks
   * for and try again, up to maxAttempts in total - unless it asks for longer
   * than maxWaitSeconds. Lets a free-tier key (15 requests a minute on
   * Gemini) finish an evaluation run slowly instead of failing it.
   */
  readonly rateLimitRetry?: RateLimitRetry
  readonly request: Omit<LlmRequest, 'model'>
}

export interface RateLimitRetry {
  readonly maxAttempts: number
  readonly maxWaitSeconds: number
}

export type Sleep = (ms: number) => Promise<void>

export interface GatewayDeps {
  readonly store: LlmStore
  readonly config: GatewayConfig
  readonly providers?: ProviderRegistry
  readonly sleep?: Sleep
}

export interface GatewayResult extends LlmResponse {
  readonly provider: string
  readonly credentialSource: CredentialSource
  readonly callsRemaining: number
  /** True when the development mock answered instead of a real model. */
  readonly simulated: boolean
}

/** Used when a provider rate-limits without saying how long to wait. */
const DEFAULT_RETRY_SECONDS = 10

const realSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let defaultRegistry: ProviderRegistry | null = null
function registryOrDefault(providers: ProviderRegistry | undefined): ProviderRegistry {
  if (providers) return providers
  defaultRegistry ??= createProviderRegistry()
  return defaultRegistry
}

/** Seconds to wait before another attempt, or null to give up now. */
export function rateLimitWait(err: unknown, policy: RateLimitRetry | undefined, attempt: number): number | null {
  if (!policy || attempt >= policy.maxAttempts) return null
  if (!(err instanceof LlmProviderError) || err.kind !== 'rate_limit') return null
  const wait = err.retryAfterSeconds ?? DEFAULT_RETRY_SECONDS
  // Longer waits (a daily quota, for example) are not worth holding a learner for.
  return wait > policy.maxWaitSeconds ? null : wait + 1
}

interface Route {
  readonly provider: string
  readonly model: string
  readonly adapter: LlmProvider
  readonly config: ProviderConfig
  readonly credential: ResolvedCredential
}

const MOCK_ROUTE: Route = {
  provider: 'mock',
  model: 'mock-model',
  adapter: mockProvider,
  config: MOCK_CONFIG,
  credential: { apiKey: 'mock', source: 'platform' },
}

/** Where a call really goes: the pinned model, or the development mock. */
async function route(call: GatewayCall, deps: GatewayDeps, registry: ProviderRegistry): Promise<Route> {
  if (deps.config.llmMock) return MOCK_ROUTE
  const credential = await resolveCredential(deps.store, call.userId, call.provider, deps.config, {
    platformOnly: call.billing === 'platform_only',
  })
  return {
    provider: call.provider,
    model: call.model,
    adapter: registry.adapter(call.provider),
    config: registry.config(call.provider),
    credential,
  }
}

/**
 * The call, retried on rate limits if the caller opted in. The same
 * reservation covers every attempt; a final failure hands the slot back.
 */
async function callWithRetry(
  call: GatewayCall,
  target: Route,
  store: LlmStore,
  reservationId: string,
  sleep: Sleep,
): Promise<LlmResponse> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await target.adapter.chat({ ...call.request, model: target.model }, target.credential.apiKey, target.config)
    } catch (err) {
      const wait = rateLimitWait(err, call.rateLimitRetry, attempt)
      if (wait === null) {
        await store.releaseCall(reservationId)
        throw toUserFacing(err, target.credential.source)
      }
      await sleep(wait * 1000)
    }
  }
}

export async function complete(call: GatewayCall, deps: GatewayDeps): Promise<GatewayResult> {
  const { store, config } = deps
  const registry = registryOrDefault(deps.providers)
  const platformOnly = call.billing === 'platform_only'

  // 1. Where the call goes and whose key pays.
  const target = await route(call, deps, registry)
  const { credential } = target

  // 2. Financial cap, only for learner-driven calls the platform is paying for.
  if (credential.source === 'platform' && !platformOnly) {
    await assertPlatformBudget(store, call.userId, config.platformBudgetUsdPerUser)
  }

  // 3. Pedagogical cap, claimed atomically before the provider is contacted.
  const { reservationId, callsRemaining } = await reserveChallengeCall(store, {
    userId: call.userId,
    challengeId: call.challengeId,
    purpose: call.purpose,
    cap: call.callCap,
    provider: target.provider,
    model: target.model,
    credentialSource: credential.source,
  })

  // 4. The call itself.
  const response = await callWithRetry(call, target, store, reservationId, deps.sleep ?? realSleep)

  // 5. Log every call, whoever paid, so cost measurement works.
  await store.completeCall(reservationId, {
    userId: call.userId,
    challengeId: call.challengeId,
    provider: target.provider,
    model: response.model,
    credentialSource: credential.source,
    purpose: call.purpose,
    inputTokens: response.inputTokens,
    outputTokens: response.outputTokens,
    // Priced by the model we asked for: providers report dated snapshot names.
    costEstimateUsd: config.llmMock
      ? 0
      : registry.estimateCostUsd(call.provider, call.model, response.inputTokens, response.outputTokens),
    requestId: response.requestId,
  })

  return {
    ...response,
    provider: target.provider,
    credentialSource: credential.source,
    callsRemaining,
    simulated: config.llmMock,
  }
}
