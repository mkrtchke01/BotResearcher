/**
 * Minimal status landing page. No secrets are read here — it's a static
 * marker that the deployment is live. Operate the bot through Telegram.
 */
export default function HomePage() {
  return (
    <main style={{ maxWidth: 640, margin: "0 auto", padding: "64px 24px" }}>
      <h1 style={{ fontSize: 28, marginBottom: 8 }}>🤖 BotResearcher</h1>
      <p style={{ opacity: 0.8, lineHeight: 1.6 }}>
        Telegram bot that monitors freelance marketplaces (Upwork RSS, custom
        RSS feeds, and more) and notifies you about new relevant jobs.
      </p>
      <p style={{ opacity: 0.8, lineHeight: 1.6 }}>
        This page is just a liveness marker. Control the bot from Telegram:
      </p>
      <ul style={{ opacity: 0.8, lineHeight: 1.8 }}>
        <li><code>/start</code> — start monitoring</li>
        <li><code>/status</code> — show status</li>
        <li><code>/keywords</code>, <code>/sources</code> — manage filters</li>
      </ul>
      <p style={{ marginTop: 32, opacity: 0.5, fontSize: 13 }}>
        Endpoints: <code>/api/telegram/webhook</code> ·{" "}
        <code>/api/cron/check-jobs</code>
      </p>
    </main>
  );
}
