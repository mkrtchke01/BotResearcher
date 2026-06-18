import type { SourceRow } from "@/lib/repo";

/**
 * A normalized job posting as returned by a provider. `matchedKeywords` is
 * filled in centrally by the monitor after keyword matching, so providers may
 * return it empty.
 */
export interface Job {
  /** Stable per-platform identifier (provider sets this; used for dedup). */
  id: string;
  /** Human-readable platform name, e.g. "Upwork". */
  platform: string;
  title: string;
  description: string;
  /** Free-form budget string ("Fixed: $500", "$25–$45/hr") or null. */
  budget: string | null;
  clientCountry: string | null;
  /** ISO 8601 timestamp or null when the feed omits it. */
  postedAt: string | null;
  url: string;
  /** Keywords that matched this job (populated by the monitor). */
  matchedKeywords: string[];
}

/** Context passed to every provider on each run. */
export interface ProviderContext {
  /** Active keywords (lower-cased). Providers may use them to build queries. */
  keywords: string[];
  /** Sources from the DB relevant to this provider (filtered by platform). */
  sources: SourceRow[];
}

/**
 * Provider contract. Add a new marketplace by implementing this interface and
 * registering it in providers/index.ts. `fetchJobs` must never throw — return
 * an empty array and let errors surface via logging so one provider can't take
 * down the whole cron run.
 */
export interface Provider {
  /** Unique key matching the `sources.platform` column, e.g. "upwork". */
  readonly key: string;
  /** Display name used in notifications, e.g. "Upwork". */
  readonly displayName: string;
  /** Whether the provider is implemented and ready to run. */
  readonly enabled: boolean;
  fetchJobs(ctx: ProviderContext): Promise<Job[]>;
}
