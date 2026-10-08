# Phase 5 plan: ecosystem

**Goal (PLAN.md §8):** others extend ChallengeForge. Packs travel between
sites, institutions get their data out, a WordPress site can send people in,
and new challenge types can be added safely.

## Milestones (each ends green and committed)

| # | Milestone | Done when |
|---|---|---|
| S1 | **Packs in the browser, and a registry** | Admins **upload a pack `.zip`**: it is validated in full before anything is written, with zip-bomb and path-traversal guards. They can **download any pack as a `.zip`**. They can install from a **pack registry**: an https JSON index listing packs with a download URL and a **sha256** that must match before import. No command line is needed. Packs stay data-only (PLAN.md §3.7). |
| S2 | **xAPI export** | Learning records become xAPI 1.0.3 statements (attempted, answered, passed, failed, completed), each with the learner identified by account (not email) and the challenge as activity. They are downloadable as JSON per site or cohort. An admin can also connect an **LRS** (endpoint plus key) that `run-jobs` sends statements to, through an outbox with retries. |
| S3 | **LLM simulated patient** | A diagnostic case can let learners **ask the patient in their own words**. A model, grounded only in the case's own history catalogue, answers in character and reveals the matching catalogue items. Criteria and scoring keep working on what was revealed, so grading never depends on the model's prose. It is off unless the case turns it on, and marked as needing clinical review. The mock provider runs it in tests. |
| S4 | **WordPress connector** | A small WordPress plugin (in `integrations/wordpress`) adds a `[challengeforge]` shortcode linking to a challenge. Optional **single sign-on** uses a short-lived token signed with a secret shared between the two sites, so WordPress users arrive signed in and are linked by their WordPress id, never by email. |
| S5 | **Type SDK and trust model** | `docs/TYPE-SDK.md` documents the challenge-type contract, a worked example type built only on the public contract, and its tests. Third-party types are added **at build time after review**; **no code is ever loaded at runtime** from packs or registries. A scaffold command (`pnpm new-type`) creates a type package with tests. |

## Design calls

- **Packs stay data.** Upload and registry installs go through the same importer and validators as the CLI. A registry entry is trusted only as far as its checksum: the download must match the sha256 in the index, which itself must be served over https.
- **xAPI identifies people by account**, using `{homePage: site URL, name: user id}`, so exported records carry no email addresses.
- **The model never grades.** The simulated patient chooses which catalogue items a question reveals, and the existing trajectory criteria grade those reveals. A model that invents facts can only produce text the case author can review in transcripts; it cannot change a score.
- **No runtime plugins.** Arbitrary code from the internet on a shared host is the one risk the plan ruled out from the start.
