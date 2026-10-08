# Writing a challenge type

A **challenge type** is the code behind one kind of challenge: a question
set, a diagnostic simulation, an ordering task. Authors then create any
number of challenges of that type as **data**: forms, JSON or packs, no code.

This guide covers the contract every type implements, a worked example
(`packages/types/src/ordering.ts`), and how a new type gets into the platform.

```bash
pnpm new-type matching-pairs
```

This scaffolds a type file and its tests, both built only on the public contract.

## The contract

From `@challengeforge/engine` (`packages/engine/src/contract.ts`):

| Member | What it does | Rules |
|---|---|---|
| `id`, `version` | The type's name and version, e.g. `ordering@1`. Packs refer to it. | Bump `version` when old definitions would no longer mean the same thing. |
| `paradigm` | `'static'` (one answer) or `'interactive'` (a sequence of actions). | Informational. |
| `definitionSchema` | Zod schema for what the author writes, **including the answer key**. | It is never sent to a browser. Give fields `.describe()` text: the generic author form shows it as help. |
| `actionSchema` | Zod schema for everything a browser may send. | Anything else is refused before your code runs. Bound every string and array. |
| `init(def, ctx)` | The starting state. | Use `ctx.seed` for any randomness, so replays are identical. |
| `step(def, state, action, env)` | Applies one action and returns the new state, or a learner-safe error. | **Pure:** no clock (use `env.at`), no network, no randomness except the seed. |
| `view(def, state)` | **The only thing the learner sees.** | Default-deny: never include the answer key, hidden reasons or future results before the attempt ends. Test this. |
| `isTerminal(def, state)` | Is the attempt over? | |
| `evaluate(def, trajectory, final, env)` | Grades the attempt into **criteria** (`combineCriteria`). | It grades against the *current* definition, so fixing an answer key can re-grade. Criteria power partial credit, analytics (miss rates) and critical errors (`critical: true`). |
| `lint(def)` | Warnings and errors for authors, shown as they type. | Catch contradictions the schema cannot: unknown ids, impossible rules. |
| `prepare(def, state, action, ctx)` *(optional)* | Asks the server for an outside service (a model reply, a judged grade). | The step then receives the result as `env.recorded`, and must refuse the action without it. The platform runs the service outside any lock and records the result, so replays need no network. |
| `pointsInput(def, final)` *(optional)* | Base points and hint costs for the leaderboard. | |

## The worked example: `ordering`

`packages/types/src/ordering.ts` (about 180 lines) puts the steps of a
procedure in order:

- **Definition:** the steps in the correct order, plus optional critical pairs
  ("hand hygiene before gloves"). Each has a `.describe()` text.
- **`init`:** shuffles the steps with `ctx.seed`, and never starts from the answer.
- **`step`:** accepts one `submit` with every step exactly once.
- **`view`:** shows the shuffled steps. Only after submission does it show
  which steps were in place, the correct order and its explanations.
- **`evaluate`:** one criterion per step (is it right after the step that
  should precede it?). Each critical pair is a criterion with
  `critical: true`, so reversing one fails the attempt.
- **Player:** `packages/web/src/components/player/OrderingPlayer.tsx`, with
  "Move up" and "Move down" buttons that work from a keyboard and with a
  screen reader.
- **Authoring:** it is listed in `FORM_AUTHORED_TYPES`, so the generic
  schema form edits it with no extra UI.
- **Tests:** `packages/types/test/ordering.test.ts` covers the shuffle,
  grading, the critical rule, replay, lint and registration.
  `packages/web/e2e/ordering.spec.ts` authors one challenge, publishes it and plays it.

## Checklist before a pull request

- [ ] The view test proves the answer key is absent before the attempt ends.
- [ ] Replay from the event log reproduces the final state.
- [ ] An action outside the action schema is refused.
- [ ] Lint catches at least the contradictions an author is likely to write.
- [ ] Every string and array in the action schema has a maximum.
- [ ] The player is usable with a keyboard and has visible text, not colour alone.
- [ ] Synthetic content only in tests and fixtures (this repository is public).

## Trust model: no runtime plugins

Packs and registries carry **data only**. A type is **code**. Code from the
internet running on a shared host is the risk this platform rules out
(PLAN.md §3.7, §3.9).

So third-party types are added **at build time, after review**:

1. A pull request adds the type, its player and its tests.
2. It is reviewed against the checklist above. Grading code that runs on
   learners' work deserves the same scrutiny as any server code.
3. It ships in the next release, and every site gets it by upgrading.

Nothing ever downloads or evaluates type code at runtime: no `eval`, no
dynamic `import()` of fetched code, no plugin folder scanned at start.

**Why not sandboxing?** Isolated workers or WebAssembly could run untrusted
types one day. They are not worth their complexity while every type can still
be reviewed. Revisit when there is a real community of type authors.
