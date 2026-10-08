# PLAN review (Stage 1): what changed and why

**Date:** 2026-10-08 · **Scope:** README.md, PLAN.md v1, and the Lab's
`src/engine`, `src/server/validators`, `src/server/llm`, plus `services.ts`,
`scoring.ts`, `attempt-policy.ts`, the content and tests.
**Result:** PLAN.md rewritten as v2. The original is in `archive/PLAN-v1-2026-10-08.md`.

## 1. Verdict in one paragraph

The strategic calls are right: a standalone platform, harvesting rather than
migrating, a pure engine, and the Clinical AI content as pack #1. **The core
abstraction was not yet strong enough for the vision.** v1 still modelled a
challenge as *one payload checked by one rule, with a pass/fail result*. The
"interactive paradigm is proven" claim does not hold up in the code. The Lab's
interactive missions work because **bespoke code is wired per challenge ID**
(`services.ts`: `builders[A1]`, `builders[I7]`). A doctor could not author a
diagnostic simulation on that model. v2 makes **attempt + event log +
challenge-type reducer + criterion-based assessment** the core, and proves it
headlessly with a diagnostic case in Phase 0, before any table exists.

## 2. Findings

### 2.1 Generality, the make-or-break (§3 of the plan)

- **Gaps in v1:**
  - no session/state model;
  - no action log;
  - no progressive disclosure;
  - results limited to `correct: boolean` (no partial credit or critical errors);
  - no trajectory grading (ordering, coverage, harmful actions);
  - no human review/override;
  - the generality test deferred to Phase 2, after Phase 1's schema would already
    have hardened around static submissions.
- **Fix:**
  - a `ChallengeType` contract (`init / step / view / evaluate / lint`);
  - static challenges as one-step attempts;
  - the Lab validators reused as criterion primitives;
  - new trajectory primitives (`coverage`, `avoided`, `before`, `efficiency`);
  - criterion-level `Assessment` with `pending_review`;
  - a full worked example of a doctor-authored diagnostic simulation (§3.5).
- **Trust boundary hardened:** the Lab's public/secret YAML split becomes
  *default-deny*. The browser only gets `view(state)`, and assets (e.g. an X-ray
  result) are gated per attempt.

### 2.2 How reusable the Lab really is (§5)

| v1 said | Reality |
|---|---|
| Validators "lift almost as-is" | **True for 5 of 8** (exact, numeric_range, set_match, canary, llm_rubric) plus the combinators. One change needed: `ChallengeId` is a closed enum of the 21 Lab IDs. `metric_target` reads the filesystem directly (inject it). `test_suite` and `reproduce` are challenge-specific TypeScript oracles, not generic checkers |
| `src/engine/*` "lift & generalise" | **It is not an engine.** It is YAML/fs loaders over a clinical schema (fixed IDs, levels 1–3, `clinical_review`, `{hospital}` variables, an interaction enum tied to React; `modules.ts` imports component types). Harvest the ideas; it becomes the pack converter's input |
| (not mentioned) | `src/server/scoring.ts` and `attempt-policy.ts` are **pure** and are the real scoring engine. Added |
| LLM gateway "lift & re-point storage" | **Accurate.** Storage is already behind `LlmStore`. The judge's system prompt is hard-coded to the clinical chatbot and must be parameterised |
| "~700 unit tests harvest" | ~650 total. **~150–200 move almost unchanged** (validators 92, plus the scoring/policy/gateway/judge/provider/crypto suites). The 151 content tests move with the pack. The 121 Supabase integration tests become the *specification* for MySQL authz/atomicity tests |
| Streaming is the AI risk | **The Lab does not stream at all.** The real risk is long *non-streaming* work: A4's batch evaluation, with rate-limit retries of up to 75 s. Fixed with resumable, request-driven jobs (no worker required) |

### 2.3 Data model and authz/atomicity (§6)

- **Engine:** design to the **MySQL 8 ∩ MariaDB 10.6+** subset. Shared hosts often
  give MariaDB, which lacks `->>` and multi-valued JSON indexes. Confirm the
  engine in Phase 0, not Phase 1, and run CI on both.
- **Tenancy:** add `site_id` to every table now. Retrofitting multi-site later is
  the expensive mistake.
- **Versions:** attempts **pin a `challenge_version`**. Editing a live challenge
  must not break attempts in flight or re-grading.
- **Without RLS:**
  - scoped repositories that require a `Scope`;
  - no raw query access outside `db`;
  - an **authz matrix** test suite;
  - `SELECT … FOR UPDATE` per attempt step;
  - unique `(attempt_id, seq)` and idempotency keys, so shared-host retries are
    safe;
  - **never hold a transaction open across an LLM call.**
- **Libraries:** Kysely + mysql2 for queries. A vetted auth library (Better Auth),
  not hand-rolled auth.

### 2.4 Architecture (§4)

- `content-schema` merges into `engine`/`types`, since a schema belongs with its
  type.
- `auth` is a library, not a package.
- `installer` becomes `apps/cli`.
- A new `packages/types` holds the built-in types.
- **Packs are data-only.** Third-party code inside packs would be remote code
  execution on every self-hoster's server.
- **Deploy a built artifact.** Don't depend on the host building a pnpm monorepo.

### 2.5 Phasing and MVP (§8)

- **Phase 0** gains:
  - Hostinger fact-finding (moved up from Phase 1);
  - CI on both database engines;
  - the **headless dual-paradigm proof** (a Lab Level-1 mission and a
    diagnostic-sim case on the same runner).
- **Phase 1 is now a real MVP:**
  - Level 1 only (B1–B7). Its answer rules are exact / numeric_range /
    set_match / all_of, so **no LLM** is needed.
  - Only 4 interaction UIs to port.
  - The authorable type changes from `flag` to **`question-set`**. It covers the
    "clinical case quiz" use case, suits schema-driven forms, and is what a
    non-technical author can actually use.
  - v1's Phase 1 contradicted itself: it offered "one challenge type", but
    importing Level 1 needs four interaction components.
- **Phase 2:** diagnostic-sim in the product, LLM missions, jobs, review queue,
  pack export/import, Levels 2–3.
- **Phase 3:** **LTI 1.3** added. For e-learning buyers it matters more than a
  WordPress bridge.

### 2.6 Risks you may have missed

1. **Answer leakage through assets.** An investigation image served from a public
   path gives away the diagnosis.
2. **Cueing.** Menu-based diagnostic sims show the learner what to order. Use
   search-to-reveal now and an LLM-grounded patient later.
3. **Author XSS.** Rich text from semi-trusted authors must be sanitised.
4. **Grading high-stakes medical reasoning with an LLM judge** needs calibration
   sets per rubric (the Lab already has the tooling) and a human review path.
5. **Clinical content governance.** Someone must own the draft→review→published
   sign-off.
6. **Backups and upgrades for self-hosters.** These are part of the WordPress
   promise and are easy to forget.

## 3. What I did *not* change

- The standalone-vs-plugin decision.
- "Harvest, don't migrate".
- Pack #1 = Clinical AI.
- Commerce in Phase 3.
- Hostinger as the first target.
- Naming options.

## 4. Decisions needed from you

Each has a recommended default. Reply "accept all defaults" or override by number.

| # | Decision | Recommended default | Why it matters now |
|---|---|---|---|
| 1 | Core model = attempt + event log + type reducer + criterion assessment | **Accept** | Everything else is built on it |
| 2 | Phase 0 includes a headless `diagnostic-sim` proof (engine only, no UI/DB) | **Yes** | Cheapest test of the vision; it adds about a few days to Phase 0 |
| 3 | Phase 1 authorable type | **`question-set`** (not `flag`) | It matches the target authors |
| 4 | Auth | **Better Auth** (vetted library) | Avoids hand-rolling security-critical code |
| 5 | Packs carry no executable code until a Phase 5 trust model | **Yes** | Self-host safety |
| 6 | `site_id` on all tables from day one | **Yes** | Multi-site without a migration later |
| 7 | DB target until confirmed | **MySQL 8 ∩ MariaDB 10.6+ subset, CI on both** | Hostinger may be MariaDB |
| 8 | Diagnostic-sim v1 interaction | **Catalog + search-to-reveal**; LLM patient later | Deterministic, cheap, low cueing |
| 9 | Lab missions A5 (test-suite) and I7 (reproducer) | **Defer to Phase 2+ as built-in types** | They are bespoke code, not data |
| 10 | Can you supply (or review) one real diagnostic case for the Phase 0 fixture? | **Yes, you or a colleague** | A clinician-shaped fixture is the honest test of §3.5 |
| 11 | Hostinger access for Phase 0 fact-finding (plan details / hPanel screenshots) | Please provide | Database engine and timeouts shape the design |
