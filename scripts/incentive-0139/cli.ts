import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import postgres from "postgres";
import { FILES, PINS, assertProduction, pinned, reference, type Exec } from "./core";

/**
 * What the 0139 runners share: the pinned files (refused unless their canonical LF bytes are exactly the pinned ones —
 * 0139, its rollback, and 0138 / 0137 / 0136 for the reference state) and the production connection (refused unless it
 * is production's exact fingerprint on a Supabase host). The connection URL is never printed. Nothing here writes; each
 * runner decides what runs in which transaction. PREPARED FOR REVIEW — never run without a separate approval.
 */
const REPO = resolve(dirname(process.argv[1] ?? "."), "../..");

export function args(): Record<string, string | true> {
  return Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k!, v ?? true];
    }),
  );
}
export function files() {
  const migration = pinned(FILES.migration, readFileSync(resolve(REPO, "db/migrations", FILES.migration)), PINS.migration);
  const rollback = pinned(FILES.rollback, readFileSync(resolve(REPO, "db/rollback", FILES.rollback)), PINS.rollback);
  pinned(FILES.m0138, readFileSync(resolve(REPO, "db/migrations", FILES.m0138)), PINS.m0138);
  const m0137 = pinned(FILES.m0137, readFileSync(resolve(REPO, "db/migrations", FILES.m0137)), PINS.m0137);
  const m0136 = pinned(FILES.m0136, readFileSync(resolve(REPO, "db/migrations", FILES.m0136)), PINS.m0136);
  return { migration, rollback, ref: reference(m0136, m0137) };
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
/** Lock 5 s, statement 120 s; a writing transaction 90 s in all, a read-only one 180 s (Postgres 17 transaction_timeout). */
export async function limits(tx: postgres.TransactionSql, kind: "write" | "read") {
  await tx.unsafe(`SET LOCAL lock_timeout = '5s'; SET LOCAL statement_timeout = '120s'; SET LOCAL transaction_timeout = '${kind === "write" ? "90s" : "180s"}'`);
}
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
