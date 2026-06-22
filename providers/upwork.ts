import { fetchFeed } from "@/lib/rss";
import { stripHtml } from "@/lib/format";
import { MAX_JOBS_PER_SOURCE } from "@/lib/env";
import type { Job, Provider, ProviderContext } from "./types";

/**
 * Upwork provider — reads Upwork's public RSS "saved search" feeds.
 *
 * Upwork exposes per-search RSS feeds (e.g. from a saved job search you create
 * while logged in: the search results page offers an RSS link). You add those
 * feed URLs as sources with platform = 'upwork' via the /addsource command or
 * the sources table. This uses only the official, user-provided RSS URL — no
 * scraping, no login bypass, no captcha circumvention.
 *
 * Example feed shape:
 *   https://www.upwork.com/nx/wm/saved-search/rss?key=<your-feed-key>
 *
 * Upwork RSS item descriptions embed budget / country as labeled lines, which
 * we best-effort parse out below.
 */

const PLATFORM = "Upwork";

/** Pull "Budget: $500" / "Hourly Range: $25.00-$45.00" out of the body. */
function parseBudget(description: string): string | null {
  const text = stripHtml(description);
  const hourly = text.match(/Hourly Range[:\s]*\$?([\d.,]+)\s*-\s*\$?([\d.,]+)/i);
  if (hourly) return `$${hourly[1]}–$${hourly[2]}/hr`;
  const budget = text.match(/Budget[:\s]*\$?([\d.,]+)/i);
  if (budget) return `Fixed: $${budget[1]}`;
  return null;
}

function parseCountry(description: string): string | null {
  const text = stripHtml(description);
  const m = text.match(/Country[:\s]*([A-Za-z .'-]{2,40})/i);
  return m ? m[1].trim() : null;
}

/** Upwork links contain a stable numeric job id like ~021234567890. */
function parseUpworkId(link: string, guid: string | null): string {
  const fromGuid = guid?.match(/~?(\d{12,})/)?.[1];
  if (fromGuid) return fromGuid;
  const fromLink = link.match(/~?(\d{12,})/)?.[1];
  return fromLink ?? guid ?? link;
}

export const upworkProvider: Provider = {
  key: "upwork",
  displayName: PLATFORM,
  enabled: false, // disabled — kwork-only monitoring

  async fetchJobs(ctx: ProviderContext): Promise<Job[]> {
    const feeds = ctx.sources.filter((s) => s.platform === "upwork" && s.enabled);
    const jobs: Job[] = [];

    for (const source of feeds) {
      try {
        const items = await fetchFeed(source.url);
        for (const item of items.slice(0, MAX_JOBS_PER_SOURCE)) {
          if (!item.link) continue;
          jobs.push({
            id: parseUpworkId(item.link, item.guid),
            platform: PLATFORM,
            title: item.title || "(untitled)",
            description: item.description,
            budget: parseBudget(item.description),
            clientCountry: parseCountry(item.description),
            postedAt: item.pubDate,
            url: item.link,
            matchedKeywords: [],
          });
        }
      } catch (err) {
        console.error(`[upwork] failed to read ${source.url}:`, err);
      }
    }
    return jobs;
  },
};
