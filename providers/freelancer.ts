import { MAX_JOBS_PER_SOURCE } from "@/lib/env";
import type { Job, Provider, ProviderContext } from "./types";

/**
 * Freelancer.com provider — reads the public "active projects" API the website
 * itself uses (no OAuth token required, no scraping):
 *   GET https://www.freelancer.com/api/projects/0.1/projects/active/
 *
 * The global feed posts several projects per minute, so instead of pulling the
 * raw firehose we filter SERVER-SIDE by the skill ("job") ids that define our
 * three target niches (landing pages / bots / web applications). That:
 *   - narrows ~thousands/day down to the few that matter,
 *   - preserves newest-first ordering (the filter doesn't re-rank like `query`
 *     does), so a brand-new matching project is always at the top, and
 *   - lets 50 newest cover many hours — nothing is missed between cron runs.
 *
 * Each project is tagged with its niche bucket(s) in `matchedKeywords`, so the
 * monitor keeps it regardless of free-text keyword hits (see lib/monitor.ts).
 * To tune precision, add/remove skill ids in SKILL_BUCKETS below — find ids at
 *   GET https://www.freelancer.com/api/projects/0.1/jobs/?lang=en
 */

const PLATFORM = "Freelancer";
const API_BASE = "https://www.freelancer.com/api/projects/0.1";
const FETCH_TIMEOUT_MS = 9_000;

/**
 * Freelancer skill ("job") id → our niche bucket. These ARE the filter: only
 * projects tagged with at least one of these skills are fetched. Broad,
 * noise-prone skills (17 Website Design, 1031 Web Development) are intentionally
 * left out; add them here if you want wider (but noisier) coverage.
 */
const SKILL_BUCKETS: Record<number, string> = {
  // Landing pages
  482: "landing",
  // Bots
  2068: "bot", // Chatbot
  2380: "bot", // Telegram API
  2916: "bot", // AI Chatbot Development
  2917: "bot", // AI Chatbot
  2918: "bot", // Bot Development
  2936: "bot", // Chatbot Integration
  // Web applications
  2382: "web application", // Web Application
  1088: "web application", // Full Stack Development
  2375: "web application", // DApps
  2695: "web application", // SaaS
  3012: "web application", // Web Application Audit
};

interface FreelancerProject {
  id: number;
  title: string;
  status: string;
  seo_url: string | null;
  description: string | null;
  preview_description: string | null;
  submitdate: number | null; // unix seconds
  type: string | null; // "fixed" | "hourly"
  budget: { minimum: number | null; maximum: number | null } | null;
  currency: { code: string; sign: string; exchange_rate?: number } | null;
  jobs: { id: number; name: string }[] | null;
}

/**
 * Build a human budget like "$1,500–$3,000" (USD) or "INR 1,500–12,500
 * (~$16–$132)" (non-USD). The "$" sign is ambiguous (AUD/CAD/SGD all use it),
 * so for non-USD currencies we prefix the ISO code and add a rough USD figure.
 */
function formatBudget(p: FreelancerProject): string | null {
  const b = p.budget;
  if (!b) return null;
  const cur = p.currency;
  const isUsd = cur?.code === "USD";
  const unit = isUsd ? "$" : cur?.code ? `${cur.code} ` : cur?.sign || "";
  const n = (v: number) => v.toLocaleString("en-US");
  const min = b.minimum ?? null;
  const max = b.maximum ?? null;
  let out: string | null = null;
  if (min != null && max != null) out = `${unit}${n(min)}–${n(max)}`;
  else if (min != null) out = `${unit}${n(min)}+`;
  else if (max != null) out = `up to ${unit}${n(max)}`;
  if (!out) return null;
  if (p.type === "hourly") out += "/hr";

  // Append a rough USD figure for non-USD currencies to make budgets scannable.
  const rate = cur?.exchange_rate;
  if (!isUsd && rate && (min != null || max != null)) {
    const usd = (v: number | null) =>
      v == null ? null : Math.round(v * rate).toLocaleString("en-US");
    const lo = usd(min);
    const hi = usd(max);
    const approx = lo && hi && lo !== hi ? `~$${lo}–$${hi}` : `~$${hi ?? lo}`;
    out += ` (${approx})`;
  }
  return out;
}

/** Niche bucket labels for a project, derived from its skill ids. */
function buckets(p: FreelancerProject): string[] {
  const set = new Set<string>();
  for (const j of p.jobs ?? []) {
    const bucket = SKILL_BUCKETS[j.id];
    if (bucket) set.add(bucket);
  }
  return [...set];
}

function buildUrl(): string {
  const params = new URLSearchParams({
    limit: String(MAX_JOBS_PER_SOURCE),
    job_details: "true",
    full_description: "true",
    // active endpoint defaults to newest-first; we rely on that for freshness.
  });
  // jobs[] is repeated once per skill id.
  for (const id of Object.keys(SKILL_BUCKETS)) params.append("jobs[]", id);
  return `${API_BASE}/projects/active/?${params.toString()}`;
}

export const freelancerProvider: Provider = {
  key: "freelancer",
  displayName: PLATFORM,
  enabled: true,

  async fetchJobs(_ctx: ProviderContext): Promise<Job[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetch(buildUrl(), {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "BotResearcher/1.0 (+https://github.com/) job poller",
        },
        cache: "no-store",
      });
      if (!res.ok) {
        throw new Error(`Freelancer responded ${res.status} ${res.statusText}`);
      }
      const body = (await res.json()) as {
        result?: { projects?: FreelancerProject[] };
      };
      const projects = body.result?.projects ?? [];

      return projects
        .filter((p) => p.status === "active" && p.id && p.seo_url)
        .map((p) => ({
          id: String(p.id),
          platform: PLATFORM,
          title: p.title || "(untitled)",
          description: p.description || p.preview_description || "",
          budget: formatBudget(p),
          clientCountry: null,
          postedAt: p.submitdate
            ? new Date(p.submitdate * 1000).toISOString()
            : null,
          url: `https://www.freelancer.com/projects/${p.seo_url}`,
          // Pre-tag with the niche(s) so the monitor keeps it without needing a
          // free-text keyword hit. Falls back to the platform name defensively.
          matchedKeywords: buckets(p).length ? buckets(p) : ["freelancer"],
        }));
    } catch (err) {
      console.error("[freelancer] failed to fetch projects:", err);
      return [];
    } finally {
      clearTimeout(timer);
    }
  },
};
