// ROLL BACK migration 0142 in PRODUCTION — only with explicit, separate approval. Prepared for review, never run by its author.
//   npx tsx scripts/incentive-0142/rollback.ts --check --expect-fingerprint=ed679a28f0
//       READ ONLY: 0142 recorded once and last; exactly as pinned; NO acknowledgment or negative-balance decision exists.
//   APPROVE_0142_ROLLBACK=<sha> npx tsx scripts/incentive-0142/rollback.ts --commit --expect-fingerprint=ed679a28f0 --expect-sha256-rollback=<sha>
//       ONE repeatable-read transaction: Category A's period, approval, payout and adjustment tables locked first; every
//       check again; the rollback SQL's own refusal still runs; data and catalogue compared before / after; none of 0142's
//       objects may remain; ledger −1. Any difference ROLLS BACK.
// Deploy the application WITHOUT the Category A acknowledgment / second-person code first if 0142 is rolled back (that
// code reports "needs database update 0142" without it, and Category A then holds every held item). Never prints the URL.
import { PINS, PRODUCTION, PRODUCTION_FINGERPRINT, preRollback, rollbackIn, verifyRolledBack } from "./core";
import { args, connect, execOf, fail, files, limits, run } from "./cli";

async function main() {
  const a = args();
  const mode = a.commit === true ? "commit" : a.check === true ? "check" : null;
  if (!mode) fail("choose --check (read only) or --commit");
  if (a["expect-fingerprint"] !== PRODUCTION_FINGERPRINT) fail(`--expect-fingerprint must be ${PRODUCTION_FINGERPRINT}`);
  if (mode === "commit" && (a["expect-sha256-rollback"] !== PINS.rollback || process.env.APPROVE_0142_ROLLBACK !== PINS.rollback)) fail("--expect-sha256-rollback and APPROVE_0142_ROLLBACK must both equal the pinned rollback sha256");
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
  console.log(`0142 rollback sha256 ${PINS.rollback} (pinned) · target fingerprint ${c.target.fingerprint} · mode ${mode}`);
  let stage = "start" as "start" | "body" | "committed";
  try {
    if (mode === "check") {
      await c.sql.begin("read only", async (tx) => {
        await limits(tx, "read");
        const pre = await preRollback(execOf(tx), PRODUCTION);
        console.log(`ROLLBACK CHECK OK (read only): ledger ${pre.ledger.length} · 0142 exactly as pinned · no data only 0142 allows`);
      });
      return;
    }
    await c.sql.begin("isolation level repeatable read", async (tx) => {
      await limits(tx, "write");
      const r = await rollbackIn(execOf(tx), f.rollback, PRODUCTION);
      console.log(`in-transaction checks OK: 0142 removed · data and catalogue unchanged · ${r.tables} tables`);
      stage = "body";
    });
    stage = "committed";
    console.log("COMMITTED");
    await c.sql.begin("read only", async (tx) => {
      await limits(tx, "read");
      const checks = await verifyRolledBack(execOf(tx), PRODUCTION);
      for (const k of checks) console.log(`${k.ok ? "OK  " : "FAIL"} ${k.check}`);
      if (checks.some((k) => !k.ok)) process.exitCode = 1;
    });
  } catch (e) {
    const m = (e as Error).message;
    if (stage === "committed") console.error(`THE ROLLBACK IS COMMITTED, but the read-only verification failed to run: ${m}`);
    else if (stage === "body") console.error(`OUTCOME UNKNOWN — the COMMIT itself failed (${m}). Do not retry: run rollback.ts --check and verify.ts.`);
    else console.error(`ABORTED (nothing committed): ${m}`);
    process.exitCode = 1;
  } finally {
    await c.sql.end();
  }
}
run(main);
