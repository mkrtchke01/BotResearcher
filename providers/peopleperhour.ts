import type { Job, Provider, ProviderContext } from "./types";

/**
 * PeoplePerHour provider — PLACEHOLDER.
 *
 * PeoplePerHour does not offer a broad public jobs API. The compliant path is
 * a user-provided RSS/search-alert feed (if your account exposes one) wired in
 * via the generic custom-rss provider, OR an official partner API if you have
 * access. Do NOT scrape protected/logged-in pages or bypass rate limits.
 *
 * To implement against a sanctioned feed/API: fetch, then map results to the
 * Job shape and flip `enabled` to true.
 */
export const peoplePerHourProvider: Provider = {
  key: "peopleperhour",
  displayName: "PeoplePerHour",
  enabled: false,

  async fetchJobs(_ctx: ProviderContext): Promise<Job[]> {
    return [];
  },
};
