# ChallengeForge *(working name — see PLAN.md §9)*

A self-hostable platform for **creating, publishing and running challenge-based
learning** — CTF-style labs, graded exercises, quizzes, red-team drills — on
**Node.js + MySQL**, with no PHP and no WordPress required.

The **Clinical AI Challenge Lab** becomes the first "challenge pack" that ships
on it, rather than a one-off app. Anyone else can author their own packs.

> Status: see [`docs/STATUS.md`](docs/STATUS.md). All five phases complete; ready to deploy. Try it locally with [`docs/LOCAL-TESTING.md`](docs/LOCAL-TESTING.md). Read
> [`docs/PLAN.md`](docs/PLAN.md) for the plan and
> [`docs/PLAN-REVIEW.md`](docs/PLAN-REVIEW.md) for why it looks the way it does.

## Development

Requires Node 20.11+ and pnpm 9.

```bash
pnpm install
pnpm check:all   # typecheck + purity boundary check + tests with coverage
```

| Package | What it is |
|---|---|
| `packages/engine` | Pure lifecycle engine: challenge-type contract, attempt runner, answer-checking rules, scoring. No DB, no filesystem. |
| `packages/types` | Built-in challenge types (pure). |

Content packs with answer keys (such as the Clinical AI pack) are kept in
separate private repositories and checked out under `packs/`, which this
repository ignores.

## The one-sentence pitch

> WordPress let anyone publish a website without being a web developer.
> ChallengeForge lets anyone publish a graded, interactive challenge — with
> automatic answer-checking and optional AI missions — without being a
> software engineer.
