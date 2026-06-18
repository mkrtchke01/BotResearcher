import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { handleUpdate, type TgUpdate } from "@/bot/commands";

// Node.js runtime (postgres driver + full fetch). Never cache; never prerender.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Telegram webhook receiver.
 *
 * Security: Telegram echoes the secret we registered via setWebhook in the
 * `X-Telegram-Bot-Api-Secret-Token` header. We reject any request whose header
 * doesn't match TELEGRAM_WEBHOOK_SECRET, so only Telegram can drive the bot.
 *
 * We always return 200 (even on handler errors) so Telegram doesn't retry into
 * a loop; failures are logged instead.
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  const expected = env.telegramWebhookSecret;
  if (expected) {
    const got = req.headers.get("x-telegram-bot-api-secret-token");
    if (got !== expected) {
      console.warn("[webhook] rejected: bad secret token");
      return NextResponse.json({ ok: false }, { status: 401 });
    }
  }

  let update: TgUpdate;
  try {
    update = (await req.json()) as TgUpdate;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  try {
    await handleUpdate(update);
  } catch (err) {
    // Log but acknowledge, so Telegram marks the update as delivered.
    console.error("[webhook] handler error:", err);
  }

  return NextResponse.json({ ok: true });
}

// Telegram only POSTs; a GET is handy for a quick liveness check.
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true, service: "telegram-webhook" });
}
