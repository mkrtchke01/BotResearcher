import { fetchFeed } from "@/lib/rss";
import { MAX_JOBS_PER_SOURCE } from "@/lib/env";
import type { Job, Provider, ProviderContext } from "./types";

/**
 * Generic RSS/Atom provider. Reads any user-provided feed registered with
 * platform = 'custom-rss' (the default for /addsource). This is how you wire
 * up arbitrary marketplaces, job boards, or aggregators that expose a public
 * RSS/Atom feed (e.g. WeWorkRemotely category feeds, RemoteOK RSS, a personal
 * search alert feed, etc.).
 *
 * It makes no assumptions about budget/country since those vary per feed —
 * those fields are left null unless a feed supplies them in a standard place.
 */

const PLATFORM = "RSS";

/** Derive a hostname label so notifications show where the job came from. */
function platformLabel(feedUrl: string, label: string | null): string {
  if (label && label.trim()) return label.trim();
  try {
    return new URL(feedUrl).hostname.replace(/^www\./, "");
  } catch {
    return PLATFORM;
  }
}

/** Stable id: prefer feed guid, else fall back to the link. */
function itemId(guid: string | null, link: string): string {
  return (guid && guid.trim()) || link;
}

export const customRssProvider: Provider = {
  key: "custom-rss",
  displayName: PLATFORM,
  enabled: true,

  async fetchJobs(ctx: ProviderContext): Promise<Job[]> {
    const feeds = ctx.sources.filter(
      (s) => s.platform === "custom-rss" && s.enabled,
    );
    const jobs: Job[] = [];

    for (const source of feeds) {
      const label = platformLabel(source.url, source.label);
      try {
        const items = await fetchFeed(source.url);
        for (const item of items.slice(0, MAX_JOBS_PER_SOURCE)) {
          if (!item.link) continue;
          jobs.push({
            id: itemId(item.guid, item.link),
            platform: label,
            title: item.title || "(untitled)",
            description: item.description,
            budget: null,
            clientCountry: null,
            postedAt: item.pubDate,
            url: item.link,
            matchedKeywords: [],
          });
        }
      } catch (err) {
        console.error(`[custom-rss] failed to read ${source.url}:`, err);
      }
    }
    return jobs;
  },
};
