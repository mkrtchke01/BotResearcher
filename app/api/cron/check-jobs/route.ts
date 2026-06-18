import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { runMonitorCycle } from "@/lib/monitor";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Allow up to 60s; a full cycle fetches several feeds + sends messages.
export const maxDuration = 60;

/**
 * Cron entry point. Triggered by Vercel Cron (see vercel.json) on a schedule,
 * or manually for testing.
 *
 * Auth: Vercel Cron automatically sends `Authorization: Bearer <CRON_SECRET>`
 * when CRON_SECRET is set on the project. We also accept `?secret=` for manual
 * runs. If CRON_SECRET is unset we allow the call (dev convenience) but warn.
 */
function authorized(req: NextRequest): boolean {
  const secret = env.cronSecret;
  if (!secret) {
    console.warn("[cron] CRON_SECRET is not set — endpoint is unprotected");
    return true;
  }
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  if (req.nextUrl.searchParams.get("secret") === secret) return true;
  return false;
}

async function run(req: NextRequest): Promise<NextResponse> {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    // Global deadline well under maxDuration so the function returns a JSON
    // diagnostic instead of letting the platform 504 it on an unexpected hang.
    const result = await Promise.race([
      runMonitorCycle(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("monitor cycle exceeded 45s deadline")), 45_000),
      ),
    ]);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    // Defensive: runMonitorCycle is designed not to throw, but never 500 the cron.
    console.error("[cron] unexpected error:", err);
    return NextResponse.json({ ok: false, error: String(err) }, { status: 200 });
  }
}

// Vercel Cron issues GET requests.
export async function GET(req: NextRequest): Promise<NextResponse> {
  return run(req);
}

// Allow POST too, for manual triggering with curl.
export async function POST(req: NextRequest): Promise<NextResponse> {
  return run(req);
}
