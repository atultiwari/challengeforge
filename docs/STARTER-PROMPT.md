# Starter prompt for a fresh session

Open a **new Claude Code session** with the working directory set to this folder
(`/Users/atultiwari/Downloads/Research_Projects/ChallengeForge`), ideally on the
strongest available model, and paste everything in the block below as your first
message.

It runs in **two stages**: Stage 1 reviews and improves the plan; Stage 2 builds
it, and only after you approve Stage 1. The prompt tells the assistant to stop
and wait between the two.

---

```
I am building a new product and want your help, in two stages. Do STAGE 1 only
first, then stop and wait for my approval before STAGE 2. Do not write any
application code during Stage 1.

PROJECT
ChallengeForge (working name) is a self-hostable, DOMAIN-AGNOSTIC platform for
creating, publishing and running challenge-based learning. It is "WordPress for
challenges": a non-engineer domain expert authors an interactive, auto-graded
challenge the way a blogger writes a post. It is built on Node.js + MySQL, with
no PHP and no WordPress. It is an e-learning / assessment platform.

The subject is open-ended — security CTF is only ONE family. First-class
examples deliberately span fields, e.g.:
  - a doctor authoring a MEDICAL DIAGNOSTIC SIMULATION (present a patient; the
    learner takes a history, orders tests, interprets results, reaches a
    diagnosis and plan; the platform grades the reasoning path, not just the
    final answer);
  - clinical case quizzes; data-audit exercises; code-review drills;
  - classic CTF flags; and AI-interaction missions.
The platform must handle TWO paradigms of challenge: (1) submit-and-assess
(static: one answer, checked once) and (2) interactive scenario (stateful: a
sequence of actions the challenge responds to, with the whole trajectory
assessed). Medical simulations and AI missions are the interactive paradigm.
Treat a challenge as a lifecycle: present -> interact/collect -> evaluate ->
score & feedback, where static is the one-step case of interactive. See PLAN.md
§1 and §3.

The full plan is in this folder. Read these first, in order:
  - README.md
  - docs/PLAN.md   (the detailed plan — architecture, phases, decisions)

BACKGROUND YOU NEED
- There is an existing, working app we are HARVESTING reusable parts from (not
  migrating in place): the "Clinical AI Challenge Lab", a Next.js + TypeScript +
  Supabase project at:
      /Users/atultiwari/Downloads/Research_Projects/Clinical-AI-CTF-Lab
  Its pure answer-checking/grading engine and its multi-provider LLM gateway are
  the crown jewels to reuse. Its Supabase-specific storage, auth and database
  rules are NOT reused — those are rebuilt fresh on MySQL. See PLAN.md §5 for the
  full "what we reuse vs rebuild" mapping.
- Decisions already taken (PLAN.md §10): standalone platform (not a WordPress
  plugin); first milestone is to ship the Clinical AI content as the first
  "pack" on the new MySQL platform; then generalise the pack system.
- Design rule: all authorisation and atomicity live in the APPLICATION layer by
  design (MySQL has no row-level security or stored-procedure equivalent we rely
  on), and the grading engine is a PURE, database-free, well-tested package.
- Hosting target is Hostinger Node hosting + MySQL (also any Node host). One
  known caveat: AI challenge types stream long responses and shared hosting can
  cut long requests short, so a non-streaming fallback must be designed in.

=== STAGE 1 — REVIEW AND IMPROVE THE PLAN (do this now) ===
Act as a critical senior architect. Do not write application code.
1. Read README.md, docs/PLAN.md, and enough of the Clinical-AI-CTF-Lab engine
   and validators (src/engine, src/server/validators, src/server/llm) to judge
   how reusable they really are.
2. Pressure-test the plan: Is the standalone-platform decision right? Is the
   monorepo/package split sound? Is the "harvest" mapping in §5 realistic — what
   will actually lift cleanly vs what is more entangled than it looks? Are the
   MySQL data-model and the app-layer authz/atomicity approach sound? Is the
   phasing sensible, and is the phase-1 scope genuinely an MVP?
   CRITICAL GENERALITY CHECK: is the challenge-type abstraction genuinely broad
   enough for BOTH paradigms — especially an interactive MEDICAL DIAGNOSTIC
   SIMULATION authored by a non-technical doctor through a form, not just
   submit-and-grade CTF flags? If the lifecycle/engine/data-model would make
   interactive, stateful, expert-authored challenges awkward, say so and propose
   the fix. This is the make-or-break of the whole vision.
3. Surface risks, gaps and better alternatives I may have missed.
4. Produce an IMPROVED version of docs/PLAN.md (edit the file), and a short
   docs/PLAN-REVIEW.md noting what you changed and why, plus any decisions you
   need from me.
Then STOP and summarise your key findings and recommendations. Wait for my
approval before Stage 2.

=== STAGE 2 — BEGIN BUILDING (only after I say "proceed to stage 2") ===
Follow the agreed plan, smallest valuable steps first, test-driven where it
makes sense:
- Phase 0: set up the monorepo scaffold and extract the pure grading/validator
  engine from the Lab into packages/engine — database-free, no clinical
  assumptions, with its harvested tests passing.
- Phase 1: the single-pack MVP on MySQL per PLAN.md (accounts, author dashboard
  for one challenge type, play + grade + score, the Clinical AI content imported
  as the first pack, deployable on Hostinger Node + MySQL).
Check in with me at each phase boundary before moving on.
```

---

## Why two stages

The plan in this folder is a solid first draft, but it was written quickly and
deserves a critical second pass before any code is committed — especially the
§5 "harvest" mapping, which assumes parts of the Lab lift cleanly and should be
verified against the real code. Stage 1 forces that review and leaves an improved
plan on disk; Stage 2 then builds against a plan you have re-approved.
