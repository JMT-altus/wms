import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { env } from "@/lib/env";
import * as schema from "@/db/schema";
import { withSlowQueryLog } from "./slow-query";

// Cache the postgres client on globalThis so Next.js HMR doesn't leak
// connections on every save. In production this just runs once.
const globalForDb = globalThis as unknown as {
  __pg?: ReturnType<typeof postgres>;
};

const client =
  globalForDb.__pg ??
  postgres(env.DATABASE_URL, {
    // Required for Supabase's pgbouncer (transaction-mode pooler):
    // prepared statements are per-session and break under txn pooling.
    prepare: false,
    // Higher ceiling so the dashboard's query burst (header counts +
    // loadDashboardData's ~5 selects + My Day + status map ≈ 15-20
    // concurrent reads) runs in parallel instead of queuing 10-at-a-time
    // and piling up to 25s+ on a cold remote DB. Supabase pooled allows
    // ~200, so 18 is safe headroom.
    max: 18,
    // Keep connections warm for a minute so back-to-back navigations
    // reuse the TLS handshake. The previous 20s window meant any quiet
    // user paid a fresh handshake (~50-150ms remote) on their next click.
    idle_timeout: 60,
    max_lifetime: 60 * 30,
    connect_timeout: 10,
    // How long a pooled socket may sit silent before TCP starts probing the
    // far end.
    //
    // This is not a tuning knob, it is a hang fix. The remote pooler drops
    // connections without a FIN (a network blip, or the pooler reaping its
    // side). postgres-js hands the dead socket to the next query anyway,
    // that query waits for a reply that will never come, and nothing in the
    // driver bounds the wait: there is no read timeout in postgres-js 3.x,
    // only `connect_timeout`, which is already spent. The wait therefore
    // runs to the OS TCP retransmission limit — observed here as a single
    // page request sitting in `application-code` for 14 minutes before
    // finally surfacing `read ECONNRESET`, with the page stuck on its
    // loading skeleton the whole time.
    //
    // At 15s, the probes start early and the dead peer is detected in well
    // under a minute, so the query fails fast and the UI can say so. The
    // default of 60 was slow enough that a stalled request outlived the
    // user's patience by an order of magnitude.
    keep_alive: 15,
    // NOTE: no `connection: { statement_timeout }` here. Startup parameters
    // do not survive the transaction-mode pooler — setting it was verified to
    // leave the session on the pooler's own `statement_timeout = 2min`, so the
    // option was a comment that lied about what the connection did. The
    // server side is already bounded by that 2 minutes; the client side is
    // what `keep_alive` above is for, and that was the half with no bound.
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__pg = client;
}

// Phase 0.1 — opt-in slow-query logger. Enable in any environment by
// setting SLOW_QUERY_MS (e.g. "300"). Disabled by default so production
// stays quiet until we deliberately turn it on. NODE_ENV=development
// auto-enables at 300ms so local clicks immediately surface hotspots.
const slowEnvVar = process.env.SLOW_QUERY_MS;
const slowMs = slowEnvVar
  ? Number(slowEnvVar)
  : process.env.NODE_ENV === "development"
    ? 300
    : NaN;
const tracedClient = Number.isFinite(slowMs) ? withSlowQueryLog(client, slowMs) : client;

export const db = drizzle(tracedClient, { schema });
export * from "@/db/schema";
export type { Employee, NewEmployee, Task, NewTask } from "@/db/schema";
