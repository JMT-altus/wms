// Roll back migration 0137 in PRODUCTION — only with explicit, separate approval. Prepared, never run by its author.
//   npx tsx scripts/incentive-0137/rollback.ts --check --expect-fingerprint=ed679a28f0
//       READ ONLY: 0137 present exactly as pinned and EMPTY, no data only 0137 allows, ledger 150 with 0137 last (timed).
//   APPROVE_0137_ROLLBACK=<sha> npx tsx scripts/incentive-0137/rollback.ts --commit --expect-fingerprint=ed679a28f0 --expect-sha256-rollback=<sha>
//       ONE repeatable-read transaction (lock 5 s, statement 120 s, transaction 90 s): core.rollbackIn — the four new
//       tables, the settings, versions, input history, adjustments and testimonials locked against writes FIRST (so nothing can be written after
//       the checks and lost by the DROP), then every check; the rollback SQL's own refusal still runs; existing data and
//       catalogue compared before / after; 0136 restored exactly; ledger 150 → 149, 170 → 166 tables; testimonials back to NOT NULL + ON DELETE CASCADE (refused while any testimonial lost its employee). Any difference
//       throws and ROLLS BACK. Then a separate READ ONLY verification.
// Never bypasses the rollback SQL's safeguards. Never prints the connection URL.
import { PINS, PRODUCTION, PRODUCTION_FINGERPRINT, catalogue, dataFingerprints, preRollback, rollbackIn, verifyRolledBack } from "./core";
import { args, connect, execOf, fail, files, limits, run } from "./cli";

async function main() {
  const a = args();
  const mode = a.commit === true ? "commit" : a.check === true ? "check" : null;
  if (!mode) fail("choose --check or --commit");
  if (a["expect-fingerprint"] !== PRODUCTION_FINGERPRINT) fail(`--expect-fingerprint must be ${PRODUCTION_FINGERPRINT}`);
  if (mode === "commit" && (a["expect-sha256-rollback"] !== PINS.rollback || process.env.APPROVE_0137_ROLLBACK !== PINS.rollback)) fail("--expect-sha256-rollback and APPROVE_0137_ROLLBACK must both equal the pinned rollback sha256");
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
  console.log(`0137 rollback sha256 ${PINS.rollback} (pinned) · target fingerprint ${c.target.fingerprint} · port ${c.target.port} · mode ${mode}`);

  let stage = "start" as "start" | "body" | "committed"; // set inside the transaction callback (not narrowed)
  try {
    if (mode === "check") {
      await c.sql.begin("read only", async (tx) => {
        await limits(tx, "read");
        const x = execOf(tx);
        const t0 = Date.now();
        const pre = await preRollback(x, PRODUCTION, f.ref);
        const t1 = Date.now();
        const fps = await dataFingerprints(x);
        const t2 = Date.now();
        await catalogue(x);
        const t3 = Date.now();
        console.log(`CHECK OK (read only): ledger ${pre.ledger.length}, last ${pre.ledger.at(-1)} · 0137 exactly as pinned and empty · no 0137 data · ${Object.keys(fps).length} tables fingerprinted`);
        console.log(`timings: preconditions ${t1 - t0} ms · data fingerprints ${t2 - t1} ms · catalogue ${t3 - t2} ms`);
      });
    } else {
      await c.sql.begin("isolation level repeatable read", async (tx) => {
        await limits(tx, "write");
        const r = await rollbackIn(execOf(tx), f.rollback, PRODUCTION, f.ref);
        console.log(`in-transaction checks OK: ${r.tablesFingerprinted} tables' data unchanged · catalogue unchanged outside 0137 · 0136 restored exactly · ${r.tables} tables · ledger ${PRODUCTION.ledger!.after} → ${PRODUCTION.ledger!.before}`);
        stage = "body";
      });
      stage = "committed";
      console.log("COMMITTED (0137 rolled back)");
      await c.sql.begin("read only", async (tx) => {
        await limits(tx, "read");
        const checks = await verifyRolledBack(execOf(tx), PRODUCTION, f.ref);
        for (const k of checks) console.log(`${k.ok ? "OK  " : "FAIL"} ${k.check}`);
        if (checks.some((k) => !k.ok)) {
          console.error("POST-COMMIT VERIFICATION FAILED — the rollback is committed; investigate before anything else.");
          process.exitCode = 1;
        }
      });
    }
  } catch (e) {
    const m = (e as Error).message;
    if (stage === "committed") console.error(`THE ROLLBACK IS COMMITTED, but the read-only verification failed to run: ${m} — investigate.`);
    else if (stage === "body") console.error(`OUTCOME UNKNOWN — the COMMIT itself failed (${m}). Do not retry: run --check here and apply.ts --check to see which state the database is in.`);
    else console.error(`ABORTED (nothing committed in this transaction): ${m}`);
    process.exitCode = 1;
  } finally {
    await c.sql.end();
  }
}
run(main);
