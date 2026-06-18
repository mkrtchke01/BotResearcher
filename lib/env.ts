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

/** Max notifications to send per cron run, to avoid spamming on first sync. */
export const MAX_NOTIFICATIONS_PER_CHECK = 10;

/** Max jobs a single source may contribute per run (defensive cap). */
export const MAX_JOBS_PER_SOURCE = 50;
