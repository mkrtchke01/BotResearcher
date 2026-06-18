/**
 * Register (or delete) the Telegram webhook.
 *
 *   npm run set-webhook        # registers APP_URL/api/telegram/webhook
 *   npm run delete-webhook     # removes the webhook
 *
 * Reads TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, and APP_URL from the
 * environment (use --env-file=.env.local via the npm scripts, or export them).
 */
import { setWebhook, deleteWebhook } from "../lib/telegram";

// Load .env.local if present (Node 20.6+). Ignore if missing — vars may come
// from the real environment instead.
try {
  (process as NodeJS.Process & { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(
    ".env.local",
  );
} catch {
  /* no .env.local — rely on the shell environment */
}

async function main() {
  const del = process.argv.includes("--delete");

  if (del) {
    const res = await deleteWebhook();
    console.log("deleteWebhook:", JSON.stringify(res, null, 2));
    return;
  }

  const appUrl = process.env.APP_URL;
  if (!appUrl) {
    console.error("APP_URL is not set (e.g. https://your-app.vercel.app).");
    process.exit(1);
  }
  const url = `${appUrl.replace(/\/$/, "")}/api/telegram/webhook`;
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    console.warn("⚠️  TELEGRAM_WEBHOOK_SECRET not set — webhook will be unauthenticated.");
  }

  const res = await setWebhook(url, secret);
  console.log(`setWebhook → ${url}`);
  console.log(JSON.stringify(res, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
