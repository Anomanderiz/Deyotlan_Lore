---
title: Admin setup
draft: true
---

# Deyotlan admin — setup and operation

The wiki has an authenticated authoring surface at `/admin`. It commits to GitHub,
which triggers a Vercel rebuild, so changes are live roughly a minute after saving.

## What you need to do before it works in production

Until these are set, `/admin` will load but every save will fail. Nothing else on the
site is affected.

### 1. Create a fine-grained GitHub token

GitHub → Settings → Developer settings → **Personal access tokens → Fine-grained**.

- **Repository access:** _Only select repositories_ → this repository, and nothing else.
- **Permissions:** `Contents: Read and write`. **Nothing else.** In particular never
  grant `Workflows` — a token with that permission can rewrite CI.
- **Expiry:** set one, and write the renewal date in the table at the bottom of this
  file. When it lapses, every save returns a clear "GitHub rejected the token" error.

### 2. Generate the admin secrets

```bash
node scripts/admin-secrets.mjs "a long random password"
```

It prints `ADMIN_PASSWORD_HASH` and `ADMIN_SESSION_SECRET`. The plaintext password is
never stored anywhere — only the scrypt hash goes into the env var, because Vercel env
vars are viewable in the dashboard and can leak into build logs.

To generate a password first:

```bash
node -e "console.log(require('crypto').randomBytes(18).toString('base64url'))"
```

### 3. Set the environment variables

Vercel → Project → Settings → Environment Variables, for **all** environments:

| Variable               | Value                   | Notes                                             |
| ---------------------- | ----------------------- | ------------------------------------------------- |
| `ADMIN_PASSWORD_HASH`  | from the script         | `scrypt$16384$8$1$…`                              |
| `ADMIN_SESSION_SECRET` | from the script         | 32 random bytes; rotating it signs everyone out   |
| `GITHUB_TOKEN`         | the fine-grained PAT    |                                                   |
| `GITHUB_REPO`          | `<owner>/Deyotlan_Lore` | owner and repo, slash-separated                   |
| `GITHUB_BRANCH`        | `v5`                    | the branch the site deploys from                  |
| `SESSION_TZ`           | e.g. `Europe/London`    | optional; otherwise Vercel's geo header, then UTC |

`SESSION_TZ` is worth setting: without it, notes taken late at night can be filed under
the following day.

### 4. Verify the deployment

```bash
curl -i https://deyotlan-lore.vercel.app/api/health
```

A `200` with `{"ok":true,...}` confirms the serverless functions are live. **Do this
first** — if it 404s, nothing else in the admin can work, and the cause is function
detection rather than anything in the application. The fix is to pin the runtime in
`vercel.json`:

```json
"functions": { "api/**/*.js": { "runtime": "@vercel/node@5" } }
```

Then visit `/admin`, sign in, and create a throwaway page to confirm the full loop.

## Local development

```bash
npx quartz build --serve
```

`/api/*` is dispatched to the same handler files Vercel runs, and writes go straight to
`content/` on disk, so the browser hot-reloads in about a second — the local loop is
faster than production.

With no `ADMIN_PASSWORD_HASH` set locally, the admin runs in **dev bypass**: every
request is treated as authenticated and a warning is logged. This is hard-guarded on
the absence of the `VERCEL` environment variable, so it cannot fire in production. To
exercise the real login locally, put the secrets in a gitignored `.env.local` and start
the server with `node --env-file=.env.local`.

To smoke-test the real GitHub write path from your machine, set `DEYOTLAN_STORE=github`
along with the token variables — ideally against a scratch branch first.

## How it behaves

- **Every save is a commit and a full site rebuild.** Saves are therefore explicit;
  nothing auto-commits. Session-note drafts are auto-saved to `localStorage` so a
  dropped connection or a reloaded tab loses nothing, but they only reach git when you
  press save.
- **Vercel Hobby allows roughly 100 deploys a day at concurrency 1**, so rapid saves
  queue. Use _append_ mode during a live session: it adds a `## HH:MM` section to the
  existing note instead of creating a file per burst of notes.
- **Session note filenames** are `session-06-2026-09-24.md` — zero-padded number first
  so lexical order matches chronological, ISO date second. Existing files, including
  `Session 5; 2-09-2026.md`, are never renamed, so no URL ever breaks.
- **`contentIndex.json` is public and contains the full text of every page.** That was
  already true. If any material must stay hidden from players, use the
  `encrypted-pages` plugin, or the _Unlisted_ toggle when creating a page.

## Security notes, stated plainly

- The login is throttled by the ~100 ms scrypt cost plus a per-instance counter that
  returns 429 after 10 failures in 5 minutes. Because serverless instances are
  ephemeral, that counter does not survive a cold start and is useless against a
  distributed attacker. **The real defence is a long random password.**
- Sessions are stateless signed cookies with a 30-day expiry and no server-side
  revocation. Rotating `ADMIN_SESSION_SECRET` is how you sign everyone out.
- CSRF is handled by `SameSite=Strict`, a required custom header, and an Origin check.

## Maintenance

| Item                          | Due            | Notes                                       |
| ----------------------------- | -------------- | ------------------------------------------- |
| GitHub PAT expires            | _fill this in_ | Saves fail with "GitHub rejected the token" |
| Rotate `ADMIN_SESSION_SECRET` | as needed      | Signs out all sessions                      |

See [Fork patches](FORK-PATCHES.md) for how the admin is wired into the Quartz fork.
