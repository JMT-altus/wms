// APPLY migration 0139 to PRODUCTION — only with explicit, separate approval, AFTER 0138. Prepared for review, never run by
// its author.
//   1. npx tsx scripts/incentive-0139/preflight.ts --expect-fingerprint=ed679a28f0          (read only)
//   2. APPROVE_0139=<sha> npx tsx scripts/incentive-0139/apply.ts --commit --expect-fingerprint=ed679a28f0 --expect-sha256-0139=<sha>
//      ONE repeatable-read transaction (lock 5 s, statement 120 s, transaction 90 s): core.applyIn — Category F's tables,
//      the input history and the configuration tables locked against writes first; every precondition again; data
//      fingerprints (all tables; Category F without 0138's and 0139's columns), the catalogue outside Category F and
//      0137's other checks taken before and compared after; every 0139 object checked against the pinned listing; no row
//      holds anything new; ledger 151 → 152; any difference throws and ROLLS BACK. Then a separate READ ONLY verification.
//   3. npx tsx scripts/incentive-0139/verify.ts --expect-fingerprint=ed679a28f0              (read only)
// Never runs pnpm db:migrate. Never prints the connection URL.
import { PINS, PRODUCTION, PRODUCTION_FINGERPRINT, applyIn, verifyApplied } from "./core";
import { args, connect, execOf, fail, files, limits, run } from "./cli";

async function main() {
  const a = args();
  if (a.commit !== true) fail("this runner only commits; run preflight.ts first (read only), then --commit with the approvals");
  if (a["expect-fingerprint"] !== PRODUCTION_FINGERPRINT) fail(`--expect-fingerprint must be ${PRODUCTION_FINGERPRINT}`);
  if (a["expect-sha256-0139"] !== PINS.migration || process.env.APPROVE_0139 !== PINS.migration) fail("--expect-sha256-0139 and APPROVE_0139 must both equal the pinned migration sha256");
  let f: ReturnType<typeof files>;
  try {
    f = files();
  } catch (e) {
    fail((e as Error).message);
  }
  let c: ReturnType<typeof connect>;
  try {
    c = connect();
  } catch (e) {
    fail((e as Error).message);
  }
  console.log(`0139 sha256 ${PINS.migration} (pinned) · target fingerprint ${c.target.fingerprint} · port ${c.target.port} · COMMIT`);
  let stage = "start" as "start" | "body" | "committed";
  try {
    await c.sql.begin("isolation level repeatable read", async (tx) => {
      await limits(tx, "write");
      const r = await applyIn(execOf(tx), f.migration, PRODUCTION, f.ref);
      console.log(`in-transaction checks OK: ${r.tablesFingerprinted} tables' data unchanged · Category F rows unchanged (${JSON.stringify(r.rows)}) · catalogue outside Category F unchanged · 0139 exactly as pinned · ${r.tables} tables · ledger ${PRODUCTION.ledger!.before} → ${PRODUCTION.ledger!.after}`);
      stage = "body";
    });
    stage = "committed";
    console.log("COMMITTED");
    await c.sql.begin("read only", async (tx) => {
      await limits(tx, "read");
      const checks = await verifyApplied(execOf(tx), PRODUCTION, f.ref);
      for (const k of checks) console.log(`${k.ok ? "OK  " : "FAIL"} ${k.check}`);
      if (checks.some((k) => !k.ok)) {
        console.error("POST-COMMIT VERIFICATION FAILED — 0139 is committed; investigate before anything else.");
        process.exitCode = 1;
      }
    });
  } catch (e) {
    const m = (e as Error).message;
    if (stage === "committed") console.error(`0139 IS COMMITTED, but the read-only verification failed to run: ${m} — run verify.ts and investigate.`);
    else if (stage === "body") console.error(`OUTCOME UNKNOWN — the COMMIT itself failed (${m}). Do not retry: run preflight.ts (refuses if 0139 is present) and verify.ts.`);
    else console.error(`ABORTED (nothing committed): ${m}`);
    process.exitCode = 1;
  } finally {
    await c.sql.end();
  }
}
run(main);
