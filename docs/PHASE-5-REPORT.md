# Phase 5 report: ecosystem

**Date:** 2026-10-08 · **Status:** done, reviewed, and green in CI (MySQL 8.0, MariaDB 10.11 and 11.8; E2E in three shards).
Judgement calls are logged in [`DECISIONS.md`](DECISIONS.md) (D40–D48).
This completes the five phases of [`PLAN.md`](PLAN.md) §8.

## Exit criteria (docs/PHASE-5-PLAN.md)

| # | Milestone | Result |
|---|---|---|
| S1 | Packs in the browser, and a registry | **Done.** Upload a pack `.zip` (validated in full by the CLI's own importer), download any pack as a `.zip`, or install from a registry. A registry download must match its index's **sha256**. Zips are inflated as a stream with limits, so a zip bomb is stopped mid-inflate, and only plain relative paths are accepted. The public registry is in `registry/`, built with deterministic zips. |
| S2 | xAPI export | **Done.** xAPI 1.0.3 statements: attempted, passed and failed, with scores. Learners are identified by account, never email, and statement ids are derived from the fact so a re-send is harmless. Admins export the site and instructors their cohort. An optional **LRS** per site has its secret sealed, and cron pushes new statements from a cursor and records failures. |
| S3 | LLM simulated patient | **Done.** Learners can **ask the patient in their own words**. The model sees only the case's presentation, persona and history list, never the answer. Only real history ids count, so grading is unchanged. If the reply isn't JSON (or the mock answered), a keyword match decides. It is turned on in the demo case. |
| S4 | WordPress connector | **Done.** A plugin (`integrations/wordpress`) with a `[challengeforge]` shortcode. Single sign-on uses a 2-minute, single-use HS256 token, posted as a form, with issuer and audience pinned. Members are linked by WordPress id, never email. **The plugin's real PHP token builder is tested against our verifier.** |
| S5 | Type SDK | **Done.** `docs/TYPE-SDK.md` covers the contract, a review checklist and the trust model: types are added at build time, never at runtime. `pnpm new-type` scaffolds a type with tests. A new built-in **`ordering`** type is the worked example: per-step credit, critical pairs, form authoring and a keyboard-accessible player. |

**Tests:**
- 493 unit tests.
- **148 database tests on each engine** (MySQL 8.0, MariaDB 11.8; CI adds MariaDB 10.11).
- **22 Playwright journeys**: 21 on the main site plus 1 on a fresh install.

## Reviews at the phase boundary

A security review and a code review ran on the whole phase. There were no
critical findings, and every high and medium finding is fixed.

| Finding | Severity | Fix |
|---|---|---|
| A learner could prompt-inject the simulated patient into "revealing" every history item, earning credit without asking | Security, high | The model's chosen facts count only if there are at most 3, they exist, and each relates to a word in the question. Otherwise the keyword match decides (D46). |
| Patient replies were not recorded on the event, so a replay or re-grade would call the model again | Code, high | The grounded reply is recorded as the step's effects; a replay test proves it. |
| Registry, LRS and grade-book calls checked the URL text but not where its name resolves | Security, medium | DNS is resolved and private answers refused; redirects are errors (D45). |
| IPv4-mapped IPv6 in hex (`::ffff:7f00:1`) passed the private-address check | Security, medium | Both forms are recognised. |
| WordPress tokens were minted when the page rendered, and a cached page could leak one | Security, medium | The plugin mints the token on click, behind a WordPress nonce (D47). |
| Pack install downloaded before checking the role; uploads had no rate limit; a zip could hold the same name twice | Security, medium | Role first, a rate limit, duplicates rejected. |
| One bad xAPI statement blocked the whole stream; statements could be sent before late writes landed | Code, medium | A rejected batch is retried one statement at a time, with a 60-second lag. |
| A dead registry made every Packs page wait for the timeout | Code, medium | Errors are cached for 60 seconds. |
| The patient service capped calls below what the case type sends, so every question failed | Found by E2E | Limits aligned, with a cross-package test. |
| After moving the connector to another WordPress address, that site's user 42 could not sign in (placeholder email clashed with the old user 42's) | Found while documenting | The placeholder comes from the new account's random id; a database test covers the move. |

CI's E2E job was being cancelled part-way (the runner ran out of resources),
so it now runs as three shards (D48).

## Waiting on the owner

See [`STATUS.md`](STATUS.md) → *Waiting on the owner*.
