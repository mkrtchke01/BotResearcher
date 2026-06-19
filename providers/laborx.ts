import { LABORX_API_URL, LABORX_FETCH_LIMIT } from "@/lib/env";
import type { Job, Provider, ProviderContext } from "./types";

/**
 * LaborX provider — reads the public job board API at api.laborx.com.
 *
 * Unlike the RSS providers, LaborX needs no source rows: it polls the same
 * public endpoint the website itself uses to render https://laborx.com/jobs
 *   GET https://api.laborx.com/simple-jobs/list?limit=<n>&sort=newest
 * which returns the freshest postings first (newest `first_published_at`).
 *
 * IMPORTANT — why we do NOT pass the API's `search` filter:
 * server-side `search` re-ranks results by text relevance and stops honouring
 * `sort=newest`, so a brand-new job can be buried pages deep and missed. To
 * "get new offers as fast as possible" we instead pull the newest N jobs with
 * NO text filter and let the central keyword matcher (lib/matcher.ts) decide
 * relevance. That guarantees every new post is seen the moment it appears; the
 * landing / bot / web-application filtering happens via keywords (see
 * db/schema.sql seed list, editable at runtime with /addkeyword).
 *
 * Uses only the public, unauthenticated endpoint — no login, token, or
 * scraping. Never throws: logs and returns [] so one bad run can't break cron.
 */

const PLATFORM = "LaborX";
const FETCH_TIMEOUT_MS = 8_000;

/** A job listing as returned by /simple-jobs/list. Only fields we use. */
interface LaborXJob {
  id: number;
  slug: string;
  stage: number; // 1 = open/published
  name: string;
  description: string;
  budget: string | null; // numeric string, e.g. "3000.00000000"; USD on-site
  first_published_at: string | null; // "YYYY-MM-DD HH:MM:SS" (UTC)
  created_at: string | null;
}

/**
 * Decode the handful of HTML entities LaborX embeds in plain-text fields like
 * the job title ("Research &amp; Recovery"). Without this the downstream
 * escapeHtml() in notify.ts would double-escape "&amp;" into "&amp;amp;".
 * (Descriptions are HTML and handled by stripHtml/summarize, so only titles
 * need this.)
 */
function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;|&apos;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)));
}

/** LaborX timestamps are UTC "YYYY-MM-DD HH:MM:SS" with no zone — tag as UTC. */
function toIso(ts: string | null): string | null {
  if (!ts) return null;
  const d = new Date(ts.trim().replace(" ", "T") + "Z");
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** "3000.00000000" -> "$3,000"; null/0/garbage -> null. */
function formatBudget(budget: string | null): string | null {
  if (!budget) return null;
  const n = Number(budget);
  if (!Number.isFinite(n) || n <= 0) return null;
  return `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

async function fetchNewest(limit: number): Promise<LaborXJob[]> {
  const url = `${LABORX_API_URL}/simple-jobs/list?sort=newest&limit=${limit}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "BotResearcher/1.0 (+https://github.com/) job poller",
      },
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`LaborX responded ${res.status} ${res.statusText}`);
    }
    const body = (await res.json()) as { result?: { jobs?: LaborXJob[] } };
    return body.result?.jobs ?? [];
  } finally {
    clearTimeout(timer);
  }
}

export const laborxProvider: Provider = {
  key: "laborx",
  displayName: PLATFORM,
  enabled: true,

  async fetchJobs(_ctx: ProviderContext): Promise<Job[]> {
    try {
      const raw = await fetchNewest(LABORX_FETCH_LIMIT);
      return raw
        // Only open postings (stage 1); skip drafts/closed/archived.
        .filter((j) => j.stage === 1 && j.id && j.slug)
        .map((j) => ({
          id: String(j.id),
          platform: PLATFORM,
          title: j.name ? decodeEntities(j.name) : "(untitled)",
          description: j.description ?? "",
          budget: formatBudget(j.budget),
          clientCountry: null, // not exposed by the public list endpoint
          postedAt: toIso(j.first_published_at ?? j.created_at),
          url: `https://laborx.com/jobs/${j.slug}`,
          matchedKeywords: [],
        }));
    } catch (err) {
      console.error("[laborx] failed to fetch jobs:", err);
      return [];
    }
  },
};
