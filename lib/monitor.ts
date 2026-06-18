import { enabledProviders } from "@/providers";
import type { Job } from "@/providers/types";
import { matchKeywords } from "./matcher";
import { normalizeUrl } from "./format";
import { formatJobMessage } from "./notify";
import { broadcast } from "./telegram";
import { env, MAX_NOTIFICATIONS_PER_CHECK } from "./env";
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
}

function jobKey(job: Job): string {
  return `${job.platform}:${job.id}`;
}

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
  };

  if (!(await getMonitoring())) {
    result.reason = "monitoring is off";
    return result;
  }
  result.ran = true;

  const [keywords, sources, chatIds] = await Promise.all([
    getKeywords(),
    getSources(true),
    getActiveChatIds(),
  ]);

  // Notify every active /start user, plus the default chat id if configured.
  const recipients = new Set<number | string>(chatIds);
  if (env.telegramChatId) recipients.add(env.telegramChatId);
  result.recipients = recipients.size;

  if (keywords.length === 0) {
    result.reason = "no keywords configured";
    return result;
  }
  if (sources.length === 0) {
    result.reason = "no sources configured";
    return result;
  }

  // 2. Fetch from providers in parallel; each provider isolates its own errors.
  const ctx = { keywords, sources };
  const fetched: Job[] = [];
  await Promise.all(
    enabledProviders().map(async (p) => {
      try {
        const jobs = await p.fetchJobs(ctx);
        fetched.push(...jobs);
      } catch (err) {
        const msg = `provider ${p.key} failed: ${String(err)}`;
        console.error("[monitor]", msg);
        result.errors.push(msg);
      }
    }),
  );
  result.fetched = fetched.length;

  // 3. Keyword match.
  const matched: Job[] = [];
  for (const job of fetched) {
    const hits = matchKeywords(job.title, job.description, keywords);
    if (hits.length > 0) matched.push({ ...job, matchedKeywords: hits });
  }
  result.matched = matched.length;
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
  if (fresh.length === 0) return result;

  // Send newest first, capped to avoid a flood on the very first run.
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

  if (fresh.length > toSend.length) {
    console.warn(
      `[monitor] capped notifications: ${fresh.length - toSend.length} fresh jobs deferred to next run`,
    );
  }
  return result;
}
