// One-time clean-up: move companies the Collection Tracker shows with no balance (— / — or ₹0 / ₹0) into
// Collection Logs. See lib/collections/balances/logs-backfill.ts for exactly what counts and what is written.
//
// DRY RUN (default, read-only transaction — prints counts only, writes nothing):
//   pnpm tsx --env-file=.env.local scripts/backfill-collection-logs.ts
//
// APPLY (one transaction; needs explicit approval, the target's fingerprint from the dry run, and the buckets):
//   WMS_APPROVED_LOGS_BACKFILL=yes pnpm tsx --env-file=.env.local scripts/backfill-collection-logs.ts \
//     --commit --expect-fingerprint=<10 hex> --include=zero-line,absent-from-latest,never-uploaded
//
// It also returns to the Tracker any company already in Logs whose latest upload gives it a non-zero balance.
// Nothing is deleted. Re-running moves nobody twice. Companies later given a balance by a confirmed upload
// return to the Tracker automatically.
import { createHash } from "node:crypto";
import postgres from "postgres";
import { BACKFILL_BUCKETS, applyBackfill, applyRestore, countBackfill, type BackfillBucket, type Exec } from "../lib/collections/balances/logs-backfill";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL not set");
const u = new URL(url);
const fingerprint = createHash("sha256").update(`${decodeURIComponent(u.username)}@${u.hostname}:${u.port}${u.pathname}`).digest("hex").slice(0, 10);

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
const commit = args.includes("--commit");
const include = (flag("include") ?? "").split(",").filter(Boolean) as BackfillBucket[];

const sql = postgres(url, { max: 1, prepare: false, idle_timeout: 5 });

/**
 * Everything the clean-up must NOT change: every company's identity, name, coordinator and payment terms
 * (as one hash), and the row counts of its history tables. Compared before and after inside the transaction.
 */
async function integrity(exec: Exec): Promise<Record<string, string | number>> {
  const [m] = await exec(
    `select count(*)::int as n, md5(coalesce(string_agg(id::text || '|' || company_name || '|' || coalesce(coordinator_label, '') || '|' || coalesce(payment_terms, ''), ',' order by id), '')) as h from collection_master_companies`,
  );
  const out: Record<string, string | number> = { companies: Number(m!.n), companiesHash: String(m!.h) };
  for (const t of ["collection_followups", "collection_commitments", "collection_amount_confirmations", "collection_confirmed_amounts", "collection_escalations", "collection_balance_snapshots", "collection_balance_lines"]) {
    const [r] = await exec(`select case when to_regclass('public.${t}') is null then -1 else (select count(*) from ${t}) end::int as n`).catch(() => [{ n: -2 }]);
    out[t] = Number(r!.n);
  }
  return out;
}

async function main() {
  console.log(`target fingerprint: ${fingerprint}`);
  if (!commit) {
    await sql.begin("isolation level repeatable read read only", async (tx) => {
      const exec: Exec = (text, params) => tx.unsafe(text, (params ?? []) as never[]) as unknown as Promise<Record<string, unknown>[]>;
      const c = await countBackfill(exec);
      console.log(JSON.stringify({ ...c, integrity: await integrity(exec) }, null, 2));
    });
    console.log("DRY RUN — nothing was written.");
    return;
  }
  if (process.env.WMS_APPROVED_LOGS_BACKFILL !== "yes") throw new Error("Refused: set WMS_APPROVED_LOGS_BACKFILL=yes only after approval.");
  if (flag("expect-fingerprint") !== fingerprint) throw new Error("Refused: --expect-fingerprint does not match this target.");
  if (include.length === 0 || include.some((b) => !(BACKFILL_BUCKETS as readonly string[]).includes(b))) {
    throw new Error(`Refused: pass --include= with one or more of ${BACKFILL_BUCKETS.join(", ")}.`);
  }
  await sql.begin(async (tx) => {
    // The same lock a balance upload takes, so an upload can't land half-way through.
    await tx`select pg_advisory_xact_lock(hashtext('collection_balance_snapshots'))`;
    const exec: Exec = (text, params) => tx.unsafe(text, (params ?? []) as never[]) as unknown as Promise<Record<string, unknown>[]>;
    const kept = await integrity(exec);
    const before = await countBackfill(exec);
    // First return logged companies that now have a balance, then move the no-balance ones in.
    const restored = await applyRestore(exec);
    const moved = await applyBackfill(exec, include);
    const after = await countBackfill(exec);
    const expected = include.reduce((t, b) => t + before.byBucket[b], 0);
    const problems = [
      restored !== before.toRestore && `restored ${restored}, expected ${before.toRestore}`,
      moved !== expected && `moved ${moved}, expected ${expected}`,
      after.toRestore !== 0 && `${after.toRestore} logged companies still have a balance`,
      include.some((b) => after.byBucket[b] !== 0) && "some chosen companies are still in the Tracker",
      after.alreadyInLogs !== before.alreadyInLogs - restored + moved && "the Logs count doesn't add up",
      after.companies !== before.companies && "the number of companies changed",
      JSON.stringify(await integrity(exec)) !== JSON.stringify(kept) && "company records or their history changed",
    ].filter(Boolean);
    if (problems.length > 0) throw new Error(`Verification failed (${problems.join("; ")}); rolled back.`);
    console.log(JSON.stringify({ restored, moved, before, after, integrityUnchanged: kept }, null, 2));
  });
  console.log("COMMITTED.");
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error("FAILED:", e instanceof Error ? e.message : e);
    await sql.end();
    process.exit(1);
  });
