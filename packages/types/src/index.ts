import { createTypeRegistry, type AnyChallengeType } from '@challengeforge/engine'
import { labLegacy } from './lab-legacy'
import { diagnosticSim } from './diagnostic-sim'

/** Every challenge type that ships with the platform. Packs reference these as `id@version`. */
export const builtInTypes: readonly AnyChallengeType[] = [labLegacy, diagnosticSim]

export const registry = createTypeRegistry(builtInTypes)

export * from './lab-legacy'
export * from './diagnostic-sim'
