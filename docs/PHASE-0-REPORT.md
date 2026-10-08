# Phase 0 report: foundations & proof

**Date:** 2026-10-08 · **Status:** complete, awaiting owner check-in before Phase 1.
**Repo:** https://github.com/atultiwari/challengeforge (public)

## Exit criteria (PLAN.md §8)

| Criterion | Result |
|---|---|
| (a) Hostinger facts confirmed | **Partly.** Public docs confirm Node 18–24, on-demand processes (no persistent worker), and git or archive deploys. The DB engine is probably MariaDB. The request timeout is undocumented. See PLAN.md §7. **The owner needs to run `SELECT VERSION()` and ask support about the timeout.** |
| (b) Monorepo scaffold + CI | **Done.** pnpm workspaces, strict TS project references, Vitest with an 80% coverage gate, a purity boundary check, and a GitHub Actions workflow. The DB matrix (MySQL 8 + MariaDB) is added in Phase 1, when `packages/db` exists. |
| (c) `packages/engine` | **Done.** Type contract, attempt runner (act / assess / replay), type registry, criterion assessment, trajectory primitives (`coverage`, `avoided`, `before`, `efficiency`, `frequency`), rules harvested from the Lab (exact, numeric_range, set_match, canary, llm_rubric, metric_target, all_of / any_n_of) plus a new `term_match`, scoring, and attempt policy. No DB, no fs, no clock. |
| (d) Headless dual-paradigm proof | **Done.** `lab-legacy` (static) and `diagnostic-sim` (interactive) both run through the same runner and registry from plain data (`packages/types/test/dual-paradigm.test.ts`). The DKA case replays from its event log, and past attempts re-grade when the rubric is corrected. |
| 80%+ coverage | **99.3% lines / 92.6% branches**, 227 tests. |

## What the proof showed

The make-or-break question was whether a doctor could author an interactive,
stateful case **as data** and have the reasoning path graded. It held up,
including under an adversarial clinical review.

The reviewer found real teaching-safety gaps:

- a learner who gave no treatment still passed;
- "potassium before insulin" accepted a test that was ordered but not yet back;
- monitoring was not graded.

Fixing them needed **only a few domain-free engine additions**:

- time-based ordering against *results*;
- a `frequency` primitive;
- results that depend on what has been done;
- graded deterioration events;
- a `not_recommended` tag.

Everything else was **edits to the case data**. That is the "WordPress for
challenges" promise working: the clinician's corrections are content changes,
not code changes.

## Reviews and their outcomes

**TypeScript/security review** (no CRITICAL findings). Fixed:

- discovery is now keyed by category;
- unique ids are enforced in the schema;
- the registry runs lint;
- `ActError` no longer carries the thrown cause (it goes to `onError` only);
- invalid action times are rejected;
- actions are capped at 64 KB;
- `metric_target` is O(n log n) and rejects non-numeric scores;
- recorded effects can only enter through replay, and are strictly validated;
- the cooldown fails closed on bad timestamps;
- judged rules are not re-called when grading;
- a "closed" attempt no longer reveals the debrief;
- hint costs must match the hints (enforced by the schema);
- view/isTerminal throws become `step_failed`;
- `Object.hasOwn` lookups;
- locale-free lower-casing;
- strict number parsing;
- one-letter search words are ignored;
- views return copies;
- lint flags rules that can never be satisfied.

**Clinical-safety review** of the DKA case. Fixed in data + engine:

- fluids and insulin are now *critical* requirements;
- potassium must have a *result* back before insulin or potassium replacement;
- a repeat venous gas is graded;
- deterioration is graded;
- an insulin bolus is `not_recommended`;
- hypotonic fluids and a sliding-scale insulin start are contraindicated;
- a balanced-crystalloid synonym was added;
- weight (60 kg) is given for dose calculation;
- chloride is included for the anion gap;
- the ECG is essential;
- senior review and monitoring were added;
- the debrief was corrected: JBDS 2023 criteria including "or known diabetes", ADA differences, the potassium paradox, cerebral-oedema risk in 18–25s, and NEWS2 escalation.

## Deferred (tracked)

| Item | Why it can wait | Phase |
|---|---|---|
| Allow-list schema for each interaction's `interaction_config` (TS review #8) | It arrives with the ported UI components | 1 |
| Replay pinned to the attempt's definition version (TS review #10) | Version pinning lives in `packages/db`; re-grading already works via `assess` on the stored state | 1 |
| CI database matrix | No DB code until Phase 1 | 1 |
| Physiology beyond authored serial results (e.g. glucose falling continuously over time, value-thresholded rules such as "K ≤ 5.5") | Serial results + ordering rules cover the teaching need for now | 2+ |
| LLM simulated-patient mode on the same catalog | Planned | 5 |
| Clinical sign-off of the DKA case (decision #10) | **The owner or a colleague must confirm thresholds against the JBDS 2023 / ADA 2024 texts.** The automated reviewer worked from memory. | Before any learner sees it |

## Privacy note

The Lab repo is private and its content contains answer keys. Nothing from it
appears in this public repo:

- harvested tests use synthetic values;
- the I2 dataset was replaced with a generated cohort;
- `packs/` is git-ignored.

The Clinical AI pack will live in a separate **private** repo, checked out
under `packs/clinical-ai` in Phase 1.
