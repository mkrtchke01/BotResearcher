/** Throwaway: probe candidate RSS feeds for reachability + keyword matches. */
import { fetchFeed } from "../lib/rss";
import { matchKeywords } from "../lib/matcher";

const KEYWORDS = [
  "landing page",
  "web application",
  "telegram bot",
  "telegram web app",
  "saas website",
  "ui/ux design",
  "web design",
  "react",
  "next.js",
  "frontend development",
];

const FEEDS = [
  "https://weworkremotely.com/categories/remote-front-end-programming-jobs.rss",
  "https://weworkremotely.com/categories/remote-design-jobs.rss",
  "https://remoteok.com/remote-dev-jobs.rss",
];

(async () => {
  for (const url of FEEDS) {
    try {
      const items = await fetchFeed(url);
      let matched = 0;
      for (const it of items) {
        if (matchKeywords(it.title, it.description, KEYWORDS).length > 0) matched++;
      }
      console.log(`OK  ${url}\n    items=${items.length} matched=${matched}`);
      const sample = items.find(
        (it) => matchKeywords(it.title, it.description, KEYWORDS).length > 0,
      );
      if (sample) {
        console.log(
          `    e.g. "${sample.title}" -> [${matchKeywords(sample.title, sample.description, KEYWORDS).join(", ")}]`,
        );
      }
    } catch (e) {
      console.log(`ERR ${url}\n    ${String(e)}`);
    }
  }
})();
