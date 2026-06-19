import { env } from "./env";

/**
 * Thin Telegram Bot API client. The token is read from process.env via `env`
 * and embedded only in the request URL at call time — never logged, never
 * stored. All methods fail soft (log + return) so one bad send can't crash a
 * cron run.
 */

const API_BASE = "https://api.telegram.org";

function apiUrl(method: string): string {
  return `${API_BASE}/bot${env.telegramBotToken}/${method}`;
}

interface SendMessageOptions {
  disablePreview?: boolean;
  disableNotification?: boolean;
}

/** Cap how long we'll wait out a Telegram 429 so a cron run can't hang. */
const MAX_RETRY_AFTER_MS = 5_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postSendMessage(
  chatId: number | string,
  text: string,
  opts: SendMessageOptions,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    return await fetch(apiUrl("sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: opts.disablePreview ?? false,
        disable_notification: opts.disableNotification ?? false,
      }),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function sendMessage(
  chatId: number | string,
  text: string,
  opts: SendMessageOptions = {},
): Promise<boolean> {
  try {
    let res = await postSendMessage(chatId, text, opts);

    // Telegram throttles with HTTP 429 + parameters.retry_after (seconds). When
    // sending a backlog this is expected; wait it out once and retry so the
    // notification isn't dropped (and then marked sent → lost forever).
    if (res.status === 429) {
      const body = await res.clone().json().catch(() => null);
      const retryAfter = Number(body?.parameters?.retry_after) || 1;
      const waitMs = Math.min(retryAfter * 1000, MAX_RETRY_AFTER_MS);
      console.warn(`[telegram] 429 for chat ${chatId}; retrying in ${waitMs}ms`);
      await sleep(waitMs);
      res = await postSendMessage(chatId, text, opts);
    }

    if (!res.ok) {
      const body = await res.text();
      console.error(`[telegram] sendMessage ${res.status}: ${body}`);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[telegram] sendMessage failed:", err);
    return false;
  }
}

/** Send the same message to many chats; returns count of successful sends. */
export async function broadcast(
  chatIds: Array<number | string>,
  text: string,
  opts: SendMessageOptions = {},
): Promise<number> {
  let ok = 0;
  for (const id of chatIds) {
    if (await sendMessage(id, text, opts)) ok++;
  }
  return ok;
}

/** Register the webhook. Used by scripts/set-webhook.ts. */
export async function setWebhook(
  url: string,
  secretToken?: string,
): Promise<unknown> {
  const res = await fetch(apiUrl("setWebhook"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url,
      secret_token: secretToken,
      allowed_updates: ["message"],
      drop_pending_updates: true,
    }),
  });
  return res.json();
}

export async function deleteWebhook(): Promise<unknown> {
  const res = await fetch(apiUrl("deleteWebhook"), { method: "POST" });
  return res.json();
}
