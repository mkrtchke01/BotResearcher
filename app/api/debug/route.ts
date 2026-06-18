import { NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";
import { sql } from "@/lib/db";
import { getKeywords, getSources, getActiveChatIds } from "@/lib/repo";
import { fetchFeed } from "@/lib/rss";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * TEMPORARY diagnostic endpoint. Isolates and times each operation the monitor
 * performs, each with its own hard timeout, so a hang in one stage can't mask
 * the others. Secret-protected like the cron route. Remove once diagnosed.
 *
 *   GET /api/debug?secret=<CRON_SECRET>
 */
function authorized(req: NextRequest): boolean {
  const secret = env.cronSecret;
  if (!secret) return true;
  const auth = req.headers.get("authorization");
  if (auth === `Bearer ${secret}`) return true;
  return req.nextUrl.searchParams.get("secret") === secret;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout ${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}

async function timed<T>(fn: () => Promise<T>, ms: number) {
  const start = Date.now();
  try {
    const value = await withTimeout(fn(), ms);
    return { ok: true, ms: Date.now() - start, value };
  } catch (e) {
    return { ok: false, ms: Date.now() - start, error: String(e) };
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!authorized(req)) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const out: Record<string, unknown> = {};

  // 1. Single trivial DB query.
  out.dbSingle = await timed(async () => {
    const r = await sql<{ one: number }[]>`SELECT 1 AS one`;
    return r[0]?.one;
  }, 12_000);

  // 2. The three concurrent queries the monitor runs at startup.
  out.dbConcurrent = await timed(async () => {
    const [k, s, c] = await Promise.all([
      getKeywords(),
      getSources(true),
      getActiveChatIds(),
    ]);
    return { keywords: k.length, sources: s.length, chats: c.length };
  }, 12_000);

  // 3. The configured feed fetch in isolation.
  out.feedFetch = await timed(async () => {
    const sources = await getSources(true);
    const url = sources[0]?.url ?? null;
    if (!url) return { note: "no source configured" };
    const items = await fetchFeed(url);
    return { url, items: items.length };
  }, 12_000);

  return NextResponse.json({ ok: true, ...out });
}
