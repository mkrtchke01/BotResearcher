# BotResearcher 🤖

A production-ready **Telegram bot** that monitors freelance marketplaces for
new relevant jobs and sends you short Telegram notifications with a direct link
to each post.

Built with **Next.js (App Router) + TypeScript**, deployable on **Vercel** with
**Telegram webhooks** (no long polling) and **Vercel Cron Jobs** for polling.

---

## Table of contents

1. [Features](#features)
2. [Project structure](#project-structure)
3. [How it works](#how-it-works)
4. [Bot commands](#bot-commands)
5. [Notification format](#notification-format)
6. [Local development](#local-development)
7. [Deploy to Vercel](#deploy-to-vercel)
8. [Set environment variables on Vercel](#set-environment-variables-on-vercel)
9. [Register the Telegram webhook](#register-the-telegram-webhook)
10. [Choosing & wiring sources](#choosing--wiring-sources)
11. [Adding more marketplaces later](#adding-more-marketplaces-later)
12. [Security notes](#security-notes)

---

## Features

- **Webhook-based** Telegram bot (Bot API), secret-token authenticated.
- **Cron-driven** polling via Vercel Cron (`vercel.json`).
- **Cloud Postgres** (Supabase or Neon) — no SQLite, no local filesystem state.
- **Modular provider system** — add marketplaces by dropping in one file.
- **Keyword matching** with phrase + word-boundary support.
- **Duplicate protection** by job id *and* normalized URL.
- **Anti-spam** cap on notifications per cron run.
- **Fail-soft** error handling — one bad feed never crashes a run.
- **No hardcoded secrets** — the bot token is read only from
  `process.env.TELEGRAM_BOT_TOKEN`.

---

## Project structure

```
BotResearcher/
├── app/
│   ├── layout.tsx                       # root layout
│   ├── page.tsx                         # liveness landing page
│   └── api/
│       ├── telegram/webhook/route.ts    # Telegram webhook (POST)
│       └── cron/check-jobs/route.ts     # cron entry point (GET/POST)
├── bot/
│   └── commands.ts                      # command router (/start, /keywords, …)
├── lib/
│   ├── env.ts                           # validated env access + tunables
│   ├── db.ts                            # shared postgres client (pooled)
│   ├── repo.ts                          # data-access layer (all SQL)
│   ├── rss.ts                           # RSS/Atom fetch + parse
│   ├── matcher.ts                       # keyword matching
│   ├── format.ts                        # summaries, relative time, URL norm.
│   ├── notify.ts                        # notification message builder
│   ├── telegram.ts                      # Telegram Bot API client
│   └── monitor.ts                       # the monitoring cycle (orchestration)
├── providers/
│   ├── types.ts                         # Provider interface + Job shape
│   ├── index.ts                         # provider registry
│   ├── upwork.ts                        # Upwork RSS provider
│   ├── custom-rss.ts                    # generic RSS/Atom provider
│   ├── laborx.ts                        # LaborX public API (newest jobs)
│   ├── freelancer.ts                    # Freelancer.com public API (skill-filtered)
│   └── peopleperhour.ts                 # placeholder (sanctioned feed/API)
├── db/
│   └── schema.sql                       # database schema + seed keywords
├── scripts/
│   ├── db-init.ts                       # apply schema.sql to DATABASE_URL
│   └── set-webhook.ts                   # register/delete the Telegram webhook
├── .env.example                         # env placeholders (no secrets)
├── vercel.json                          # cron schedule
├── next.config.mjs
├── tsconfig.json
└── package.json
```

---

## How it works

```
Telegram ──(/start, /addkeyword, …)──▶  POST /api/telegram/webhook  ──▶  bot/commands.ts ──▶ Postgres
                                                                                                │
Vercel Cron ──(every 15 min)──────────▶  GET /api/cron/check-jobs   ──▶  lib/monitor.ts ───────┤
                                                                          │                     │
                                          providers/* (Upwork, RSS) ◀─────┤ fetch feeds          │
                                          matcher (keywords)        ◀─────┤ match                │
                                          repo.getAlreadySent       ◀─────┤ dedup ───────────────┘
                                          telegram.broadcast        ◀─────┘ notify users
```

The monitoring cycle (`lib/monitor.ts`):

1. Bail if monitoring is OFF (`bot_state`).
2. Fetch jobs from every **enabled** provider (errors isolated per provider).
3. Match each job against active **keywords**.
4. Drop **duplicates** by `platform:id` and normalized URL (in-batch + DB).
5. Send the newest matches, **capped** at `MAX_NOTIFICATIONS_PER_CHECK`.
6. Record sent jobs so they're never re-sent.

All errors are logged; the cron route always returns `200`.

---

## Bot commands

| Command | Description |
|---|---|
| `/start` | Start monitoring and subscribe this chat to notifications |
| `/stop` | Stop monitoring (and unsubscribe this chat) |
| `/status` | Show monitoring status, keyword & source counts |
| `/keywords` | List active keywords |
| `/addkeyword <keyword>` | Add a keyword (e.g. `/addkeyword landing page`) |
| `/removekeyword <keyword>` | Remove a keyword |
| `/sources` | List connected sources |
| `/addsource <url> [upwork\|custom-rss]` | Add an RSS/search feed (default `custom-rss`) |
| `/removesource <url>` | Remove a source |
| `/help` | Show help |

---

## Notification format

```
🆕 New job found: Landing page for a SaaS startup

🌐 Platform: Upwork
📝 About: Client needs a modern, responsive landing page for their new SaaS
   product. Looking for clean UI and fast load times. React/Next.js preferred.
💰 Budget: Fixed: $500
🎯 Matched keyword: landing page, next.js
🕒 Posted: 10 minutes ago
🔗 Link: https://www.upwork.com/jobs/~021234567890
```

---

## Local development

> Requires **Node ≥ 18.18** (Node 20.6+ recommended so the helper scripts can
> auto-load `.env.local`).

```bash
# 1. Install deps
npm install

# 2. Configure env
cp .env.example .env.local
#   → fill in TELEGRAM_BOT_TOKEN, DATABASE_URL, TELEGRAM_WEBHOOK_SECRET, CRON_SECRET

# 3. Create the schema (idempotent)
npm run db:init

# 4. Run the app
npm run dev          # http://localhost:3000

# 5. Type-check / build
npm run typecheck
npm run build
```

Trigger a monitoring cycle locally:

```bash
curl "http://localhost:3000/api/cron/check-jobs?secret=$CRON_SECRET"
```

To receive Telegram updates locally, expose port 3000 with a tunnel
(e.g. `ngrok http 3000`) and register that HTTPS URL as the webhook
(see [Register the Telegram webhook](#register-the-telegram-webhook)).

---

## Deploy to Vercel

1. Create the Telegram bot with **@BotFather** → copy the token.
2. Create a Postgres database:
   - **Supabase**: New project → *Settings → Database* → copy the
     **Connection pooling** string (port `6543`, `?sslmode=require`).
   - **Neon**: New project → copy the **pooled** connection string.
3. Apply the schema once: run `npm run db:init` locally against `DATABASE_URL`,
   or paste `db/schema.sql` into the Supabase SQL editor / Neon SQL editor.
4. Push this repo to GitHub and **Import** it in Vercel
   (New Project → select the repo → framework auto-detected as Next.js).
5. Add environment variables (next section) **before** the first deploy.
6. Deploy. Vercel reads `vercel.json` and registers the cron job
   (`/api/cron/check-jobs` every 15 minutes).

> **Cron frequency & plan limits:** Vercel Hobby runs cron jobs at most a few
> times per day. For minute-level polling (`*/15 * * * *`) use the **Pro** plan,
> or trigger the cron route from an external scheduler (cron-job.org, GitHub
> Actions) hitting `GET /api/cron/check-jobs?secret=<CRON_SECRET>`.

---

## Set environment variables on Vercel

**Project → Settings → Environment Variables.** Add each for the environments
you deploy (Production / Preview / Development):

| Name | Value | Notes |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | from @BotFather | **required**, secret |
| `TELEGRAM_CHAT_ID` | your numeric chat id | optional default recipient |
| `TELEGRAM_WEBHOOK_SECRET` | long random string | validates webhook calls |
| `DATABASE_URL` | Postgres pooled URL | **required**, secret |
| `CRON_SECRET` | long random string | authorizes the cron route |
| `APP_URL` | `https://<project>.vercel.app` | used by `set-webhook` |

> When `CRON_SECRET` is set, Vercel Cron automatically sends it as
> `Authorization: Bearer <CRON_SECRET>` — the route validates this, so external
> callers can't trigger runs.

After changing env vars, **redeploy** so they take effect.

---

## Register the Telegram webhook

Telegram needs to know your deployed webhook URL. Two ways:

**A) Use the helper script (reads `APP_URL`, `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_WEBHOOK_SECRET` from `.env.local`):**

```bash
npm run set-webhook       # registers <APP_URL>/api/telegram/webhook
npm run delete-webhook    # removes it
```

**B) Call the Bot API directly with curl:**

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{
        "url": "https://<your-app>.vercel.app/api/telegram/webhook",
        "secret_token": "<TELEGRAM_WEBHOOK_SECRET>",
        "allowed_updates": ["message"],
        "drop_pending_updates": true
      }'
```

Verify with:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
```

Then open Telegram and send **`/start`** to your bot.

---

## Choosing & wiring sources

Only **public / official / user-provided** feeds are used. No login, captcha,
rate-limit, or protected-page bypassing.

**API-driven providers (no source needed — on by default):**

- **LaborX** (`providers/laborx.ts`): polls the public job-board API for the
  newest jobs each run; relevance is decided by your **keywords** (landing / bot
  / web-application seeds ship in `db/schema.sql`). Tune with `/addkeyword` and
  `/removekeyword`. Optional env: `LABORX_FETCH_LIMIT` (default 50).
- **Freelancer.com** (`providers/freelancer.ts`): polls the public active-
  projects API filtered **server-side by skill id** for the three niches
  (landing pages / bots / web applications), newest first. Edit `SKILL_BUCKETS`
  in that file to widen/narrow coverage (skill ids:
  `GET https://www.freelancer.com/api/projects/0.1/jobs/?lang=en`). Each result
  is pre-tagged with its niche, so it isn't dropped by the text matcher.

**Feed-driven providers (add a source URL):**

- **Upwork**: create a job search while logged in; the results page exposes an
  **RSS** link tied to your account. Add it with platform `upwork`:
  ```
  /addsource https://www.upwork.com/nx/wm/saved-search/rss?key=... upwork
  ```
- **Any RSS/Atom feed** (remote job boards, aggregators, your own search
  alerts): add with the default `custom-rss` platform:
  ```
  /addsource https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss
  ```

Manage keywords the same way: `/addkeyword telegram web app`.

---

## Adding more marketplaces later

The provider system is fully modular. To add a marketplace:

1. **Create** `providers/<name>.ts` implementing the `Provider` interface
   (`providers/types.ts`):

   ```ts
   import type { Job, Provider, ProviderContext } from "./types";

   export const myMarketplaceProvider: Provider = {
     key: "mymarket",          // matches sources.platform
     displayName: "MyMarket",
     enabled: true,
     async fetchJobs(ctx: ProviderContext): Promise<Job[]> {
       // 1. fetch from an OFFICIAL API or a user-provided feed
       // 2. map each result to the Job shape (leave matchedKeywords: [])
       // 3. never throw — log and return [] on error
       return [];
     },
   };
   ```

2. **Register** it in `providers/index.ts`:

   ```ts
   import { myMarketplaceProvider } from "./mymarket";
   export const ALL_PROVIDERS: Provider[] = [ /* … */, myMarketplaceProvider ];
   ```

3. (If it reads feeds) **add sources** at runtime:
   `/addsource <url> mymarket`.

That's it — matching, dedup, anti-spam, and notifications all work
automatically. The included `providers/freelancer.ts` and
`providers/peopleperhour.ts` are documented placeholders showing the
API/feed-based path for each.

---

## Security notes

- **No hardcoded token.** `TELEGRAM_BOT_TOKEN` is read only from
  `process.env`; the token appears solely in the Bot API request URL at call
  time and is never logged.
- **Webhook auth** via the `X-Telegram-Bot-Api-Secret-Token` header
  (`TELEGRAM_WEBHOOK_SECRET`).
- **Cron auth** via `Authorization: Bearer <CRON_SECRET>` (or `?secret=`).
- **Parameterized SQL** everywhere (no string interpolation into queries).
- **HTML-escaped** notification content (`parse_mode=HTML`).
- `.env*` files are git-ignored; `.env.example` ships placeholders only.
- Sources are restricted to public/official/user-provided feeds — the code
  never bypasses login, captcha, rate limits, or protected pages.
