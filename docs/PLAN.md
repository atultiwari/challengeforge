# ChallengeForge — product & build plan (v2)

**Status:** plan only, no code. v1 drafted 2026-10-08; **v2 revised 2026-10-08**
after an architecture review (what changed and why: [`PLAN-REVIEW.md`](PLAN-REVIEW.md);
the original is kept at [`archive/PLAN-v1-2026-10-08.md`](archive/PLAN-v1-2026-10-08.md)).
**Stack decided:** Node.js + MySQL-family database, self-hostable (Hostinger Node
hosting is the first target).
**Relationship to existing work:** we *harvest* from the Clinical AI Challenge Lab.
It supplies the first challenge pack and some reusable engine code. We do not
migrate it in place.

---

## 1. What we are building

A platform that does for **interactive challenges** what WordPress did for
websites: a non-engineer can **create, grade and publish** them, and others can
**host their own copy** or use a shared one.

A "challenge" is anything with three parts: material to engage with, something
the learner **does**, and an **automatic, trustworthy assessment** of how they
did. Hints, scoring, leaderboards and certificates are optional extras.

**The platform is domain-agnostic.** Shapes it must support include:

- **Medical diagnostic simulations.** Present a patient. The learner takes a
  history, examines, orders investigations, interprets the results, and reaches a
  diagnosis and plan. The platform grades the *reasoning path*, not just the
  final answer.
- **Clinical case quizzes**, **data-audit exercises**, **code-review drills**,
  **classic CTF flags**, and **AI-interaction missions** (interview a simulated
  patient; red-team a chatbot).

There are two **paradigms**:

1. **Submit-and-assess** (static): one answer, checked once.
2. **Interactive scenario** (stateful): a sequence of actions that the challenge
   responds to. The whole **trajectory** is assessed.

**The design rule that makes this a platform:** every challenge runs as an
**attempt**, which is a session holding a log of learner actions:
**present → act (×N) → evaluate → score & feedback**. A static challenge is
simply an attempt with exactly one action. §3 sets out the concrete contract.
That contract is the heart of this plan, and Phase 0 has to prove it.

## 2. The key decision: standalone platform, not a WordPress plugin

**Confirmed after review: build a standalone Node + MySQL platform.** The reasons
from v1 still hold:

- WordPress is PHP. A plugin would throw away the TypeScript engine and LLM gateway.
- Server-side hidden answer checking, stateful sessions and LLM calls need a real
  application server, not WP's page-and-hook model.
- WP's security surface and update churn bring no benefit to this problem.

We copy WordPress's *qualities*, not its code:

| WordPress quality | What it becomes here |
|---|---|
| Install it yourself on cheap hosting | Built artifact + CLI (`migrate`, `create-admin`, `import-pack`); a setup wizard comes later |
| Custom post types | **Challenge types** (code, shipped with the platform; §3.2) |
| Posts | **Challenges** (data, authored in forms by domain experts, versioned) |
| Plugins | Built-in challenge types now; a third-party type SDK only later and only with a trust model (§3.9) |
| Themes | Player/author UI themes (Phase 4) |
| wp-admin | Author/admin dashboard |
| Plugin directory | Pack registry (Phase 5) |

**Integration priority (changed in v2):** this is an e-learning/assessment
product, so institutions will ask for **LMS integration (LTI 1.3 with grade
passback)** well before they ask for WordPress. LTI moves up to Phase 3. A
WordPress embed + SSO bridge stays in Phase 5. The attempt event log also makes
**xAPI** export cheap if anyone asks for it.

## 3. The core model: attempts, events, and challenge types

### 3.1 Vocabulary

| Term | What it is | Who makes it |
|---|---|---|
| **Challenge type** | Code that defines one *kind* of challenge, e.g. `question-set`, `diagnostic-sim`, `chat-mission` | Platform developers |
| **Challenge** | One authored instance of a type: its content, its answer key and rubric. Immutable **versions** | Domain experts, through forms |
| **Pack** | A **data-only** bundle of challenges + assets + structure (sections/levels, order, unlocks) | Authors; exported/imported between sites |
| **Attempt** | One learner's session on one challenge version | Created at play time |
| **Event** | One learner action within an attempt (append-only, sequenced) | The learner, via the player |
| **View** | The *projection* of an attempt's state that the browser is allowed to see | Computed by the type |
| **Assessment** | Criterion-by-criterion result: score / max, pass, feedback, critical errors | Computed by the type's evaluator |

### 3.2 The challenge-type contract

Every type implements one interface in `packages/engine`. Everything except the
injected `services` is pure. The sketch below is illustrative:

```ts
interface ChallengeType<Def, State, Action, View> {
  id: string; version: number; paradigm: 'static' | 'interactive'
  definitionSchema: ZodType<Def>          // what the author fills in (incl. answer key)
  lint(def: Def): LintIssue[]             // authoring-time checks ("investigation X has no result")
  init(def: Def, ctx: AttemptCtx): State
  actionSchema: ZodType<Action>           // what the browser may send (validated at the boundary)
  step(def: Def, state: State, action: Action, svc: Services): Promise<StepResult<State>>
  view(def: Def, state: State): View      // the ONLY thing sent to the browser
  isTerminal(def: Def, state: State): boolean
  evaluate(def: Def, trajectory: Event<Action>[], final: State, svc: Services): Promise<Assessment>
}
```

- **Static = one step.** For `question-set` or `flag`, `init` is empty and the only
  action is `submit`. `step` marks the attempt terminal and `evaluate` runs the
  answer-checkers. This is today's Lab behaviour, expressed in the new contract.
- **Interactive = many steps.** For `diagnostic-sim`, each `ask` / `examine` /
  `order` action reveals catalog items and advances a *simulated* clock. `view`
  shows only what has been revealed so far. `evaluate` scores the whole
  trajectory.
- **Services are injected** (`llm`, `datasets`, `clock`, a seeded `rng`). That
  keeps types testable without a database and makes attempts **replayable**: an
  attempt can be re-graded from its event log when a rubric is corrected, and
  authors can see exactly what a learner did.
- **Retries and attempt policy** reuse the Lab's pure `attempt-policy` logic. A
  "wrong submission" on a static type becomes a non-terminal assessed step when
  the author allows retries.

### 3.3 Assessment: criteria, partial credit, critical errors, human override

The Lab returns `correct: boolean` plus penalties. That is too thin for
reasoning-path grading. v2 uses:

```ts
interface Assessment {
  criteria: { id; label; score; max; passed; feedback; critical?: boolean }[]
  score: number; max: number; passed: boolean
  status: 'auto' | 'pending_review' | 'overridden'   // instructor can review/override
}
```

The Lab's validators become **criterion primitives** that any type can use on any
value (a submitted field, a final diagnosis, a management item):
`exact`, `numeric_range` (with `common_mistakes`), `set_match` (aliases,
categories, `also_accept`), `canary`, `llm_rubric`, `metric_target`, and the
combinators `all_of` / `any_n_of`.

New **trajectory primitives** are added for interactive types:

| Primitive | Example |
|---|---|
| `coverage` | Asked ≥ 6 of the 8 essential history items |
| `avoided` | Ordered no investigation tagged *harmful*; *critical* if violated |
| `before` | Gave antibiotics before sim-minute 60; checked pregnancy before CT |
| `efficiency` | Unnecessary tests ≤ 2; total cost under budget |
| `final_answer` | Any leaf rule applied to the submitted diagnosis/plan |

Scoring = weighted criteria, minus the Lab's hint and guessing penalties (reused
from `scoring.ts`). A critical error caps the score or fails the attempt, as the
author chooses. Free-text criteria graded by an LLM judge can be routed to a
**review queue**. That matters for high-stakes medical assessment.

### 3.4 Trust boundary: default-deny

The Lab protects its content by splitting each challenge into a public
`challenge.yaml` and a secret `answer-key.yaml`. v2 uses a stronger rule: **the
whole challenge definition stays on the server. The browser only ever receives
`view(state)`.** There is no "public half" to get wrong, and progressive
disclosure (results appear only after a test is ordered) falls out naturally.

Corollaries:

- **Assets are gated by state.** A chest X-ray that is an investigation result is
  served through an authorised route, and only after it has been revealed in that
  attempt. Never from a public static path.
- Author-supplied rich text is **sanitised** when rendered. Authors are only
  semi-trusted on a multi-author site.
- A build-time boundary check (port the Lab's `check-boundaries.ts`) stops player
  code from importing definition or answer-key modules.

### 3.5 Worked example: a diagnostic simulation authored by a doctor

**The authoring form** (no code; each section is a structured editor):

1. **Case header**: title, specialty, level, learning objectives, estimated minutes.
2. **Presentation**: setting, age/sex, chief complaint, opening vignette, vitals,
   optional image.
3. **History catalog**: rows of *{category, question label, search keywords /
   synonyms, patient's answer, tag: essential · useful · neutral}*.
4. **Examination catalog**: same shape, holding findings.
5. **Investigations catalog**: rows of *{name, result (text, value + reference
   range, or image), turnaround in sim-minutes, cost, tag: essential · useful ·
   unnecessary · harmful (+ reason)}*.
6. **Stages and events** (optional): stage gates ("state a differential before
   ordering imaging"), a step or time budget, and timed events ("at sim-minute 60
   without fluids, BP falls to 80/50").
7. **Answer**: accepted diagnosis terms + synonyms, partial-credit differentials,
   management items (essential · contraindicated), and an optional free-text
   justification graded against a rubric.
8. **Rubric**: weights per domain (history / exam / investigations / diagnosis /
   management), plus which errors are critical.
9. **Debrief**: an explanation for each item, and the model pathway.

**At runtime:** `state = {revealed, simClock, cost, stage, differentials,
diagnosis, plan}`. The actions are `ask`, `examine`, `order`,
`record_differential`, `submit_diagnosis`, `submit_plan` and `end`.

To reduce **cueing**, learners do not scroll a full menu. They *search* (type
"chest pain" or "troponin"), and the search matches the author's keywords and
synonyms. A search that matches nothing gets a neutral reply. **Evaluation** runs
the trajectory primitives over the event log. The feedback compares the learner's
path with the model pathway.

**Later modes reuse the same catalog.** In an LLM *simulated-patient* mode the
learner asks free-text questions. The model answers **grounded in the doctor's
catalog**, so the facts stay consistent and the assessment stays deterministic.
That is how the `ai-mission` family joins the medical family instead of being a
separate product.

### 3.6 Other types on the same contract

| Type | Paradigm | State | Evaluation |
|---|---|---|---|
| `flag` | static | — | `exact` / regex / per-user flag |
| `question-set` (single, multi, numeric, short text; per-item feedback) | static | — | leaf rules per item, weighted |
| Lab legacy interactions (`click_to_flag`, `scenario_quiz`, `metrics_dashboard`, `data_flagger`, `evidence_quiz`, `threshold_slider`, `subgroup_explorer`) | static | — | existing flag rules, unchanged |
| `branching-case` | interactive | current node, path | path criteria (`before`, `avoided`, end-node score) |
| `diagnostic-sim` | interactive | §3.5 | trajectory primitives |
| `chat-mission` (Lab A1) | interactive | server-recorded transcript, calls used | `llm_rubric` + `canary` over the transcript |
| `prompt-hardening` (Lab A4) | interactive + job | runs | battery evaluation as a background job (§7) |

### 3.7 Packs are data only

A pack contains challenge definitions (each naming `type@version`), assets, and
pack structure (sections/levels, order, unlock rules, pack variables such as the
Lab's `{hospital}` placeholder). **A pack never contains executable code.**
Letting self-hosters import third-party code would mean arbitrary code execution
on their server. Two Lab missions are backed by bespoke code: A5's calculator
test suites and I7's reproducer. They become built-in types or wait for Phase 2+
(§5).

The export format is a versioned zip: `pack.json` + `challenges/*.json` +
`assets/`, validated on import. Imports never overwrite anything silently; each
import creates new challenge versions.

### 3.8 Authoring UX: the "WordPress" promise in practice

- **Schema-driven forms.** Each type's `definitionSchema` is converted to JSON
  Schema (Zod 4 does this natively) and rendered by a form renderer. Complex
  parts, such as the catalog table editor or a branching-graph editor, get custom
  widgets. A new type gets a usable form almost for free.
- **Lint as you type**, using the type's `lint()`.
- **Preview as learner**: play the draft in a sandbox attempt.
- **Workflow: draft → in review → published.** This generalises the Lab's
  `clinical_review` gate. Draft content never reaches learners.
- **Immutable versions.** An attempt pins the version it started on. Editing a
  published challenge creates a new version and never disturbs attempts in flight.

### 3.9 Extensibility path (deliberately staged)

1. **Now:** types are built into the monorepo (`packages/types/*`).
2. **Phase 5:** publish a type SDK. Third-party types are either reviewed and
   bundled at build time, or run sandboxed (isolated worker or WASM). That
   decision is not needed before Phase 5.

## 4. Architecture

```
challengeforge/
  packages/
    engine/        # PURE: type contract, attempt runner, criterion + trajectory primitives,
                   #       scoring, attempt policy, payload readers. No DB, no fs, no Next.
    types/         # built-in challenge types: schema + reducer + evaluator + lint (pure)
                   #   question-set, flag, lab-legacy, diagnostic-sim, branching-case, chat-mission
    llm-gateway/   # provider adapters, caps, BYOK crypto, judge; storage behind LlmStore
    db/            # the ONLY SQL: Kysely + mysql2, migrations, scoped repositories
    web/           # Next.js app: player components per type, author forms, admin, auth wiring
  packs/
    clinical-ai/   # pack #1 (converted from the Lab's YAML by a one-off script)
  apps/
    cli/           # migrate, create-admin, import-pack, export-pack, run-jobs, purge
```

Changes from v1:

- `content-schema` merges into `engine` and `types`. A schema belongs with the
  type that interprets it.
- `auth` is no longer a hand-built package. It is a vetted library wired inside
  `web` + `db` (§6.4).
- `installer` becomes `apps/cli`. A web setup wizard is a Phase 4 nicety.

Tooling: pnpm workspaces, TypeScript project references, Vitest, Playwright.
Next.js builds with `output: 'standalone'` and `transpilePackages`. No
Vercel-only features (edge runtime, ISR, platform image optimisation).

Design rules:

- **Authorisation and atomicity live in the application layer**, concentrated in
  `db` repositories (§6.3).
- **`engine` and `types` are pure and database-free.** 80%+ coverage, and they are
  property-tested where it is cheap.
- **`db` is the only package that knows the database.**

## 5. Harvesting the Lab: a file-level verdict

Assessed by reading the code, not the folder names:

| Lab code | Reality | Verdict |
|---|---|---|
| `src/server/validators/` `exact`, `numeric-range`, `set-match`, `canary`, `llm-rubric`, `index` (combinators) | Pure. Each depends only on `@/lib/payload` (pure) and on a `ChallengeId` **closed enum of 21 Lab IDs** in `ValidationContext` | **Lift cleanly.** Replace the enum with `string`; the judge is already injected |
| `validators/metric-target` | Calls `loadDatasetRows` (filesystem) directly | **Lift with a small change:** inject datasets via `Services` |
| `validators/test-suite`, `validators/reproduce` | Bound to hard-coded TypeScript oracles (`TEST_SUITES`, I7 reproducer) | **Challenge-specific code, not generic.** Defer to Phase 2+ as built-in types, or retire |
| `src/engine/flag-rules.ts` | Zod rule schemas, pure | **Lift.** These become criterion-primitive schemas |
| `src/server/scoring.ts`, `src/server/attempt-policy.ts` | **Pure** (only an `import 'server-only'`). v1's map missed them | **Lift.** These are the real scoring engine |
| `src/lib/payload.ts` | Pure, hostile-input-safe readers | **Lift** |
| `src/engine/schema.ts`, `content.ts`, `modules.ts`, `assessment.ts`, `policies.ts`, `curriculum.ts`, `site.ts` | **Not an engine.** Filesystem/YAML loaders over a clinical-specific schema: fixed IDs, `level` 1–3, `clinical_review`, `specialty`, `{hospital}` variables, an `Interaction` enum mapped to React components; `modules.ts` imports React component types | **Harvest the ideas, rewrite the code.** This is the input to the pack converter, not to `engine` |
| `src/server/llm/` gateway, caps, store interface, providers, credentials/crypto, errors | Well factored: storage is behind `LlmStore`, and the gateway is testable. Couplings: `server-only`, `serverEnv()`, a default `supabaseLlmStore` | **Lift.** Inject config; write `MysqlLlmStore` (atomic `reserveCall`) |
| `src/server/llm/judge.ts` | The defences are generic (quoted data, tag neutralising, strict JSON, temperature 0). The **system prompt is hard-coded to the clinical-chatbot scenario** | **Lift and parameterise:** the judge framing moves into the challenge definition |
| `src/server/challenges/services.ts`, `chatbot.ts`, `hardening.ts` | Interactive behaviour **wired per challenge ID** (`builders[A1]`, `builders[I7]`) | **Rewrite as types** (`chat-mission`, `prompt-hardening`). Logic reused, wiring replaced |
| React interaction components (`src/components/interactions/*`) | Need porting onto the `view`/`action` props contract | **Port the 4 needed for Level 1 in Phase 1**; the rest when their missions are imported |
| Auth, payments, cohorts, certificates, Supabase layer, RLS, 12 Postgres functions | Supabase-bound | **Rebuild.** Use the Lab's integration tests (`rls.test.ts`, `atomic-counters.test.ts`) as the **specification** for MySQL authz/atomicity tests |
| Content (21 missions, modules, assessments; ~1.4 MB) | Valid YAML | **Pack #1**, via a converter script |

**Tests, realistically.** The Lab has about 650 tests:

| Group | Count | What happens to them |
|---|---|---|
| validators | 92 | Move with the engine |
| engine-content | 151 | Mostly content checks; they move with the pack |
| server | 287 | Mixed. Scoring, attempt-policy, gateway, judge, providers and crypto move; the rest are rebuilt |
| integration | 121 | Supabase-bound; they become the spec, not the code |

Expect **~150–200 tests to move almost unchanged** in Phase 0. That is still the
most valuable part of the harvest.

**There is no streaming in the Lab today.** All model calls go through one
non-streaming `complete()`. The real long-request risk is the A4 batch
evaluation, not streaming (§7).

## 6. Data model on MySQL

### 6.1 Target the MySQL 8.0 ∩ MariaDB 10.6+ subset (new)

Shared hosts, Hostinger among them, often provide **MariaDB rather than Oracle
MySQL 8**. This must be confirmed in **Phase 0**, because it constrains the schema.
Until then, design to the common subset:

- `JSON` columns, read with `JSON_EXTRACT` / `JSON_UNQUOTE`. Do not use the `->>`
  operator.
- No multi-valued JSON indexes. Index generated columns instead.
- `SELECT … FOR UPDATE` and InnoDB transactions are available in both.
- Run CI against **both** engines.

### 6.2 Tables (sketch)

- **Tenancy:** `sites`. **Every content and play table has `site_id` from day
  one**: one row in Phase 1, multi-site in Phase 4. Retrofitting tenancy is the
  classic WordPress-multisite mistake.
- **Accounts:** `users`, `sessions`, `accounts`/`verification` (from the auth
  library), `memberships(site_id, user_id, role)`. Organisations and cohorts arrive
  in Phase 3.
- **Content:** `packs`, `pack_sections`, `challenges(site_id, pack_id, slug,
  type_id, status)`, `challenge_versions(challenge_id, version, type_version,
  definition JSON, published_at)` (immutable), `assets(site_id, …, visibility:
  public | gated)`.
- **Play:** `attempts(site_id, user_id, challenge_version_id, state JSON,
  status, seq, started_at, ended_at)`, `attempt_events(attempt_id, seq,
  action JSON, idempotency_key, created_at)` with **UNIQUE(attempt_id, seq)** and
  **UNIQUE(attempt_id, idempotency_key)**, `assessments(attempt_id, criteria JSON,
  score, max, status, reviewer_id)`, `hints_used`, `progress(user_id,
  challenge_id, best_score, completed_at)` (a derived summary).
- **Jobs:** `jobs(site_id, kind, payload JSON, status, progress JSON,
  locked_until)`. Used for long evaluations and cron work.
- **AI:** `llm_usage` (the reservation rows), `llm_credentials` (encrypted),
  `llm_budgets`.
- **Later:** `organisations`, `cohorts`, `access_grants`, `payments`,
  `certificates`, `lti_*`.

### 6.3 Authorisation and atomicity without RLS

Losing Postgres RLS removes a safety net. A single forgotten `WHERE user_id = ?`
becomes a data leak. Mitigations:

1. **Scoped repositories.** Every repository function takes a required `Scope`
   (`{siteId, principal}`) and builds its own `WHERE` clauses. No code outside
   `db` gets a raw query handle, and the boundary check enforces this.
2. **An authz matrix test suite.** Every repository method runs as the owner, as
   another learner, as an author and as an anonymous user. This ports the
   *intent* of the Lab's `rls.test.ts`.
3. **Atomic step.** Each action runs in one transaction:
   `SELECT attempt … FOR UPDATE` → `step()` → insert the event with `seq + 1` →
   update the state. The unique keys make double-submits and client retries
   idempotent. That matters on shared hosting, where timeouts trigger retries.
   Deadlocks are retried with backoff.
4. **LLM caps.** `reserveCall` locks a per-(user, challenge, purpose) counter row,
   inserts a `reserved` usage row, and releases it on failure. This is the same
   semantics as the Lab's `reserve_llm_call`.
5. **Never hold a transaction open across an LLM call.** Reserve, commit, call the
   provider, then record the step in a new transaction. An attempt is either
   `awaiting_service` or not. The atomic-step pattern must not deadlock on slow
   providers.

### 6.4 Auth: use a vetted library, not a hand-rolled one (changed in v2)

Password hashing, email verification, reset tokens, session rotation and OAuth
are easy to get subtly wrong. **Recommendation: Better Auth** (a TypeScript
library with a Kysely/MySQL adapter, email + password, OAuth, and organisation
plugins). Keep the Lab's `CurrentUser` seam so the library can be swapped out.
Pin the version and confirm MariaDB compatibility in Phase 0.

### 6.5 Query layer

**Recommendation: Kysely + mysql2**: typed SQL, explicit queries, built-in
migrations, and it works on MySQL and MariaDB alike. Avoid ORMs that ship native
engine binaries; they complicate shared-hosting deploys.

## 7. Hosting target and runtime constraints

- **Target:** Hostinger Node hosting + its managed database, or any Node host.
  No PHP, no Docker.
- **Phase 0 findings from Hostinger's public docs (2026-10-08).** These still
  need confirming on the owner's actual plan:

  | Question | Finding | Status |
  |---|---|---|
  | Database engine | **MariaDB 11.8** (`11.8.9-MariaDB-log`, owner's `SELECT VERSION()`, 2026-10-08). | **Confirmed.** CI tests MariaDB 11.8 (also the E2E engine), MariaDB 10.11 as the floor, and MySQL 8.0 for other hosts. |
  | Node version | 18, 20, 22 (LTS), 24 | OK. Target Node 22. |
  | Process model | Apps run **on demand**: the process stops after idle time and restarts on the next request, and is restarted if it crashes. | This confirms there is **no persistent worker**. In-memory caches and timers are unreliable, so the request-driven jobs + cron design (below) is required. Expect cold starts. |
  | Deploy | Git push to deploy, or archive upload (.zip/.tar.gz); Hostinger runs install + build | Prefer **archive upload of a prebuilt standalone bundle**, because pnpm-workspace support is undocumented. |
  | Request/proxy timeout | **Not documented** | **Owner to ask Hostinger support.** The design does not depend on it (bounded ~15 s job slices). |
  | Cron, connection limits, memory | Not on the Node overview page | Check hPanel / support during Phase 1. |

- **Confirm in Phase 0, not Phase 1** (these shape the design):
  - the database engine and version (MySQL 8 or MariaDB);
  - the Node version;
  - the proxy/request timeout;
  - whether the Node process persists or is spun down when idle;
  - connection limits;
  - cron availability;
  - deploy method (git build vs artifact upload), and whether pnpm workspaces
    build there.
- **Long work runs as resumable jobs, not long requests.** The A4 battery
  evaluation (dozens of model calls, with rate-limit waits of up to 75 s per try)
  cannot run inside one HTTP request on shared hosting. Design:
  - `POST /evaluate` creates a `jobs` row;
  - each poll from the client **advances the job by one bounded slice** (≤ ~15 s)
    and returns progress;
  - hPanel cron also drains jobs.

  This works with **no persistent worker**. Where the host allows a worker,
  `cli run-jobs` does the same thing faster.
- **Model calls are non-streaming by default** (as in the Lab). Streaming becomes
  an optional enhancement wherever the host proves it works. An LLM `step` that
  might exceed the timeout uses the job pattern.
- **Deploy a built artifact.** Build the standalone Next output in CI (or
  locally) and upload it, rather than relying on the host to build a pnpm
  monorepo.
- **Retention and cleanup jobs** (the Lab's `pg_cron` duties) run from hPanel cron
  via `apps/cli`.
- **Backups:** a documented, tested database dump plus asset backup. Self-hosters
  need this from day one.

## 8. Phases (revised)

The make-or-break question is whether one contract really serves both
paradigms. **v1 deferred that question to Phase 2**, after the Phase 1 data model
would already have hardened around static submissions. **v2 proves it first, in
pure code, where changing course costs little.**

| Phase | Goal | Exit criteria ("done") |
|---|---|---|
| **0. Foundations & proof** | Show that one contract runs both paradigms, and pin down the hosting facts | (a) Hostinger facts confirmed (§7) and written into the plan. (b) pnpm monorepo scaffold, CI on MySQL 8 + MariaDB. (c) `packages/engine`: the type contract, attempt runner, criterion primitives harvested from the Lab (exact, numeric_range, set_match, canary, llm_rubric, metric_target with injected data, all_of/any_n_of), scoring, attempt policy, payload readers. Harvested tests pass, with no clinical assumptions, no DB, no fs. (d) **Headless proof:** in `packages/types`, a Lab Level-1 mission (static, from converted data) **and** a small `diagnostic-sim` case (interactive, from a JSON fixture a doctor could have produced) both run through the same runner and get assessed, and the diagnostic case is replayed from its event log. 80%+ coverage. |
| **1. Single-site MVP** | Clinical AI Level 1 live on MySQL, plus one authorable type | DB layer with attempts/events, scoped repos and the authz matrix tests. Auth (library). Pack converter + `cli import-pack`. Player for B1–B7 (4 ported interaction UIs; rules exact / numeric_range / set_match / all_of only, no LLM). Hints, attempt policy, scoring, progress. **Author form + preview + draft→published for `question-set`.** Minimal admin (users, publish). Sanitised rendering, gated assets. Deployed to Hostinger with backups and a runbook. **Out of scope:** payments, certificates, cohorts, LLM, Levels 2–3. |
| **2. Interactive in product** | The platform stops being "a quiz app" | `diagnostic-sim` player + author form (catalog editor, search-to-reveal, debrief). LLM gateway on MySQL + `chat-mission` (A1) + the job runner + `prompt-hardening` (A4). Review queue / instructor override. Pack export/import. Levels 2–3 imported (I7 and A5 as built-in types, or deferred). |
| **3. Publishing & institutions** | Others author, teach and (optionally) charge | Multi-author roles, organisations/cohorts, certificates, payments, **LTI 1.3** with grade passback, analytics from the event log. |
| **4. Multi-site & themes** | "Like WordPress" | Many sites per install (the `site_id` already exists), themes, setup wizard. |
| **5. Ecosystem** | Others extend it | Pack registry, type SDK + trust model (§3.9), WordPress embed/SSO, xAPI export, LLM simulated-patient mode on top of the diagnostic catalog. |

Phases 0–1 are the real proof. Phase 0's headless diagnostic-sim is the cheapest
possible test of the whole vision. If it is awkward there, we fix the contract
before any table exists.

## 9. Naming

`ChallengeForge` is a **working placeholder**. Directions:

- Descriptive: *ChallengeForge*, *ChallengeKit*, *Gradeworks*, *ProveIt*.
- VRL-tied: *VRL Arena*, *VRL Challenge Platform*.

The Clinical AI Lab keeps its own name as a pack/brand on the platform. A name is
needed before Phase 2 or any public work. Do a trademark/domain check before
choosing.

## 10. Decisions

**Taken (owner, 2026-10-08):**

- Standalone Node + MySQL platform, not a WordPress plugin.
- First milestone = the Clinical AI pack on MySQL (Phase 1); generalise afterwards.
- A new product in its own repo, harvesting from the Lab.

**Taken (owner, 2026-10-08, "accept all defaults" on
[`PLAN-REVIEW.md`](PLAN-REVIEW.md) §4):**

1. Attempt + event-log core model with criterion-based assessment (§3).
2. Phase 0 includes the headless `diagnostic-sim` proof (§8).
3. Phase 1's authorable type is `question-set`, not `flag`.
4. Auth via a vetted library (Better Auth), not hand-rolled.
5. Packs are data-only; no third-party executable code until Phase 5.
6. `site_id` on every table from day one.
7. Design to the MySQL 8 ∩ MariaDB subset until the Hostinger facts are confirmed.
8. Diagnostic-sim v1 uses catalog + search-to-reveal; the LLM patient comes later.
9. Lab missions A5 (test-suite) and I7 (reproducer) are deferred to Phase 2+ as built-in types.
10. The owner (or a colleague) reviews the Phase 0 diagnostic-sim fixture clinically.
11. The owner supplies Hostinger plan details for the §7 fact-finding.

**Still open:**

- Commerce: recommend Phase 3 (unchanged).
- Name: before Phase 2.
- Who signs off clinical content for pack #1 under the new draft→review→published
  workflow (the Lab's reviewer process carries over?).

## 11. Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Contract can't express real expert-authored interactive cases | Medium | Fatal to the vision | Phase 0 headless diagnostic-sim; involve a clinician in shaping the fixture |
| Host gives MariaDB / old MySQL | High | Medium | §6.1 subset; CI on both; confirm in Phase 0 |
| Shared-host timeouts kill long evaluations | High | High | Resumable jobs (§7); non-streaming default |
| App-layer authz leak (no RLS) | Medium | High | Scoped repos, boundary check, authz matrix tests |
| Answer leakage via views or assets | Medium | High | Default-deny `view()`, gated assets, view snapshot tests per type |
| Phase 1 scope creep (porting every Lab UI) | High | Medium | Level 1 only: 4 components, no LLM |
| Doctors find forms too heavy | Medium | High | Schema-driven forms + custom catalog widget; usability test with 2–3 clinicians in Phase 2 |
| Menu-based sims cue the answer | Medium | Medium | Search-to-reveal; LLM patient later |
| LLM judge drift / prompt injection in grading | Medium | Medium | Lab's judge defences + calibration sets per rubric; review queue |
| Third-party pack code = RCE on self-hosts | — (if allowed) | Critical | Data-only packs (§3.7) |
| Single-maintainer bus factor on auth/crypto | Medium | High | Vetted auth library; reuse the Lab's tested BYOK crypto |

---

## 12. How to start (two-stage handoff)

See [`STARTER-PROMPT.md`](STARTER-PROMPT.md). Stage 1 (this review) is done.
Stage 2 begins at **Phase 0** on the owner's "proceed to stage 2", with a check-in
at each phase boundary.
