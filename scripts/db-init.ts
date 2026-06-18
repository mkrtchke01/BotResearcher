/**
 * One-shot schema initializer. Reads db/schema.sql and executes it against
 * DATABASE_URL. Idempotent — safe to re-run.
 *
 *   npm run db:init        (loads .env.local automatically via --env-file)
 *
 * Requires Node 20.6+ for the built-in --env-file flag used in package.json,
 * or set DATABASE_URL in your shell.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env.local if present (Node 20.6+). Ignore if missing.
try {
  (process as NodeJS.Process & { loadEnvFile?: (p?: string) => void }).loadEnvFile?.(
    ".env.local",
  );
} catch {
  /* rely on shell environment */
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set. Add it to .env.local or your shell.");
    process.exit(1);
  }
  const schema = readFileSync(join(__dirname, "..", "db", "schema.sql"), "utf8");
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    await sql.unsafe(schema);
    console.log("✅ Schema applied successfully.");
  } catch (err) {
    console.error("❌ Schema apply failed:", err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main();
