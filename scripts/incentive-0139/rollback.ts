// ROLL BACK migration 0139 in PRODUCTION — only with explicit, separate approval. Prepared for review, never run by its author.
//   npx tsx scripts/incentive-0139/rollback.ts --check --expect-fingerprint=ed679a28f0
//       READ ONLY rollback verification: ledger 152 with 0139 last; 0139 exactly as pinned; NO data only 0139 allows
//       (an email / letterhead identity, or a write-off in the input history).
//   APPROVE_0139_ROLLBACK=<sha> npx tsx scripts/incentive-0139/rollback.ts --commit --expect-fingerprint=ed679a28f0 --expect-sha256-rollback=<sha>
//       ONE repeatable-read transaction: Category F's tables and the input history locked first; every check again; the
//       rollback SQL's own refusal still runs; data and catalogue compared before / after; the database must be EXACTLY
//       0138 again (0138's pinned listing, 0137's entity list); ledger 152 → 151. Any difference ROLLS BACK.
// Deploy the application WITHOUT the 0139 code first if 0139 is rolled back (that code needs 0139's columns; it reports
// Category F "not ready" without them). Never bypasses the rollback SQL's safeguards; never prints the URL.
import { PINS, PRODUCTION, PRODUCTION_FINGERPRINT, preRollback, rollbackIn, verifyRolledBack } from "./core";
import { args, connect, execOf, fail, files, limits, run } from "./cli";

async function main() {
  const a = args();
  const mode = a.commit === true ? "commit" : a.check === true ? "check" : null;
  if (!mode) fail("choose --check (read only) or --commit");
  if (a["expect-fingerprint"] !== PRODUCTION_FINGERPRINT) fail(`--expect-fingerprint must be ${PRODUCTION_FINGERPRINT}`);
  if (mode === "commit" && (a["expect-sha256-rollback"] !== PINS.rollback || process.env.APPROVE_0139_ROLLBACK !== PINS.rollback)) fail("--expect-sha256-rollback and APPROVE_0139_ROLLBACK must both equal the pinned rollback sha256");
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
  console.log(`0139 rollback sha256 ${PINS.rollback} (pinned) · target fingerprint ${c.target.fingerprint} · mode ${mode}`);
  let stage = "start" as "start" | "body" | "committed";
  try {
    if (mode === "check") {
      await c.sql.begin("read only", async (tx) => {
        await limits(tx, "read");
        const pre = await preRollback(execOf(tx), PRODUCTION, f.ref);
        console.log(`ROLLBACK CHECK OK (read only): ledger ${pre.ledger.length}, last ${pre.ledger.at(-1)} · 0139 exactly as pinned · no data only 0139 allows`);
      });
    } else {
      await c.sql.begin("isolation level repeatable read", async (tx) => {
        await limits(tx, "write");
        const r = await rollbackIn(execOf(tx), f.rollback, PRODUCTION, f.ref);
        console.log(`in-transaction checks OK: data unchanged · exactly 0138 again · ${r.tables} tables · ledger ${PRODUCTION.ledger!.after} → ${PRODUCTION.ledger!.before}`);
        stage = "body";
      });
      stage = "committed";
      console.log("COMMITTED (0139 rolled back)");
      await c.sql.begin("read only", async (tx) => {
        await limits(tx, "read");
        const checks = await verifyRolledBack(execOf(tx), PRODUCTION, f.ref);
        for (const k of checks) console.log(`${k.ok ? "OK  " : "FAIL"} ${k.check}`);
        if (checks.some((k) => !k.ok)) process.exitCode = 1;
      });
    }
  } catch (e) {
    const m = (e as Error).message;
    if (stage === "committed") console.error(`THE ROLLBACK IS COMMITTED, but the verification failed to run: ${m}`);
    else if (stage === "body") console.error(`OUTCOME UNKNOWN — the COMMIT itself failed (${m}). Do not retry: run --check and verify.ts.`);
    else console.error(`ABORTED (nothing committed): ${m}`);
    process.exitCode = 1;
  } finally {
    await c.sql.end();
  }
}
run(main);
