import type { Job, Provider, ProviderContext } from "./types";

/**
 * Freelancer.com provider — PLACEHOLDER.
 *
 * Freelancer offers an official API (https://developers.freelancer.com/) that
 * requires an OAuth access token. To implement:
 *   1. Register an app and obtain a token (store as FREELANCER_OAUTH_TOKEN).
 *   2. Call GET /api/projects/0.1/projects/active/ with your query/filters.
 *   3. Map each project to the Job shape (id, title, description, budget from
 *      `budget.minimum/maximum`, url = `https://www.freelancer.com/projects/{seo_url}`).
 *
 * Until implemented, `enabled: false` keeps it out of the run loop.
 */
export const freelancerProvider: Provider = {
  key: "freelancer",
  displayName: "Freelancer",
  enabled: false,

  async fetchJobs(_ctx: ProviderContext): Promise<Job[]> {
    return [];
  },
};
