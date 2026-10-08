import { describe, expect, it } from 'vitest'
import { contrast, contrastProblems, paletteFor, PRESETS, themeCss, themeProblems, type PresetId } from '../src/lib/themes'

describe('themes', () => {
  it('computes WCAG contrast', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21, 0)
    expect(contrast('#ffffff', '#ffffff')).toBeCloseTo(1, 5)
  })

  it('every preset meets AA for every text pairing', () => {
    for (const id of Object.keys(PRESETS) as PresetId[]) {
      expect({ id, problems: contrastProblems(PRESETS[id].palette) }).toEqual({ id, problems: [] })
    }
  })

  it('accepts a strong custom accent and derives readable tones', () => {
    expect(themeProblems({ preset: 'case-file', accent: '#6b2d8a' })).toEqual([])
    const p = paletteFor({ preset: 'case-file', accent: '#6b2d8a' })
    expect(p['on-accent']).toBe('#ffffff')
    expect(contrastProblems(p)).toEqual([])
  })

  it('refuses a pale accent, a malformed one, or an unknown preset', () => {
    expect(themeProblems({ preset: 'case-file', accent: '#ffe066' })[0]).toMatch(/too hard to read/)
    expect(themeProblems({ preset: 'case-file', accent: 'red' })[0]).toMatch(/#1d5c51/)
    expect(themeProblems({ preset: 'case-file', accent: '#fff;}body{display:none' })[0]).toMatch(/#1d5c51/)
    expect(themeProblems({ preset: 'neon' })).toEqual(['Unknown theme.'])
  })

  it('emits only CSS custom properties from validated hex values', () => {
    const css = themeCss({ preset: 'night' })
    expect(css).toMatch(/^:root\{--color-ink:#e8edf2;/)
    expect(css).toContain('color-scheme:dark')
    expect(css).not.toMatch(/[<>]/)
  })
})
