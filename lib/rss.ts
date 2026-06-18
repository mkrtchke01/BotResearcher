import { XMLParser } from "fast-xml-parser";

/**
 * Minimal, dependency-light RSS 2.0 / Atom fetcher + parser shared by all
 * feed-based providers. Returns a normalized list of feed items. Never throws
 * on a single bad feed — callers handle the empty array.
 */

export interface FeedItem {
  guid: string | null;
  title: string;
  link: string;
  description: string;
  pubDate: string | null; // ISO 8601 when parseable
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  trimValues: true,
  // Public/user-provided job feeds routinely contain thousands of standard
  // HTML entities (&amp;, &#39;, …). fast-xml-parser caps *total* entity
  // expansions at 1000 by default as a DoS guard, which large but legitimate
  // feeds exceed. Pass processEntities as an object to raise the cap to a
  // high-but-bounded value, keeping protection against pathological inputs.
  processEntities: {
    enabled: true,
    maxTotalExpansions: 500_000,
    maxExpandedLength: 10_000_000,
  },
});

const FETCH_TIMEOUT_MS = 12_000;

export async function fetchFeed(url: string): Promise<FeedItem[]> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        // Many feeds reject requests without a UA.
        "User-Agent": "BotResearcher/1.0 (+https://github.com/) RSS reader",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
      },
      // Always fetch fresh on the server.
      cache: "no-store",
    });
    if (!res.ok) {
      throw new Error(`Feed responded ${res.status} ${res.statusText}`);
    }
    const xml = await res.text();
    return parseFeed(xml);
  } finally {
    clearTimeout(timer);
  }
}

function asArray<T>(v: T | T[] | undefined | null): T[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object" && "#text" in (v as Record<string, unknown>)) {
    return String((v as Record<string, unknown>)["#text"] ?? "");
  }
  return String(v);
}

function toIso(date: unknown): string | null {
  const s = text(date).trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function parseFeed(xml: string): FeedItem[] {
  const doc = parser.parse(xml) as Record<string, any>;

  // RSS 2.0: rss > channel > item[]
  const rssItems = asArray(doc?.rss?.channel?.item);
  if (rssItems.length > 0) {
    return rssItems.map((it: any) => ({
      guid: text(it.guid) || null,
      title: text(it.title),
      link: text(it.link),
      description: text(it.description) || text(it["content:encoded"]),
      pubDate: toIso(it.pubDate ?? it["dc:date"]),
    }));
  }

  // Atom: feed > entry[]
  const atomEntries = asArray(doc?.feed?.entry);
  if (atomEntries.length > 0) {
    return atomEntries.map((e: any) => {
      const links = asArray(e.link);
      const href =
        links.find((l: any) => l?.["@_rel"] === "alternate")?.["@_href"] ??
        links[0]?.["@_href"] ??
        text(e.link);
      return {
        guid: text(e.id) || null,
        title: text(e.title),
        link: text(href),
        description: text(e.summary) || text(e.content),
        pubDate: toIso(e.updated ?? e.published),
      };
    });
  }

  return [];
}
