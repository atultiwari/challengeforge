import type { RuleContext } from '../../src/rules/types'

export function ctx(overrides: Partial<RuleContext> = {}): RuleContext {
  return {
    challengeId: 'B5',
    userId: 'user-1',
    ...overrides,
  }
}
