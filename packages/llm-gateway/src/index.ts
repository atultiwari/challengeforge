// Gateway entry point
export { complete, rateLimitWait } from './gateway'
export type { GatewayCall, GatewayDeps, GatewayResult, RateLimitRetry, Sleep } from './gateway'
export { parseGatewayConfig } from './config'
export type { GatewayConfig } from './config'
export { summariseProviderError } from './user-facing'
export { assertPlatformBudget, reserveChallengeCall } from './caps'

// Storage contract
export type {
  CallReservation,
  CredentialSource,
  LlmStore,
  ReserveArgs,
  StoredCredential,
  UsageRecord,
} from './store'

// Errors
export { LlmUserFacingError } from './errors'
export type { LlmUserFacingErrorCode } from './errors'
export { LlmProviderError, classify, parseRetryAfter, redact } from './providers/types'
export type {
  LlmMessage,
  LlmProvider,
  LlmRequest,
  LlmResponse,
  ModelSpec,
  ProviderConfig,
  ProviderErrorKind,
  ProvidersConfig,
} from './providers/types'

// Providers
export { createProviderRegistry } from './providers/registry'
export type { ModelPricing, ProviderRegistry } from './providers/registry'
export { DEFAULT_PROVIDERS_CONFIG } from './providers-config'
export { anthropicProvider } from './providers/anthropic'
export { googleProvider } from './providers/google'
export { openaiProvider, openrouterProvider } from './providers/openai-compatible'
export { MOCK_CONFIG, MOCK_DISMISS, MOCK_RULE_BREAK, mockBotReply, mockProvider } from './providers/mock'

// Judge
export { buildJudgeRequest, GENERIC_JUDGE_FRAMING, JUDGE_MAX_TOKENS, judgeSystemPrompt, parseJudgeVerdict } from './judge'
export type { JudgeOptions } from './judge'
export {
  BATCH_MAX_TOKENS,
  buildBatchJudgeRequest,
  GENERIC_BATCH_JUDGE_FRAMING,
  parseBatchVerdicts,
} from './judge-batch'
export type { BatchItem, BatchJudgeOptions } from './judge-batch'
export { extractFirstJson } from './json-extract'

// Canary and credentials
export { CANARY_PREFIX, deriveCanary } from './canary'
export { decryptSecret, encryptSecret, keyHint, secretsMatch } from './credentials/crypto'
export type { SealedSecret } from './credentials/crypto'
export { assertOauthInferenceAvailable, resolveCredential } from './credentials/resolve'
export type { ResolvedCredential } from './credentials/resolve'
