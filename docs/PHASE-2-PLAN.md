# Phase 2 plan: interactive in the product

Goal (PLAN.md §8): the platform stops being "a quiz app". The interactive
paradigm becomes playable and authorable, AI missions run safely on shared
hosting, and the rest of the Clinical AI content (Levels 2–3) comes across.

## Milestones (each ends green and committed)

| # | Milestone | Done when |
|---|---|---|
| P1 | **Diagnostic-sim player** | A learner works up the DKA case in the browser: search-to-reveal, history/exam/orders/treatments, a simulated clock with pending results, deterioration alerts, differential and diagnosis, then the criterion-by-criterion debrief. E2E covers it. |
| P2 | **Schema-driven author forms** (PLAN.md §3.8) | A generic form renderer built from each type's JSON Schema (Zod 4 `toJSONSchema`): objects, arrays of cards, enums, numbers and text, with lint inline. **`diagnostic-sim` becomes authorable by a clinician** through it, including catalog tables. `question-set` keeps its hand-built form. |
| P3 | **Level 2 content** | I1–I6 import and play: ports of `threshold_slider`, `subgroup_explorer` and `evidence_quiz`. `metric_target` gets its dataset from the challenge's own assets (an injected service). I7 (reproducer) stays deferred. |
| P4 | **LLM gateway on MySQL** | `packages/llm-gateway`, harvested from the Lab: providers, caps, BYOK crypto, a judge parameterised by the challenge, and a mock provider. `MysqlLlmStore` with an atomic call reservation. Migration 0002. |
| P5 | **Chat missions (A1)** | A `chat-mission` type: the server records the transcript, a per-learner canary, and goals judged by the injected judge. The **awaiting-service pattern**: reserve → commit → call the model → record, so no lock is ever held across a model call. Runs end to end on the mock provider. |
| P6 | **Jobs + prompt hardening (A4)** | A `jobs` table, a resumable job runner advanced in bounded slices by client polling or cron (`cli run-jobs`), and a `prompt-hardening` type whose battery evaluation is a job. |
| P7 | **Level 3 + review queue** | A1, A2, A3, A4, A6 and A7 import (A5 deferred). Assessments in `pending_review` show in an admin review queue, with an instructor override (recorded with the reviewer). |
| P8 | **Pack export** | `cli export-pack <slug>` writes a pack directory that re-imports identically (round-trip test). |

## Design calls for Phase 2

- **No transaction across a model call.** An action whose step needs a model
  is applied in two transactions:
  1. lock the attempt, mark it `awaiting_service`, and reserve the call;
  2. call the provider outside any transaction;
  3. lock again, apply the result through the engine (as recorded `effects`),
     and clear the flag.

  A stuck `awaiting_service` attempt expires and is released.
- **The mock provider is the default in development and CI.** Real model keys
  are the owner's, and no test depends on them.
- **Level 2 datasets are challenge assets.** The engine's `loadDataset` service
  reads them through the same repository as the asset route, so a definition
  can only reference its own challenge's files.
