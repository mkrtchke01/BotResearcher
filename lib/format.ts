/**
 * Formatting helpers: HTML escaping, relative time, text truncation,
 * URL normalization, and the short job summary used in notifications.
 */

/** Escape text for Telegram parse_mode=HTML. */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Strip HTML tags and collapse whitespace from RSS descriptions. */
export function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** "10 minutes ago", "3 hours ago", "just now". */
export function relativeTime(iso: string | null): string {
  if (!iso) return "unknown";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  const diffMs = Date.now() - then;
  if (diffMs < 0) return "just now";

  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

/**
 * Build a short 2–3 sentence "About" summary from a (possibly long, HTML)
 * description. No LLM required — we take the leading sentences up to a budget.
 */
export function summarize(description: string, maxChars = 280): string {
  const clean = stripHtml(description);
  if (!clean) return "No description provided.";

  // Split into sentences and accumulate up to ~3 sentences / maxChars.
  const sentences = clean.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [clean];
  let out = "";
  for (const s of sentences.slice(0, 3)) {
    const next = (out + " " + s.trim()).trim();
    if (next.length > maxChars) break;
    out = next;
  }
  if (!out) out = clean.slice(0, maxChars);
  if (out.length < clean.length) out = out.replace(/[.!?]*$/, "") + "…";
  return out;
}

/**
 * Normalize a URL for duplicate detection: lowercase host, drop trailing
 * slash, strip tracking query params and fragments. Falls back to the raw
 * trimmed string if the URL can't be parsed.
 */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw.trim());
    u.hash = "";
    const stripParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "ref",
      "source",
    ];
    for (const p of stripParams) u.searchParams.delete(p);
    let s = `${u.protocol}//${u.host.toLowerCase()}${u.pathname}`;
    const qs = u.searchParams.toString();
    if (qs) s += `?${qs}`;
    return s.replace(/\/$/, "");
  } catch {
    return raw.trim().toLowerCase().replace(/\/$/, "");
  }
}
