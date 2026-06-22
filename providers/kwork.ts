import { MAX_JOBS_PER_SOURCE } from "@/lib/env";
import type { Job, Provider, ProviderContext } from "./types";

/**
 * Kwork provider — reads the public "Биржа проектов" listing filtered to ONE
 * category: "Создание сайта" (category id 37, the `fc=37` filter you see in the
 * URL https://kwork.ru/projects?fc=37).
 *
 * Kwork has no public projects API, but the listing page embeds the full,
 * already-rendered project data as a JSON blob assigned to `window.stateData`
 * (stateData.wantsListData.wants[]). We fetch the page HTML, extract that JSON,
 * and map it to Job[] — no login, no scraping of protected/logged-in pages, no
 * captcha bypass. The page is server-side filtered to category 37, so every
 * result is a "Создание сайта" order; we pre-tag it as such so the monitor
 * keeps it regardless of free-text keyword hits (see lib/monitor.ts).
 *
 * Caveat: kwork sits behind Cloudflare and may serve a challenge or
 * geo-restrict requests from some datacenter IPs (Vercel runs outside RU). If
 * fetches start returning a challenge page instead of stateData, fetchJobs just
 * returns [] (no stateData found) — route through a RU-region proxy if that
 * happens. Never throws: logs and returns [] so one bad run can't break cron.
 */

const PLATFORM = "Kwork";
const CATEGORY_ID = 37; // "Создание сайта"
const LISTING_URL = `https://kwork.ru/projects?fc=${CATEGORY_ID}`;
const FETCH_TIMEOUT_MS = 9_000;

/** A project ("want") as embedded in window.stateData. Only fields we use. */
interface KworkWant {
  id: number;
  name: string;
  description: string;
  status: string; // "active" for open postings
  priceLimit: string | null; // desired budget, e.g. "30000.00"
  possiblePriceLimit: number | null; // max acceptable, e.g. 90000
  date_create: string | null; // "YYYY-MM-DD HH:MM:SS", Moscow time (UTC+3)
  category_id: number | string; // kwork sends this as a string, e.g. "37"
}

/**
 * Extract the JSON object assigned to `window.stateData=` by brace-matching
 * from the first `{` (string-aware, so braces inside quoted values don't throw
 * off the depth count). Returns null if the marker or a balanced object isn't
 * found (e.g. a Cloudflare challenge page was served instead).
 */
function extractStateData(html: string): unknown {
  const marker = "window.stateData=";
  const at = html.indexOf(marker);
  if (at === -1) return null;
  let i = at + marker.length;
  while (i < html.length && html[i] !== "{") i++;
  const begin = i;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(begin, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/** "30000.00" -> "до 30 000 ₽", with допустимый ceiling when it's higher. */
function formatBudget(w: KworkWant): string | null {
  const ru = (n: number) => n.toLocaleString("ru-RU");
  const desired = w.priceLimit != null ? Number(w.priceLimit) : NaN;
  const max =
    w.possiblePriceLimit != null ? Number(w.possiblePriceLimit) : NaN;
  if (Number.isFinite(desired) && desired > 0) {
    let out = `до ${ru(desired)} ₽`;
    if (Number.isFinite(max) && max > desired) {
      out += ` (допустимо до ${ru(max)} ₽)`;
    }
    return out;
  }
  if (Number.isFinite(max) && max > 0) return `до ${ru(max)} ₽`;
  return null;
}

/** kwork date_create has no zone and is Moscow time — tag it as UTC+3. */
function toIso(ts: string | null): string | null {
  if (!ts) return null;
  const d = new Date(ts.trim().replace(" ", "T") + "+03:00");
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

async function fetchListing(): Promise<KworkWant[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(LISTING_URL, {
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "ru-RU,ru;q=0.9",
        // A browser UA — kwork returns a stripped page to obvious bots.
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Kwork responded ${res.status} ${res.statusText}`);
    }
    const html = await res.text();
    const state = extractStateData(html) as
      | { wantsListData?: { wants?: KworkWant[] } }
      | null;
    return state?.wantsListData?.wants ?? [];
  } finally {
    clearTimeout(timer);
  }
}

export const kworkProvider: Provider = {
  key: "kwork",
  displayName: PLATFORM,
  enabled: true,

  async fetchJobs(_ctx: ProviderContext): Promise<Job[]> {
    try {
      const wants = await fetchListing();
      return wants
        .filter(
          (w) =>
            w &&
            w.id &&
            w.status === "active" &&
            // category_id arrives as a string ("37"); coerce before comparing.
            Number(w.category_id) === CATEGORY_ID,
        )
        .slice(0, MAX_JOBS_PER_SOURCE)
        .map((w) => ({
          id: String(w.id),
          platform: PLATFORM,
          title: w.name || "(без названия)",
          description: w.description || "",
          budget: formatBudget(w),
          clientCountry: null,
          postedAt: toIso(w.date_create),
          // /view requires login, but a logged-in user lands on the project.
          url: `https://kwork.ru/projects/${w.id}/view`,
          // Server-side filtered to category 37, so pre-tag as the niche to
          // keep it regardless of free-text keyword hits (see lib/monitor.ts).
          matchedKeywords: ["Создание сайта"],
        }));
    } catch (err) {
      console.error("[kwork] failed to fetch projects:", err);
      return [];
    }
  },
};
