# Phase 5 report: ecosystem

**Date:** 2026-10-08 · **Status:** built and verified locally. CI runs on every push.
Judgement calls are logged in [`DECISIONS.md`](DECISIONS.md) (D40–D44).
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
- 485 unit tests.
- **143 database tests on each engine** (MySQL 8.0, MariaDB 11.8; CI adds MariaDB 10.11).
- **22 Playwright journeys**: 21 on the main site plus 1 on a fresh install.

## Reviews at the phase boundary

_(Recorded when the security and code reviews complete.)_

## Waiting on the owner

See [`STATUS.md`](STATUS.md) → *Waiting on the owner*.
