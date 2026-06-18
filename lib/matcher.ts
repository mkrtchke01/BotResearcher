import { stripHtml } from "./format";

/**
 * Keyword matching. Case-insensitive, whitespace-normalized. A keyword matches
 * when it appears as a token sequence in the job's title or description, with
 * word boundaries so "react" does not match "reactive". Multi-word keywords
 * like "landing page" or "ui/ux design" are matched as phrases.
 */

function buildPattern(keyword: string): RegExp {
  // Escape regex special chars, then treat runs of non-alphanumerics in the
  // keyword (spaces, "/", ".") as flexible separators.
  const escaped = keyword
    .trim()
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/[\s/_-]+/g, "[\\s/_-]+");
  // \b doesn't play well with leading/trailing non-word chars (e.g. ".js"),
  // so use lookarounds for alphanumeric boundaries.
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, "i");
}

const patternCache = new Map<string, RegExp>();

function patternFor(keyword: string): RegExp {
  let p = patternCache.get(keyword);
  if (!p) {
    p = buildPattern(keyword);
    patternCache.set(keyword, p);
  }
  return p;
}

/**
 * Return the subset of `keywords` that match the given title/description.
 * Empty result means the job is not relevant.
 */
export function matchKeywords(
  title: string,
  description: string,
  keywords: string[],
): string[] {
  const haystack = `${title} \n ${stripHtml(description)}`.toLowerCase();
  const matched: string[] = [];
  for (const kw of keywords) {
    if (patternFor(kw).test(haystack)) matched.push(kw);
  }
  return matched;
}
