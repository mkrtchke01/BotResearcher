/**
 * Centralized, validated access to environment variables.
 *
 * Secrets (Telegram token, DB URL, cron secret) are read ONLY from
 * process.env and never hardcoded. Helpers throw a clear error when a
 * required variable is missing so misconfiguration fails loudly at the edge
 * instead of silently sending requests with `undefined` in the URL.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value && value.trim() !== "" ? value : undefined;
}

export const env = {
  get telegramBotToken(): string {
    return required("TELEGRAM_BOT_TOKEN");
  },
  get telegramChatId(): string | undefined {
    return optional("TELEGRAM_CHAT_ID");
  },
  get telegramWebhookSecret(): string | undefined {
    return optional("TELEGRAM_WEBHOOK_SECRET");
  },
  get databaseUrl(): string {
    return required("DATABASE_URL");
  },
  get cronSecret(): string | undefined {
    return optional("CRON_SECRET");
  },
  get appUrl(): string | undefined {
    return optional("APP_URL");
  },
};

/**
 * Max notifications to send per cron run. Unlimited by default — every fresh
 * match is sent immediately. Set MAX_NOTIFICATIONS_PER_CHECK to a positive
 * integer if you want to cap the first-run backlog flood; 0 or unset means no
 * cap. (Telegram rate limits are handled with a 429-aware retry in telegram.ts.)
 */
export const MAX_NOTIFICATIONS_PER_CHECK = (() => {
  const raw = Number(optional("MAX_NOTIFICATIONS_PER_CHECK") ?? "0");
  return Number.isFinite(raw) && raw > 0 ? raw : Number.POSITIVE_INFINITY;
})();

/** Max jobs a single source may contribute per run (defensive cap). */
export const MAX_JOBS_PER_SOURCE = 50;

/** Base URL of the public LaborX job-board API (override only for testing). */
export const LABORX_API_URL =
  optional("LABORX_API_URL") ?? "https://api.laborx.com";

/**
 * How many newest LaborX jobs to pull per run. Must comfortably exceed the
 * number of jobs posted between two cron runs so nothing is missed; the whole
 * board posts well under 50/run at any sane interval. Capped defensively.
 */
export const LABORX_FETCH_LIMIT = Math.min(
  Number(optional("LABORX_FETCH_LIMIT") ?? "50") || 50,
  MAX_JOBS_PER_SOURCE,
);

/**
 * Freshness window: only notify about jobs posted within this many hours.
 * Drops stale postings — including old jobs that boards re-surface by bumping
 * (e.g. LaborX sort=newest). Jobs with no parseable post date are kept (age
 * unknown). Default 24h. Set MAX_JOB_AGE_HOURS to override.
 */
export const MAX_JOB_AGE_HOURS = (() => {
  const raw = Number(optional("MAX_JOB_AGE_HOURS") ?? "24");
  return Number.isFinite(raw) && raw > 0 ? raw : 24;
})();
