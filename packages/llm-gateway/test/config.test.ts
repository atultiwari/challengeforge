import { describe, it, expect } from 'vitest'
import { parseGatewayConfig } from '../src/config'
import { testConfig } from './helpers'

describe('parseGatewayConfig', () => {
  it('accepts a valid config', () => {
    expect(parseGatewayConfig(testConfig())).toMatchObject({ byokEnabled: true })
  })

  it('requires an encryption key when BYOK is on', () => {
    expect(() => parseGatewayConfig(testConfig({ byokEncryptionKey: null }))).toThrow(/byokEncryptionKey/)
    expect(parseGatewayConfig(testConfig({ byokEnabled: false, byokEncryptionKey: null }))).toBeTruthy()
  })

  it('names bad fields without echoing secret values', () => {
    const bad = { ...testConfig(), platformKeys: { anthropic: 42 }, byokEncryptionKey: 'super-secret-value', llmMock: 'yes' }
    expect(() => parseGatewayConfig(bad)).toThrow(/llmMock/)
    try {
      parseGatewayConfig(bad)
    } catch (e) {
      expect((e as Error).message).not.toContain('super-secret-value')
    }
  })
})
