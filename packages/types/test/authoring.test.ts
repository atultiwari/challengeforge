import { describe, expect, it } from 'vitest'
import { authoringSchema, starterDefinition, FORM_AUTHORED_TYPES, registry } from '../src'

describe('authoring support', () => {
  it('offers a starter for every form-authored type that already passes schema and lint', () => {
    for (const typeId of FORM_AUTHORED_TYPES) {
      const parsed = registry.parseDefinition(typeId, 1, starterDefinition(typeId))
      expect(parsed.ok, `${typeId}: ${JSON.stringify(parsed)}`).toBe(true)
    }
  })

  it('produces plain JSON Schema (no code, no answers) with clinician-facing descriptions', () => {
    const schema = authoringSchema('diagnostic-sim') as { properties: Record<string, { description?: string; items?: { properties: Record<string, { description?: string }> } }> }
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema)
    expect(schema.properties['investigations']?.items?.properties['tag']?.description).toMatch(/unnecessary/)
    expect(schema.properties['history']?.description).toBeTruthy()
  })

  it('refuses types that are not form-authored', () => {
    expect(() => authoringSchema('lab-legacy')).toThrow(/not authored through a form/)
  })
})
