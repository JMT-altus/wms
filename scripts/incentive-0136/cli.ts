import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import postgres from "postgres";
import { FILES, PINS, assertProduction, pinned, reference, type Exec } from "./core";

/**
 * What the 0136 runners share: the pinned files (refused unless their bytes are exactly the pinned ones) and the
 * production connection (refused unless it is production's exact fingerprint on a Supabase host). The connection URL
 * is never printed. Nothing here writes; the runners decide what runs in which transaction.
 */
const REPO = resolve(dirname(process.argv[1] ?? "."), "../..");

export function args(): Record<string, string | true> {
  return Object.fromEntries(process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k!, v ?? true];
  }));
}
export function files() {
  const migration = pinned(FILES.migration, readFileSync(resolve(REPO, "db/migrations", FILES.migration)), PINS.migration);
  const rollback = pinned(FILES.rollback, readFileSync(resolve(REPO, "db/rollback", FILES.rollback)), PINS.rollback);
  const m0135 = pinned(FILES.m0135, readFileSync(resolve(REPO, "db/migrations", FILES.m0135)), PINS.m0135);
  return { migration, rollback, ref: reference(m0135, migration) };
}
export function connect() {
  const env = readFileSync(resolve(REPO, ".env.local"), "utf8");
  const url = (env.match(/^DATABASE_URL=(.*)$/m)?.[1] ?? "").trim().replace(/^["']|["']$/g, "");
  const target = assertProduction(url);
  const sql = postgres(url, { max: 1, prepare: false, idle_timeout: 5, onnotice: () => {} });
  return { sql, target };
}
/** One transaction (postgres.js) as an Exec. */
export const execOf = (tx: postgres.TransactionSql): Exec => ({
  query: async <T>(text: string, params: unknown[] = []) => (await tx.unsafe(text, params as never[])) as unknown as T[],
  exec: async (text: string) => {
    await tx.unsafe(text);
  },
});
/**
 * Every transaction's limits, set before its first query. Writing: a lock waited for at most 5 s, a statement at most
 * 120 s, the whole transaction at most 90 s (Postgres 17's transaction_timeout) — so the app is never held up for
 * long. Read-only: the same lock and statement limits, 180 s in all.
 */
export async function limits(tx: postgres.TransactionSql, kind: "write" | "read") {
  await tx.unsafe(`SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '120s'; SET LOCAL transaction_timeout = '${kind === "write" ? "90s" : "180s"}'`);
}
/** Runs main(); any late rejection (for example from closing the connection) is reported, never left unhandled. */
export function run(main: () => Promise<void>) {
  main().catch((e: unknown) => {
    console.error(`FAILED: ${(e as Error)?.message ?? String(e)}`);
    process.exitCode = 1;
  });
}
export function fail(message: string): never {
  console.error(`REFUSED: ${message}`);
  process.exit(1);
}
