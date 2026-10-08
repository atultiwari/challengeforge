# Deploying ChallengeForge on Hostinger (Node.js hosting + database)

This runbook covers a Hostinger plan with **Node.js web apps** (Business or
Cloud). The same steps work on any Node 20+ host with MySQL 8 or MariaDB 10.6+.

> **Verified so far:**
> - the release archive builds;
> - it runs as `node server.js` with production settings and a strict CSP;
> - the CLI migrates and imports on MySQL 8.0 and MariaDB 10.11.
>
> **Not yet verified on Hostinger itself.** hPanel labels below follow
> Hostinger's public docs (2026-10). Confirm them on your plan and correct
> this page where they differ.

## What you deploy

`pnpm release` builds one archive, `challengeforge-release.zip`:

| Path | What it is |
|---|---|
| `server.js` | Entry file. Starts the Next.js standalone server. |
| `packages/web/` | The compiled app, with its trimmed `node_modules`. |
| `cli.mjs` | Operator commands (one file): `migrate`, `import-pack`, `publish-pack`, `create-admin`, `reset-password`. |

The host builds nothing. You upload a prebuilt, tested archive. This avoids
depending on Hostinger building a pnpm monorepo, which its docs do not cover.

## 1. Create the database (hPanel → Databases)

1. Create a database and a database user, and note the **name**, **user**,
   **password** and **host**. The host is usually `localhost` from the Node app.
2. In phpMyAdmin, run `SELECT VERSION();` and note the result in PLAN.md §7.
   MariaDB 10.6+ and MySQL 8 are both supported.

## 2. Build the release (on your computer or in CI)

```bash
pnpm install
pnpm release
```

## 3. Create the Node.js app (hPanel → Websites → Node.js)

1. **Node version:** 22.
2. **Deploy from archive:** upload `challengeforge-release.zip`.
3. **Entry file:** `server.js`.
4. If Hostinger asks for an install or build command, leave it **empty**. The
   archive is already built.
5. **Environment variables:**

| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `mysql://USER:PASSWORD@localhost:3306/DBNAME`. URL-encode special characters in the password (`@` becomes `%40`). |
| `BETTER_AUTH_SECRET` | 32+ random characters, e.g. from `openssl rand -base64 36`. **Keep it secret and never change it**: changing it signs everyone out. |
| `APP_URL` | `https://your-domain.example`, with no trailing slash |
| `SITE_SLUG` | `main` |
| `SITE_NAME` | the name shown in the header |
| `DB_CONNECTION_LIMIT` | `5`. Shared plans cap connections. |
| `LLM_MODE` | `live` to call real AI providers. A production site refuses to start on `mock` (canned replies) unless `ALLOW_MOCK_LLM_IN_PRODUCTION=true`, which is for demo sites only. |
| `GOOGLE_API_KEY` / `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `OPENROUTER_API_KEY` | Keys for the providers your AI missions pin. Needed only with `LLM_MODE=live`. Only models with a price in the provider configuration may run on the site's keys. |
| `LLM_BUDGET_USD_PER_USER` | Spend cap per learner on the site's keys. Default `2`. |
| `BYOK_ENCRYPTION_KEY` | Optional. Generate with `openssl rand -base64 32`; it lets learners use their own API keys. |

## 4. First-time setup (hPanel → Advanced → SSH access)

Panel environment variables are usually **not** present in an SSH shell.
Export them for these commands only:

```bash
cd ~/path/to/your/node/app          # where server.js and cli.mjs are
export DATABASE_URL='mysql://USER:PASSWORD@localhost:3306/DBNAME'
export BETTER_AUTH_SECRET='the same value as in hPanel'
export APP_URL='https://your-domain.example' SITE_SLUG=main SITE_NAME='Your site'

node cli.mjs migrate
ADMIN_PASSWORD='a long new password' node cli.mjs create-admin --email you@example.com --name "Your Name"
```

Then restart the Node.js app in hPanel and sign in.

## 5. Import the Clinical AI pack (private)

The pack comes from the **private** repo `atultiwari/challengeforge-pack-clinical-ai`.

1. Upload its `pack/` folder to the server, e.g. `~/packs/clinical-ai/pack`
   (File Manager, or `scp -r`).
2. Run:

   ```bash
   node cli.mjs import-pack ~/packs/clinical-ai/pack
   ```

   Do **not** add `--publish` yet.
3. Every Level 1 mission is still marked **draft** for clinical review in the
   Lab. Publish each one from **Admin → Waiting to be published** once it is
   signed off. Or, after sign-off, publish them all at once:

   ```bash
   node cli.mjs publish-pack clinical-ai
   ```

Re-importing after content changes is safe. Unchanged missions are untouched.
Changed ones become new **draft** versions, and learners keep playing the
published version until you publish again.

## 6. Background jobs (AI evaluations)

Long AI evaluations (e.g. the prompt-hardening missions) run as **background
jobs**. The learner's open page advances them a slice at a time, so they finish
even without cron. To finish jobs whose learner closed the page, add an hPanel
**Cron job** every 5 minutes (with the same environment variables exported, as
in section 4):

```bash
cd ~/path/to/your/node/app && node cli.mjs run-jobs --max-seconds 240
```

## 7. Upgrades

1. `pnpm release` locally.
2. Upload the new archive in hPanel.
3. Run `node cli.mjs migrate` (safe to run every time).
4. Restart the app.

Attempts in progress are pinned to the version they started on, so publishing
changes never disturbs a learner mid-attempt.

## 8. Backups

The database holds everything, including uploaded datasets and case files.

- **hPanel → Backups:** check that daily database backups are included in your plan.
- **Your own copy:** add an hPanel **Cron job** (weekly), and keep copies off the server too:

  ```bash
  mysqldump --single-transaction -u USER -p'PASSWORD' DBNAME | gzip > ~/backups/challengeforge-$(date +\%F).sql.gz
  ```

- **Test a restore** into a scratch database once, before you need it.

## 9. Operating notes

- **Cold starts.** Hostinger stops idle Node apps and starts them on the next
  request. The first page after a quiet period can take a few seconds.
- **Rate limits are in memory.** They reset when the app is idled. They blunt
  bursts; they are not an accounting system.
- **No outgoing email yet (Phase 1).** There is no "forgot password" link. To
  reset someone's password:

  ```bash
  NEW_PASSWORD='...' node cli.mjs reset-password --email them@example.com
  ```

  This also signs them out everywhere.
- **Request timeouts.** Phase 1 requests are short. The long AI evaluations in
  Phase 2 will run as resumable jobs (PLAN.md §7), so they do not depend on
  Hostinger's undocumented proxy timeout.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| "Invalid configuration - …" in the app log | A missing or short environment variable. The message names it. |
| `Unknown database` or `Access denied` | `DATABASE_URL` is wrong, or the user lacks rights on that database. |
| `Site "main" does not exist` | `node cli.mjs migrate` has not been run against this database. |
| Everyone signed out after a deploy | `BETTER_AUTH_SECRET` changed. |
| Sign-in works, but every POST says "Request refused." | `APP_URL` does not match the address in the browser (`https`, `www`, or a trailing slash). |
