# Testing ChallengeForge locally, role by role

Use this before deploying to Hostinger. Everything runs on your Mac, with no
real email, payment or AI accounts: mail is printed to the terminal, payments
use a built-in test checkout, and the AI uses canned replies.

## 0. What you need installed

- **Node.js 20 or newer** and **pnpm** (`npm install -g pnpm`).
- **Docker Desktop** (for the local databases).

## 1. Start the databases and the app

From the repository folder:

```bash
pnpm install
pnpm db:up
cp packages/web/.env.example packages/web/.env.local
```

Edit `packages/web/.env.local`:

- To match Hostinger, use the **MariaDB 11.8** container on port 33062:
  `DATABASE_URL=mysql://root:devroot@127.0.0.1:33062/challengeforge`.
  (Port 33061 is MySQL 8.0.)
- Set `BETTER_AUTH_SECRET` to the output of `openssl rand -base64 32`.
- Keep `LLM_MODE=mock` and `MAIL_MODE=log`.
- Set `PAYMENTS_PROVIDER=mock` to try paid packs.
- Optional: `PACK_REGISTRY_URL=https://raw.githubusercontent.com/atultiwari/challengeforge/main/registry/index.json`.

Then start it:

```bash
pnpm dev
```

The app opens at <http://localhost:3100>. On start it creates the database
tables itself (`AUTO_MIGRATE`). The local databases live in memory, so
everything you create disappears when Docker stops (see section 9).

## 2. Create the first admin

**Option A, the browser wizard (what Hostinger users without SSH will do):**
add `SETUP_TOKEN=` followed by any 24+ characters to `.env.local`, restart
`pnpm dev`, open <http://localhost:3100/setup>, paste the token, and enter
your name, email and password. The wizard disappears once an admin exists.

**Option B, the command line.** The CLI reads settings from the environment,
so load `.env.local` first:

```bash
set -a; source packages/web/.env.local; set +a; ADMIN_PASSWORD='choose-a-password' pnpm cf create-admin --email you@example.com --name "Your Name"
```

## 3. Load content

- **In the browser:** Admin → Packs. Install **Clinical demo** from the
  registry (if you set `PACK_REGISTRY_URL`), or upload a pack `.zip`.
- **From the CLI** (use an absolute path):

```bash
set -a; source packages/web/.env.local; set +a; pnpm cf import-pack "$PWD/examples/packs/clinical-demo" --publish
```

Your private Lab pack is in `packs/clinical-ai/pack`; import it the same way.
It stays draft unless you add `--publish`.

## 4. Make one account per role

Use a separate browser profile or a private window for each person, so you
can stay signed in as several people at once. With `MAIL_MODE=log`,
confirmation and password-reset emails (with their links) appear in the
terminal running `pnpm dev`.

| Role | How to create it | What to try |
|---|---|---|
| **Learner** | Sign up at `/sign-up`. Everyone starts as a learner. | Play challenges (diagnostic case: ask the patient in your own words), see progress on the home page, join a cohort with a code at `/join`, buy a paid pack (mock checkout), and get a certificate after passing a whole pack. |
| **Author** | Admin → People: set the person's **Role** to author and **Save role**. | `/author`: create a challenge from a form, save drafts, ask for review, see analytics for your own challenges. |
| **Editor** | Same, with role editor. | Review and publish other people's drafts; assign restricted content to cohorts. |
| **Admin** | You (step 2), or role admin. | Admin: people and roles, audit log, pack access and prices, certificates, review queue, settings (name, logo, theme), packs, LTI, xAPI, WordPress. |
| **Instructor** | Admin → Organisations: **Create organisation**, then **Add instructor** by email (the person needs an account). | `/teach`: create a cohort, share its join code, assign challenges with due dates, watch the progress grid, export CSV, review the cohort's results. |
| **Network admin** (multi-site) | See section 5. | `/network`: create a second site. |

**Signups closed?** Admin → Settings can close sign-ups. Then add people with
**Add person** on Admin → People (they need an account on the install).

## 5. Try a second site (multi-site)

```bash
set -a; source packages/web/.env.local; set +a; pnpm cf grant-network-admin --email you@example.com
```

Open <http://localhost:3100/network> and create a site with domain
`127.0.0.1:3100`. Then <http://127.0.0.1:3100> is the second site: the same
accounts, but separate roles, content and theme.

## 6. Background jobs (the cron job on Hostinger)

AI evaluations, emails, LMS grades and xAPI pushes are sent by `run-jobs`.
Run it by hand after a learner finishes an AI mission:

```bash
set -a; source packages/web/.env.local; set +a; pnpm cf run-jobs --max-seconds 30
```

## 7. Optional extras

- **Real AI:** set `LLM_MODE=live` and a key such as `GOOGLE_API_KEY`.
- **Real email:** `MAIL_MODE=smtp` with your mailbox settings (see `.env.example`).
- **LTI (Moodle/Canvas)** and **WordPress** need those systems to reach your
  machine, so they are easiest to test after deploying. Both are covered by
  automated tests with simulated peers.

## 8. Run the automated tests

```bash
pnpm check:all
```

```bash
pnpm test:db
```

```bash
cd packages/web && pnpm exec playwright install chromium && pnpm test:e2e
```

These are, in order: type checks and unit tests; database tests on MySQL 8.0
and MariaDB 11.8; and browser journeys, which cover every role above, payments,
LTI, WordPress, multi-site and a fresh install.

## 9. Reset everything

The development databases keep their data **in memory**: stopping the
containers (or restarting Docker) empties them, and the next `pnpm dev`
starts from a blank install. To reset on purpose:

```bash
pnpm db:down
```

Then `pnpm db:up` and `pnpm dev` again.
