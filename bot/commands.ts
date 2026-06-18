import { escapeHtml } from "@/lib/format";
import { sendMessage } from "@/lib/telegram";
import {
  getMonitoring,
  setMonitoring,
  upsertUser,
  deactivateUser,
  getKeywords,
  addKeyword,
  removeKeyword,
  getSources,
  addSource,
  removeSource,
} from "@/lib/repo";

/**
 * Telegram command router. Parses a message, runs the matching command, and
 * replies. Handlers fail soft — a thrown error is caught by the webhook route
 * which still returns 200 so Telegram doesn't hammer retries.
 */

interface TgChat {
  id: number;
  type?: string;
}
interface TgFrom {
  id: number;
  username?: string;
  first_name?: string;
}
export interface TgMessage {
  message_id: number;
  chat: TgChat;
  from?: TgFrom;
  text?: string;
}
export interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

const HELP = [
  "<b>BotResearcher</b> — freelance job monitor",
  "",
  "/start — start monitoring & subscribe this chat",
  "/stop — stop monitoring",
  "/status — show monitoring status",
  "/keywords — list active keywords",
  "/addkeyword &lt;keyword&gt; — add a keyword",
  "/removekeyword &lt;keyword&gt; — remove a keyword",
  "/sources — list connected sources",
  "/addsource &lt;url&gt; [upwork|custom-rss] — add an RSS/search feed",
  "/removesource &lt;url&gt; — remove a source",
  "/help — show this help",
].join("\n");

/** Split "/addkeyword landing page" → { cmd: "addkeyword", arg: "landing page" }. */
function parse(text: string): { cmd: string; arg: string } {
  const trimmed = text.trim();
  const spaceIdx = trimmed.search(/\s/);
  const head = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
  const arg = spaceIdx === -1 ? "" : trimmed.slice(spaceIdx + 1).trim();
  // Strip a "/cmd@BotName" mention suffix that group chats add.
  const cmd = head.replace(/^\//, "").split("@")[0];
  return { cmd, arg };
}

export async function handleUpdate(update: TgUpdate): Promise<void> {
  const msg = update.message;
  if (!msg || !msg.text) return;
  const chatId = msg.chat.id;
  const text = msg.text.trim();
  if (!text.startsWith("/")) return; // ignore non-command chatter

  const { cmd, arg } = parse(text);

  switch (cmd) {
    case "start":
      await upsertUser(
        chatId,
        msg.from?.username ?? null,
        msg.from?.first_name ?? null,
      );
      await setMonitoring(true);
      await sendMessage(
        chatId,
        "✅ <b>Monitoring started.</b> I'll notify this chat about new relevant freelance jobs.\n\n" +
          HELP,
      );
      break;

    case "stop":
      await setMonitoring(false);
      await deactivateUser(chatId);
      await sendMessage(
        chatId,
        "🛑 <b>Monitoring stopped.</b> Send /start to resume.",
      );
      break;

    case "status": {
      const [on, keywords, sources] = await Promise.all([
        getMonitoring(),
        getKeywords(),
        getSources(),
      ]);
      const enabled = sources.filter((s) => s.enabled).length;
      await sendMessage(
        chatId,
        [
          `📊 <b>Status</b>`,
          `Monitoring: ${on ? "🟢 ON" : "🔴 OFF"}`,
          `Keywords: ${keywords.length}`,
          `Sources: ${sources.length} (${enabled} enabled)`,
        ].join("\n"),
      );
      break;
    }

    case "keywords": {
      const keywords = await getKeywords();
      await sendMessage(
        chatId,
        keywords.length
          ? `🎯 <b>Active keywords (${keywords.length}):</b>\n` +
              keywords.map((k) => `• ${escapeHtml(k)}`).join("\n")
          : "No keywords yet. Add one with /addkeyword &lt;keyword&gt;.",
      );
      break;
    }

    case "addkeyword": {
      if (!arg) {
        await sendMessage(chatId, "Usage: /addkeyword &lt;keyword&gt;");
        break;
      }
      const added = await addKeyword(arg);
      await sendMessage(
        chatId,
        added
          ? `✅ Added keyword: <b>${escapeHtml(arg.toLowerCase())}</b>`
          : `ℹ️ Keyword already exists: <b>${escapeHtml(arg.toLowerCase())}</b>`,
      );
      break;
    }

    case "removekeyword": {
      if (!arg) {
        await sendMessage(chatId, "Usage: /removekeyword &lt;keyword&gt;");
        break;
      }
      const removed = await removeKeyword(arg);
      await sendMessage(
        chatId,
        removed
          ? `🗑️ Removed keyword: <b>${escapeHtml(arg.toLowerCase())}</b>`
          : `❓ Keyword not found: <b>${escapeHtml(arg.toLowerCase())}</b>`,
      );
      break;
    }

    case "sources": {
      const sources = await getSources();
      await sendMessage(
        chatId,
        sources.length
          ? `🔌 <b>Connected sources (${sources.length}):</b>\n` +
              sources
                .map(
                  (s) =>
                    `• [${escapeHtml(s.platform)}]${s.enabled ? "" : " (disabled)"} ${escapeHtml(s.url)}`,
                )
                .join("\n")
          : "No sources yet. Add one with /addsource &lt;url&gt;.",
        { disablePreview: true },
      );
      break;
    }

    case "addsource": {
      const parts = arg.split(/\s+/).filter(Boolean);
      const url = parts[0];
      const platform = (parts[1] ?? "custom-rss").toLowerCase();
      if (!url || !/^https?:\/\//i.test(url)) {
        await sendMessage(
          chatId,
          "Usage: /addsource &lt;https-url&gt; [upwork|custom-rss]",
        );
        break;
      }
      const ok = ["upwork", "custom-rss"].includes(platform)
        ? platform
        : "custom-rss";
      const added = await addSource(url, ok);
      await sendMessage(
        chatId,
        added
          ? `✅ Added source [${escapeHtml(ok)}]: ${escapeHtml(url)}`
          : `ℹ️ Source already exists: ${escapeHtml(url)}`,
        { disablePreview: true },
      );
      break;
    }

    case "removesource": {
      if (!arg) {
        await sendMessage(chatId, "Usage: /removesource &lt;url&gt;");
        break;
      }
      const removed = await removeSource(arg.split(/\s+/)[0]);
      await sendMessage(
        chatId,
        removed
          ? `🗑️ Removed source: ${escapeHtml(arg)}`
          : `❓ Source not found: ${escapeHtml(arg)}`,
        { disablePreview: true },
      );
      break;
    }

    case "help":
      await sendMessage(chatId, HELP, { disablePreview: true });
      break;

    default:
      await sendMessage(
        chatId,
        `❓ Unknown command: <b>${escapeHtml("/" + cmd)}</b>\n\n` + HELP,
      );
  }
}
