import { enabledProviders } from "@/providers";
import type { Job } from "@/providers/types";
import { matchKeywords } from "./matcher";
import { normalizeUrl } from "./format";
import { formatJobMessage } from "./notify";
import { broadcast } from "./telegram";
import { env, MAX_NOTIFICATIONS_PER_CHECK, MAX_JOB_AGE_HOURS } from "./env";
import {
  getMonitoring,
  getKeywords,
  getSources,
  getActiveChatIds,
  getAlreadySent,
  markSent,
} from "./repo";

export interface RunResult {
  ran: boolean;
  reason?: string;
  fetched: number;
  matched: number;
  fresh: number;
  notified: number;
  recipients: number;
  errors: string[];
  /** Per-stage wall-clock in ms, for diagnosing slow/hanging runs. */
  timings: Record<string, number>;
}

function jobKey(job: Job): string {
  return `${job.platform}:${job.id}`;
}

/** Hard timeout wrapper — rejects if `p` doesn't settle within `ms`. */
function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`${label} timed out after ${ms}ms`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/** Per-provider fetch budget. Belt-and-suspenders over the feed-level abort. */
const PROVIDER_TIMEOUT_MS = 15_000;

/**
 * One full monitoring cycle:
 *   1. Bail if monitoring is off.
 *   2. Fetch from all enabled providers (errors isolated per provider).
 *   3. Match against active keywords.
 *   4. Drop duplicates by job key AND normalized URL.
 *   5. Notify, capped at MAX_NOTIFICATIONS_PER_CHECK to avoid spam.
 *   6. Record sent jobs.
 *
 * Always resolves (never throws) so the cron route returns a clean 200 and the
 * function isn't retried into a crash loop.
 */
export async function runMonitorCycle(): Promise<RunResult> {
  const result: RunResult = {
    ran: false,
    fetched: 0,
    matched: 0,
    fresh: 0,
    notified: 0,
    recipients: 0,
    errors: [],
    timings: {},
  };
  const start = Date.now();
  const mark = (label: string) => {
    result.timings[label] = Date.now() - start;
  };

  if (!(await getMonitoring())) {
    result.reason = "monitoring is off";
    return result;
  }
  result.ran = true;

  // Sequential (not Promise.all): pipelining concurrent queries onto the
  // Supabase transaction pooler hangs. Each is ~1s, so this is cheap.
  const keywords = await getKeywords();
  const sources = await getSources(true);
  const chatIds = await getActiveChatIds();
  mark("config");

  // Notify every active /start user, plus the default chat id if configured.
  const recipients = new Set<number | string>(chatIds);
  if (env.telegramChatId) recipients.add(env.telegramChatId);
  result.recipients = recipients.size;

  // Don't hard-require keywords or sources: providers that filter server-side
  // and pre-tag their results (kwork → category 37, freelancer → skill ids)
  // produce matches without either. RSS providers that DO need sources simply
  // return [] when they have none. Only a complete lack of enabled providers
  // means there's nothing to do.
  if (enabledProviders().length === 0) {
    result.reason = "no providers enabled";
    return result;
  }

  // 2. Fetch from providers in parallel; each provider isolates its own errors
  // and is hard-capped by PROVIDER_TIMEOUT_MS so a hanging feed can never eat
  // the whole function budget (which previously caused a 504 gateway timeout).
  const ctx = { keywords, sources };
  const fetched: Job[] = [];
  await Promise.all(
    enabledProviders().map(async (p) => {
      const pStart = Date.now();
      try {
        const jobs = await withTimeout(
          p.fetchJobs(ctx),
          PROVIDER_TIMEOUT_MS,
          `provider ${p.key}`,
        );
        fetched.push(...jobs);
      } catch (err) {
        const msg = `provider ${p.key} failed: ${String(err)}`;
        console.error("[monitor]", msg);
        result.errors.push(msg);
      } finally {
        result.timings[`fetch:${p.key}`] = Date.now() - pStart;
      }
    }),
  );
  result.fetched = fetched.length;
  mark("fetch");

  // 3. Keyword match + freshness window.
  //
  // Freshness: only consider jobs posted within MAX_JOB_AGE_HOURS (default 24h).
  // This drops stale postings, including old jobs that boards re-surface by
  // bumping (LaborX sort=newest mixes those in). A job with no parseable
  // postedAt is kept — age unknown, and dedup still prevents repeat sends.
  //
  // Matching: a provider may pre-tag a job as relevant (non-empty
  // matchedKeywords) when it already filtered server-side — e.g. Freelancer
  // filters by skill id, so its results are kept even if the free-text keyword
  // matcher finds nothing, and any text hits are merged in. Providers that
  // return an empty matchedKeywords (Upwork, RSS, LaborX) behave as before:
  // they're kept only when a keyword matches.
  const maxAgeMs = MAX_JOB_AGE_HOURS * 3_600_000;
  const withinWindow = (job: Job): boolean => {
    if (!job.postedAt) return true;
    const t = Date.parse(job.postedAt);
    return Number.isNaN(t) ? true : start - t <= maxAgeMs;
  };
  const matched: Job[] = [];
  for (const job of fetched) {
    if (!withinWindow(job)) continue;
    const provided = job.matchedKeywords ?? [];
    const hits = matchKeywords(job.title, job.description, keywords);
    const merged = provided.length
      ? [...new Set([...provided, ...hits])]
      : hits;
    if (merged.length > 0) matched.push({ ...job, matchedKeywords: merged });
  }
  result.matched = matched.length;
  mark("match");
  if (matched.length === 0) return result;

  // 4. Duplicate protection. Collapse in-batch dupes first, then check the DB.
  const byKey = new Map<string, Job>();
  for (const job of matched) {
    const key = jobKey(job);
    if (!byKey.has(key)) byKey.set(key, job);
  }
  const candidates = [...byKey.values()];
  const keys = candidates.map(jobKey);
  const urls = candidates.map((j) => normalizeUrl(j.url));
  const sent = await getAlreadySent(keys, urls);

  const fresh: Job[] = [];
  const seenUrls = new Set<string>();
  for (const job of candidates) {
    const key = jobKey(job);
    const nurl = normalizeUrl(job.url);
    if (sent.keys.has(key) || sent.urls.has(nurl) || seenUrls.has(nurl)) continue;
    seenUrls.add(nurl);
    fresh.push(job);
  }
  result.fresh = fresh.length;
  mark("dedup");
  if (fresh.length === 0) return result;

  // Send newest first. Unlimited by default (MAX_NOTIFICATIONS_PER_CHECK is
  // Infinity unless overridden), so slice() simply returns all fresh matches.
  fresh.sort((a, b) => {
    const ta = a.postedAt ? Date.parse(a.postedAt) : 0;
    const tb = b.postedAt ? Date.parse(b.postedAt) : 0;
    return tb - ta;
  });
  const toSend = fresh.slice(0, MAX_NOTIFICATIONS_PER_CHECK);

  // 5 + 6. Notify then persist. We mark as sent even if there are zero
  // recipients so the same job isn't re-queued forever.
  for (const job of toSend) {
    if (recipients.size > 0) {
      const ok = await broadcast([...recipients], formatJobMessage(job), {
        disablePreview: true,
      });
      if (ok > 0) result.notified++;
    }
    try {
      await markSent({
        jobKey: jobKey(job),
        normalizedUrl: normalizeUrl(job.url),
        platform: job.platform,
        title: job.title,
      });
    } catch (err) {
      result.errors.push(`markSent failed for ${jobKey(job)}: ${String(err)}`);
    }
  }

  mark("notify");
  if (fresh.length > toSend.length) {
    console.warn(
      `[monitor] capped notifications: ${fresh.length - toSend.length} fresh jobs deferred to next run`,
    );
  }
  return result;
}
