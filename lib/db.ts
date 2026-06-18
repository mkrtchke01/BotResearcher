import postgres from "postgres";
import { env } from "./env";

/**
 * Single shared Postgres client. On Vercel, serverless functions are reused
 * across invocations, so we cache the client on `globalThis` to avoid opening
 * a new connection pool on every request (which would exhaust DB connections).
 *
 * Works with any Postgres-compatible DATABASE_URL (Supabase pooler / Neon).
 * Keep the pool small because serverless concurrency multiplies connections.
 */
const globalForDb = globalThis as unknown as {
  __sql?: ReturnType<typeof postgres>;
};

export const sql =
  globalForDb.__sql ??
  postgres(env.databaseUrl, {
    // Several small connections rather than one. postgres.js pipelines
    // concurrent queries onto a single connection, which HANGS against
    // Supabase's pgBouncer transaction pooler. Giving concurrent queries
    // separate connections avoids the pipelining stall.
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false, // required for transaction-pooling (Supabase pgBouncer)
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__sql = sql;
}
