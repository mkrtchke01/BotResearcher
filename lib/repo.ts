import { sql } from "./db";

/**
 * Data-access layer. All SQL lives here so the rest of the app deals with
 * plain objects. Uses tagged-template queries from `postgres` (parameterized,
 * SQL-injection safe).
 */

export interface SourceRow {
  id: number;
  url: string;
  platform: string;
  label: string | null;
  enabled: boolean;
}

// ---------------------------------------------------------------------------
// Bot state
// ---------------------------------------------------------------------------

export async function getMonitoring(): Promise<boolean> {
  const rows = await sql<{ monitoring: boolean }[]>`
    SELECT monitoring FROM bot_state WHERE id = 1
  `;
  return rows[0]?.monitoring ?? false;
}

export async function setMonitoring(on: boolean): Promise<void> {
  await sql`
    INSERT INTO bot_state (id, monitoring, updated_at)
    VALUES (1, ${on}, NOW())
    ON CONFLICT (id) DO UPDATE SET monitoring = ${on}, updated_at = NOW()
  `;
}

// ---------------------------------------------------------------------------
// Users (chats that should receive notifications)
// ---------------------------------------------------------------------------

export async function upsertUser(
  chatId: number,
  username: string | null,
  firstName: string | null,
): Promise<void> {
  await sql`
    INSERT INTO users (chat_id, username, first_name, is_active)
    VALUES (${chatId}, ${username}, ${firstName}, TRUE)
    ON CONFLICT (chat_id)
      DO UPDATE SET username = ${username}, first_name = ${firstName}, is_active = TRUE
  `;
}

export async function deactivateUser(chatId: number): Promise<void> {
  await sql`UPDATE users SET is_active = FALSE WHERE chat_id = ${chatId}`;
}

export async function getActiveChatIds(): Promise<number[]> {
  const rows = await sql<{ chat_id: string }[]>`
    SELECT chat_id FROM users WHERE is_active = TRUE
  `;
  // BIGINT comes back as string from postgres.js — coerce to number.
  return rows.map((r) => Number(r.chat_id));
}

// ---------------------------------------------------------------------------
// Keywords
// ---------------------------------------------------------------------------

export async function getKeywords(): Promise<string[]> {
  const rows = await sql<{ keyword: string }[]>`
    SELECT keyword FROM keywords ORDER BY keyword
  `;
  return rows.map((r) => r.keyword);
}

/** Returns true if it was newly added, false if it already existed. */
export async function addKeyword(keyword: string): Promise<boolean> {
  const k = keyword.trim().toLowerCase();
  if (!k) return false;
  const rows = await sql`
    INSERT INTO keywords (keyword) VALUES (${k})
    ON CONFLICT (keyword) DO NOTHING
    RETURNING id
  `;
  return rows.length > 0;
}

/** Returns true if a row was removed. */
export async function removeKeyword(keyword: string): Promise<boolean> {
  const k = keyword.trim().toLowerCase();
  const rows = await sql`DELETE FROM keywords WHERE keyword = ${k} RETURNING id`;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------

export async function getSources(onlyEnabled = false): Promise<SourceRow[]> {
  const rows = onlyEnabled
    ? await sql<SourceRow[]>`
        SELECT id, url, platform, label, enabled FROM sources
        WHERE enabled = TRUE ORDER BY id`
    : await sql<SourceRow[]>`
        SELECT id, url, platform, label, enabled FROM sources ORDER BY id`;
  return rows;
}

export async function addSource(
  url: string,
  platform = "custom-rss",
  label: string | null = null,
): Promise<boolean> {
  const u = url.trim();
  if (!u) return false;
  const rows = await sql`
    INSERT INTO sources (url, platform, label) VALUES (${u}, ${platform}, ${label})
    ON CONFLICT (url) DO NOTHING
    RETURNING id
  `;
  return rows.length > 0;
}

export async function removeSource(url: string): Promise<boolean> {
  const rows = await sql`DELETE FROM sources WHERE url = ${url.trim()} RETURNING id`;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Duplicate protection (sent jobs)
// ---------------------------------------------------------------------------

/**
 * Given candidate job keys and normalized URLs, return the set of identifiers
 * that have ALREADY been sent (by job_key OR normalized_url). One round-trip.
 */
export async function getAlreadySent(
  jobKeys: string[],
  normalizedUrls: string[],
): Promise<{ keys: Set<string>; urls: Set<string> }> {
  if (jobKeys.length === 0 && normalizedUrls.length === 0) {
    return { keys: new Set(), urls: new Set() };
  }
  const rows = await sql<{ job_key: string; normalized_url: string }[]>`
    SELECT job_key, normalized_url FROM sent_jobs
    WHERE job_key = ANY(${jobKeys}) OR normalized_url = ANY(${normalizedUrls})
  `;
  return {
    keys: new Set(rows.map((r) => r.job_key)),
    urls: new Set(rows.map((r) => r.normalized_url)),
  };
}

/** Record a job as sent. ON CONFLICT makes concurrent runs idempotent. */
export async function markSent(job: {
  jobKey: string;
  normalizedUrl: string;
  platform: string;
  title: string;
}): Promise<void> {
  await sql`
    INSERT INTO sent_jobs (job_key, normalized_url, platform, title)
    VALUES (${job.jobKey}, ${job.normalizedUrl}, ${job.platform}, ${job.title})
    ON CONFLICT (job_key) DO NOTHING
  `;
}
