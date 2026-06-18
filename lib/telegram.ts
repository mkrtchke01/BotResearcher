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

export async function sendMessage(
  chatId: number | string,
  text: string,
  opts: SendMessageOptions = {},
): Promise<boolean> {
  try {
    const res = await fetch(apiUrl("sendMessage"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        disable_web_page_preview: opts.disablePreview ?? false,
        disable_notification: opts.disableNotification ?? false,
      }),
    });
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
