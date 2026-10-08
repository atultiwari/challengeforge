/**
 * Site themes (Phase 4, R1): a theme is a set of colour tokens, the same
 * names globals.css declares. Presets are hand-tuned; a site may also pick
 * its own accent colour, which is accepted only if every pairing that shows
 * text still meets WCAG AA (4.5:1). No site can ship unreadable text.
 */

export const THEME_TOKENS = [
  'ink',
  'ink-muted',
  'ink-faint',
  'paper',
  'surface',
  'surface-sunken',
  'line',
  'accent',
  'accent-dark',
  'accent-soft',
  'on-accent',
  'danger',
  'danger-soft',
  'on-danger',
  'warn',
  'warn-soft',
  'good',
  'good-soft',
] as const
export type ThemeToken = (typeof THEME_TOKENS)[number]
export type Palette = Record<ThemeToken, string>

export const AA = 4.5

const CASE_FILE: Palette = {
  ink: '#17202b',
  'ink-muted': '#45505d',
  'ink-faint': '#59626e',
  paper: '#f6f4ef',
  surface: '#ffffff',
  'surface-sunken': '#efece5',
  line: '#d9d3c7',
  accent: '#1d5c51',
  'accent-dark': '#143f38',
  'accent-soft': '#e6efeb',
  'on-accent': '#ffffff',
  danger: '#a8261b',
  'danger-soft': '#f8e7e4',
  'on-danger': '#ffffff',
  warn: '#8a5300',
  'warn-soft': '#f8edd8',
  good: '#1d6b35',
  'good-soft': '#e5f1e7',
}

export const PRESETS = {
  'case-file': { label: 'Case file (warm paper, pine)', palette: CASE_FILE },
  clinic: {
    label: 'Clinic (cool white, hospital blue)',
    palette: {
      ...CASE_FILE,
      ink: '#14202e',
      'ink-muted': '#43505f',
      'ink-faint': '#56616e',
      paper: '#f5f7fa',
      'surface-sunken': '#eaeef3',
      line: '#d3dbe4',
      accent: '#1f4f8a',
      'accent-dark': '#163a66',
      'accent-soft': '#e6eef8',
    },
  },
  slate: {
    label: 'Slate (neutral grey, indigo)',
    palette: {
      ...CASE_FILE,
      ink: '#18181b',
      'ink-muted': '#46464f',
      'ink-faint': '#5b5b64',
      paper: '#f7f7f8',
      'surface-sunken': '#ececef',
      line: '#d6d6dc',
      accent: '#4338ca',
      'accent-dark': '#3730a3',
      'accent-soft': '#eceafd',
    },
  },
  night: {
    label: 'Night (dark)',
    palette: {
      ink: '#e8edf2',
      'ink-muted': '#b4bfcb',
      'ink-faint': '#a3aeba',
      paper: '#12161c',
      surface: '#1a2028',
      'surface-sunken': '#222a33',
      line: '#36414d',
      accent: '#6fc3ad',
      'accent-dark': '#8fd4c1',
      'accent-soft': '#1d3530',
      'on-accent': '#0b1a16',
      danger: '#ff9b8f',
      'danger-soft': '#3a1d1a',
      'on-danger': '#2a0f0c',
      warn: '#f2c27a',
      'warn-soft': '#3a2c14',
      good: '#7fd69a',
      'good-soft': '#16301f',
    },
  },
} as const satisfies Record<string, { label: string; palette: Palette }>
export type PresetId = keyof typeof PRESETS
export const isPreset = (id: string): id is PresetId => Object.hasOwn(PRESETS, id)

const HEX = /^#[0-9a-f]{6}$/i

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/** WCAG 2.x relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }) as [number, number, number]
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number]
  return (hi + 0.05) / (lo + 0.05)
}

/** Every text-on-background pairing the interface uses. */
export const TEXT_PAIRS: readonly (readonly [ThemeToken, ThemeToken])[] = [
  ...(['ink', 'ink-muted', 'ink-faint', 'accent', 'danger', 'warn', 'good'] as const).flatMap((fg) =>
    (['paper', 'surface', 'surface-sunken'] as const).map((bg) => [fg, bg] as const),
  ),
  ['on-accent', 'accent'],
  ['on-accent', 'accent-dark'],
  ['on-danger', 'danger'],
  ['accent', 'accent-soft'],
  ['danger', 'danger-soft'],
  ['warn', 'warn-soft'],
  ['good', 'good-soft'],
]

/** The pairings that fall short of AA, e.g. ["accent on paper (3.1:1)"]. */
export function contrastProblems(p: Palette): string[] {
  return TEXT_PAIRS.flatMap(([fg, bg]) => {
    const ratio = contrast(p[fg], p[bg])
    return ratio < AA ? [`${fg} on ${bg} (${ratio.toFixed(1)}:1)`] : []
  })
}

function mix(a: string, b: string, weightOfB: number): string {
  const [ar, ag, ab] = rgb(a)
  const [br, bg, bb] = rgb(b)
  const m = (x: number, y: number) => Math.round(x + (y - x) * weightOfB).toString(16).padStart(2, '0')
  return `#${m(ar, br)}${m(ag, bg)}${m(ab, bb)}`
}

export interface ThemeChoice {
  preset: PresetId
  /** A custom accent, e.g. "#7a2e8e"; derived tones are computed from it. */
  accent?: string
}

/** The full palette for a choice: the preset, with a custom accent and its derived tones if given. */
export function paletteFor(choice: ThemeChoice): Palette {
  const base = PRESETS[choice.preset].palette
  if (!choice.accent) return base
  const accent = choice.accent.toLowerCase()
  const dark = luminance(base.paper) > 0.5
  const onAccent = contrast('#ffffff', accent) >= contrast('#111111', accent) ? '#ffffff' : '#111111'
  return {
    ...base,
    accent,
    'accent-dark': dark ? mix(accent, '#000000', 0.25) : mix(accent, '#ffffff', 0.25),
    'accent-soft': mix(base.paper, accent, 0.1),
    'on-accent': onAccent,
  }
}

/** Validates a choice; returns the problems (empty when it is safe to use). */
export function themeProblems(choice: { preset: string; accent?: string | undefined }): string[] {
  if (!isPreset(choice.preset)) return ['Unknown theme.']
  if (choice.accent !== undefined && !HEX.test(choice.accent)) return ['The accent colour must look like #1d5c51.']
  const problems = contrastProblems(paletteFor({ preset: choice.preset, ...(choice.accent ? { accent: choice.accent } : {}) }))
  return problems.length === 0 ? [] : [`That colour is too hard to read: ${problems.slice(0, 3).join(', ')}. Pick a darker or stronger colour.`]
}

/** CSS that overrides the default tokens. Only validated hex values ever reach it. */
export function themeCss(choice: ThemeChoice): string {
  const p = paletteFor(choice)
  const vars = THEME_TOKENS.filter((t) => HEX.test(p[t])).map((t) => `--color-${t}:${p[t]}`)
  return `:root{${vars.join(';')};color-scheme:${luminance(p.paper) > 0.5 ? 'light' : 'dark'}}`
}
