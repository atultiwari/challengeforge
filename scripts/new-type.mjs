/**
 * Scaffolds a new challenge type built only on the public contract
 * (docs/TYPE-SDK.md): a type file and its tests, ready to fill in.
 *
 *   pnpm new-type matching-pairs          writes packages/types/src/matching-pairs.ts (+ test)
 *   pnpm new-type matching-pairs --out d  writes into directory d instead
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const [id, flag, outArg] = process.argv.slice(2)
if (!id || !/^[a-z][a-z0-9-]{1,40}$/.test(id)) {
  process.stderr.write('Usage: pnpm new-type <type-id>   (lowercase letters, digits, hyphens; e.g. matching-pairs)\n')
  process.exit(1)
}
const root = path.resolve(import.meta.dirname, '..')
const srcDir = flag === '--out' && outArg ? path.resolve(outArg) : path.join(root, 'packages/types/src')
const testDir = flag === '--out' && outArg ? path.resolve(outArg) : path.join(root, 'packages/types/test')
const camel = id.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())
const Pascal = camel[0].toUpperCase() + camel.slice(1)
const typeFile = path.join(srcDir, `${id}.ts`)
const testFile = path.join(testDir, `${id}.test.ts`)
for (const f of [typeFile, testFile]) if (existsSync(f)) {
  process.stderr.write(`${path.relative(root, f)} already exists; nothing written.\n`)
  process.exit(1)
}

const typeSource = `/**
 * \`${id}\`: describe what the learner does and how it is graded.
 * Built only on the public contract (docs/TYPE-SDK.md).
 */
import { z } from 'zod'
import { combineCriteria, type ChallengeType, type Criterion, type LintIssue } from '@challengeforge/engine'

/** What the author writes, INCLUDING the answer key. Never sent to a browser. */
export const ${Pascal}DefSchema = z.object({
  title: z.string().trim().min(1),
  intro: z.string().default(''),
  answer: z.string().trim().min(1).describe('The expected answer.'),
  pass_fraction: z.number().min(0).max(1).default(1),
  debrief: z.string().default(''),
})
export type ${Pascal}Def = z.infer<typeof ${Pascal}DefSchema>

/** Everything a browser may send. Anything else is refused before your code runs. */
export const ${Pascal}ActionSchema = z.object({ kind: z.literal('submit'), answer: z.string().max(200) })
export type ${Pascal}Action = z.infer<typeof ${Pascal}ActionSchema>

export interface ${Pascal}State {
  answer: string | null
  submittedAt: string | null
}

/** The ONLY thing the learner sees. Never put the answer key here before the attempt ends. */
export interface ${Pascal}View {
  title: string
  intro: string
  submitted: boolean
  correct?: boolean
  debrief?: string
}

function lint(def: ${Pascal}Def): LintIssue[] {
  return def.debrief.trim() === '' ? [{ path: 'debrief', severity: 'warning', message: 'Learners learn most from a debrief.' }] : []
}

export const ${camel}: ChallengeType<${Pascal}Def, ${Pascal}State, ${Pascal}Action, ${Pascal}View> = {
  id: '${id}',
  version: 1,
  paradigm: 'static',
  definitionSchema: ${Pascal}DefSchema,
  actionSchema: ${Pascal}ActionSchema,
  lint,
  init: () => ({ answer: null, submittedAt: null }),
  async step(_def, state, action, env) {
    return { ok: true, state: { ...state, answer: action.answer, submittedAt: env.at } }
  },
  view(def, s) {
    const base: ${Pascal}View = { title: def.title, intro: def.intro, submitted: s.submittedAt !== null }
    return s.submittedAt === null ? base : { ...base, correct: s.answer?.trim().toLowerCase() === def.answer.toLowerCase(), debrief: def.debrief }
  },
  isTerminal: (_def, s) => s.submittedAt !== null,
  async evaluate(def, _trajectory, final) {
    const passed = final.answer?.trim().toLowerCase() === def.answer.toLowerCase()
    const criteria: Criterion[] = [{ id: 'answer', label: 'The answer', score: passed ? 1 : 0, max: 1, passed, feedback: def.debrief }]
    return combineCriteria(criteria, { passFraction: def.pass_fraction })
  },
}
`

const testSource = `import { describe, expect, it } from 'vitest'
import { act, assess, replay, startAttempt } from '@challengeforge/engine'
import { ${camel}, type ${Pascal}View } from '../src/${id}'

// Synthetic content only (this repository is public).
const def = ${camel}.definitionSchema.parse({ title: 'Example', answer: 'forty-two', debrief: 'Because.' })
const ctx = { attemptId: 'a1', userId: 'u1', challengeId: 'c1', seed: 1 }
const env = { services: {}, at: '2026-01-01T00:00:00.000Z' }

describe('${id}', () => {
  it('never shows the answer before the attempt ends', () => {
    const { view } = startAttempt(${camel}, def, ctx)
    expect(JSON.stringify(view)).not.toContain('forty-two')
  })

  it('grades a right answer, and replays from the event log', async () => {
    const { attempt } = startAttempt(${camel}, def, ctx)
    const r = await act(${camel}, def, attempt, { kind: 'submit', answer: 'Forty-two' }, env)
    if (!r.ok) throw new Error(r.error.message)
    expect((r.view as ${Pascal}View).correct).toBe(true)
    expect(await assess(${camel}, def, r.attempt, [r.event], {})).toMatchObject({ passed: true })
    expect(await replay(${camel}, def, ctx, [r.event], {})).toMatchObject({ ok: true, attempt: { state: r.attempt.state } })
  })

  it('refuses actions that are not in the action schema', async () => {
    const { attempt } = startAttempt(${camel}, def, ctx)
    expect(await act(${camel}, def, attempt, { kind: 'cheat' }, env)).toMatchObject({ ok: false })
  })
})
`

mkdirSync(srcDir, { recursive: true })
mkdirSync(testDir, { recursive: true })
writeFileSync(typeFile, typeSource)
writeFileSync(testFile, testSource)
process.stdout.write(`Wrote ${path.relative(root, typeFile)} and ${path.relative(root, testFile)}.

Next (docs/TYPE-SDK.md):
  1. Fill in the definition, actions, view and evaluate; run: pnpm vitest run packages/types/test/${id}.test.ts
  2. Register it: add ${camel} to builtInTypes in packages/types/src/index.ts, and export it.
  3. Give it a player: packages/web/src/components/player/${Pascal}Player.tsx, wired in Player.tsx.
  4. Optional: author it with the generic form by adding it to FORM_AUTHORED_TYPES (packages/types/src/authoring.ts).
  5. Open a pull request: types are reviewed and built in, never loaded at runtime.
`)
