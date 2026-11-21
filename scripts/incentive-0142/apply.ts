// APPLY migration 0142 to PRODUCTION — only with explicit, separate approval, after 0138–0141 are applied or discarded
// (their runners refuse unless they are next). Prepared for review, never run by its author.
//   1. npx tsx scripts/incentive-0142/preflight.ts --expect-fingerprint=ed679a28f0          (read only)
//   2. APPROVE_0142=<sha> npx tsx scripts/incentive-0142/apply.ts --commit --expect-fingerprint=ed679a28f0 --expect-sha256-0142=<sha>
//      ONE repeatable-read transaction (lock 5 s, statement 120 s, transaction 90 s): core.applyIn — Category A's period,
//      approval, payout and adjustment tables locked first; every precondition again; every table's data and the
//      catalogue outside 0142 fingerprinted before and compared after; 0142 exactly as pinned; its tables empty; ledger
//      +1. Any difference throws and ROLLS BACK. Then a separate READ ONLY verification.
//   3. npx tsx scripts/incentive-0142/verify.ts --expect-fingerprint=ed679a28f0              (read only)
// Never runs pnpm db:migrate. Never prints the connection URL.
import { PINS, PRODUCTION, PRODUCTION_FINGERPRINT, applyIn, verifyApplied } from "./core";
import { args, connect, execOf, fail, files, limits, run } from "./cli";

async function main() {
  const a = args();
  if (a.commit !== true) fail("this runner only commits; run preflight.ts first (read only), then --commit with the approvals");
  if (a["expect-fingerprint"] !== PRODUCTION_FINGERPRINT) fail(`--expect-fingerprint must be ${PRODUCTION_FINGERPRINT}`);
  if (a["expect-sha256-0142"] !== PINS.migration || process.env.APPROVE_0142 !== PINS.migration) fail("--expect-sha256-0142 and APPROVE_0142 must both equal the pinned migration sha256");
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
  console.log(`0142 sha256 ${PINS.migration} (pinned) · target fingerprint ${c.target.fingerprint} · port ${c.target.port} · COMMIT`);
  let stage = "start" as "start" | "body" | "committed";
  try {
    await c.sql.begin("isolation level repeatable read", async (tx) => {
      await limits(tx, "write");
      const r = await applyIn(execOf(tx), f.migration, PRODUCTION);
      console.log(`in-transaction checks OK: ${r.tablesFingerprinted} tables' data unchanged · catalogue outside 0142 unchanged · 0142 exactly as pinned · ${r.tables} tables`);
      stage = "body";
    });
    stage = "committed";
    console.log("COMMITTED");
    await c.sql.begin("read only", async (tx) => {
      await limits(tx, "read");
      const checks = await verifyApplied(execOf(tx), PRODUCTION);
      for (const k of checks) console.log(`${k.ok ? "OK  " : "FAIL"} ${k.check}`);
      if (checks.some((k) => !k.ok)) {
        console.error("POST-COMMIT VERIFICATION FAILED — 0142 is committed; investigate before anything else.");
        process.exitCode = 1;
      }
    });
  } catch (e) {
    const m = (e as Error).message;
    if (stage === "committed") console.error(`0142 IS COMMITTED, but the read-only verification failed to run: ${m} — run verify.ts and investigate.`);
    else if (stage === "body") console.error(`OUTCOME UNKNOWN — the COMMIT itself failed (${m}). Do not retry: run preflight.ts (refuses if 0142 is present) and verify.ts.`);
    else console.error(`ABORTED (nothing committed): ${m}`);
    process.exitCode = 1;
  } finally {
    await c.sql.end();
  }
}
run(main);
