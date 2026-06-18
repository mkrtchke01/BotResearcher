import type { Job } from "@/providers/types";
import { escapeHtml, relativeTime, summarize } from "./format";

/**
 * Build the Telegram notification text for a matched job, in the required
 * format. Uses parse_mode=HTML; everything dynamic is HTML-escaped.
 *
 *   New job found: <Job Title>
 *
 *   Platform: Upwork
 *   About: <2–3 sentence summary>
 *   Budget: <budget or "Not specified">
 *   Matched keyword: <keywords>
 *   Posted: <relative time>
 *   Link: <url>
 */
export function formatJobMessage(job: Job): string {
  const title = escapeHtml(job.title.trim());
  const platform = escapeHtml(job.platform);
  const about = escapeHtml(summarize(job.description));
  const budget = escapeHtml(job.budget ?? "Not specified");
  const keywords = escapeHtml(
    job.matchedKeywords.length ? job.matchedKeywords.join(", ") : "—",
  );
  const posted = escapeHtml(relativeTime(job.postedAt));
  const url = escapeHtml(job.url);

  const lines = [
    `🆕 <b>New job found:</b> ${title}`,
    ``,
    `🌐 <b>Platform:</b> ${platform}`,
    `📝 <b>About:</b> ${about}`,
    `💰 <b>Budget:</b> ${budget}`,
    `🎯 <b>Matched keyword:</b> ${keywords}`,
    `🕒 <b>Posted:</b> ${posted}`,
    `🔗 <b>Link:</b> <a href="${url}">${url}</a>`,
  ];
  if (job.clientCountry) {
    lines.splice(5, 0, `📍 <b>Client:</b> ${escapeHtml(job.clientCountry)}`);
  }
  return lines.join("\n");
}
