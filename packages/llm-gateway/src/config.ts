import { z } from 'zod'

/**
 * Everything the gateway used to read from the environment, injected instead,
 * so the package never touches process.env and each host app decides where
 * its settings come from.
 */
export interface GatewayConfig {
  /** DEVELOPMENT ONLY: answer every call with the deterministic mock. */
  readonly llmMock: boolean
  /** Financial cap per learner on platform-funded calls; 0 or less disables it. */
  readonly platformBudgetUsdPerUser: number
  readonly byokEnabled: boolean
  /** Base64 32-byte master key for stored learner keys; required when byokEnabled. */
  readonly byokEncryptionKey: string | null
  /** Provider names the owner allows, e.g. ['anthropic', 'google']. */
  readonly enabledProviders: readonly string[]
  /** Platform API keys keyed by PROVIDER NAME (e.g. { anthropic: 'sk-ant-...' }). */
  readonly platformKeys: Readonly<Record<string, string | undefined>>
}

const gatewayConfigSchema = z
  .object({
    llmMock: z.boolean(),
    platformBudgetUsdPerUser: z.number().finite(),
    byokEnabled: z.boolean(),
    byokEncryptionKey: z.string().min(1).nullable(),
    enabledProviders: z.array(z.string().min(1)).readonly(),
    platformKeys: z.record(z.string(), z.string().optional()),
  })
  .refine((c) => !c.byokEnabled || c.byokEncryptionKey !== null, {
    message: 'byokEncryptionKey is required when byokEnabled is true',
    path: ['byokEncryptionKey'],
  })

/**
 * Validates a config at the boundary. Host apps should call this once at
 * startup so a misconfiguration fails fast rather than on the first call.
 * Error messages name the field, never its value, so keys are not logged.
 */
export function parseGatewayConfig(input: unknown): GatewayConfig {
  const result = gatewayConfigSchema.safeParse(input)
  if (!result.success) {
    const fields = result.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    throw new Error(`Invalid LLM gateway config - ${fields.join('; ')}`)
  }
  return result.data
}
