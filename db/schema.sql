-- ============================================================================
-- BotResearcher — database schema (PostgreSQL: Supabase / Neon)
-- Run this once against your DATABASE_URL (psql, Supabase SQL editor, or
-- `npm run db:init` which executes this file).
-- ============================================================================

-- Global on/off switch for monitoring. Single-row table (id is forced to 1).
CREATE TABLE IF NOT EXISTS bot_state (
  id          SMALLINT PRIMARY KEY DEFAULT 1,
  monitoring  BOOLEAN  NOT NULL DEFAULT FALSE,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT bot_state_singleton CHECK (id = 1)
);
INSERT INTO bot_state (id, monitoring) VALUES (1, FALSE)
  ON CONFLICT (id) DO NOTHING;

-- Telegram chats that issued /start and should receive notifications.
CREATE TABLE IF NOT EXISTS users (
  chat_id     BIGINT PRIMARY KEY,
  username    TEXT,
  first_name  TEXT,
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Keywords used to match job posts (case-insensitive, stored lower-cased).
CREATE TABLE IF NOT EXISTS keywords (
  id          SERIAL PRIMARY KEY,
  keyword     TEXT UNIQUE NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sources to poll. `platform` selects which provider parses the feed.
-- 'custom-rss' is the generic RSS/Atom provider; 'upwork' is the Upwork RSS feed.
CREATE TABLE IF NOT EXISTS sources (
  id          SERIAL PRIMARY KEY,
  url         TEXT UNIQUE NOT NULL,
  platform    TEXT NOT NULL DEFAULT 'custom-rss',
  label       TEXT,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Already-notified jobs, for duplicate protection.
-- job_key = "<platform>:<id>"; normalized_url is the deduped link.
CREATE TABLE IF NOT EXISTS sent_jobs (
  job_key        TEXT PRIMARY KEY,
  normalized_url TEXT NOT NULL,
  platform       TEXT,
  title          TEXT,
  sent_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sent_jobs_url      ON sent_jobs (normalized_url);
CREATE INDEX IF NOT EXISTS idx_sent_jobs_sent_at  ON sent_jobs (sent_at);

-- ----------------------------------------------------------------------------
-- Seed default keywords (idempotent). Edit/extend via the /addkeyword command.
--
-- Tuned for three target niches: LANDING PAGES, BOTS, WEB APPLICATIONS.
-- Matching (lib/matcher.ts) is case-insensitive with word boundaries and treats
-- spaces / "-" / "_" / "/" as flexible separators, so e.g. "web app" also
-- matches "web-app" and "web_app". Boundaries are strict on plurals, so a
-- standalone short form (e.g. "landing") is seeded alongside the phrase to also
-- catch "landing pages". Remove any you find too broad with /removekeyword.
-- ----------------------------------------------------------------------------
INSERT INTO keywords (keyword) VALUES
  -- Landing pages
  ('landing'),
  ('landing page'),
  -- Bots ("bot" alone catches "telegram bot", "trading bot", "mev bot", …;
  --  "chatbot" has no boundary so it is listed explicitly)
  ('bot'),
  ('chatbot'),
  ('telegram bot'),
  ('discord bot'),
  ('trading bot'),
  ('telegram mini app'),
  -- Web applications
  ('web app'),
  ('webapp'),
  ('web application'),
  ('web applications'),
  ('web platform'),
  ('dapp'),
  ('saas'),
  ('full stack'),
  ('web development')
ON CONFLICT (keyword) DO NOTHING;
