// Apply migration 0137 to PRODUCTION — only with explicit, separate approval. Prepared, never run by its author.
//   npx tsx scripts/incentive-0137/apply.ts --check --expect-fingerprint=ed679a28f0
//       READ ONLY: every precondition, data fingerprints and the catalogue (timed, so the commit's hold is known);
//       writes nothing.
//   APPROVE_0137=<sha> npx tsx scripts/incentive-0137/apply.ts --commit --expect-fingerprint=ed679a28f0 --expect-sha256-0137=<sha>
//       ONE repeatable-read transaction (lock 5 s, statement 120 s, transaction 90 s): core.applyIn — the settings,
//       versions, input-history, adjustments and testimonials tables locked against writes first, then every check; any difference throws and
//       ROLLS BACK. Then a separate READ ONLY verification.
// There is no local dry-run mode. Never prints the connection URL. Never runs pnpm db:migrate.
import { PINS, PRODUCTION, PRODUCTION_FINGERPRINT, applyIn, catalogue, dataFingerprints, preApply, verifyApplied } from "./core";
import { args, connect, execOf, fail, files, limits, run } from "./cli";

async function main() {
  const a = args();
  const mode = a.commit === true ? "commit" : a.check === true ? "check" : null;
  if (!mode) fail("choose --check or --commit");
  if (a["expect-fingerprint"] !== PRODUCTION_FINGERPRINT) fail(`--expect-fingerprint must be ${PRODUCTION_FINGERPRINT}`);
  if (mode === "commit" && (a["expect-sha256-0137"] !== PINS.migration || process.env.APPROVE_0137 !== PINS.migration)) fail("--expect-sha256-0137 and APPROVE_0137 must both equal the pinned migration sha256");
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
  console.log(`0137 sha256 ${PINS.migration} (pinned) · target fingerprint ${c.target.fingerprint} · port ${c.target.port} · mode ${mode}`);

  /** "body" — the transaction's work finished (a failure after it is the COMMIT itself); "committed" — COMMIT returned. */
  let stage = "start" as "start" | "body" | "committed"; // set inside the transaction callback (not narrowed)
  try {
    if (mode === "check") {
      await c.sql.begin("read only", async (tx) => {
        await limits(tx, "read");
        const x = execOf(tx);
        const t0 = Date.now();
        const pre = await preApply(x, PRODUCTION, f.ref);
        const t1 = Date.now();
        const fps = await dataFingerprints(x);
        const t2 = Date.now();
        await catalogue(x);
        const t3 = Date.now();
        console.log(`CHECK OK (read only): ledger ${pre.ledger.length}, last ${pre.ledger.at(-1)} · ${pre.tables.n} tables · 0137 absent · 0136 exact · ${Object.keys(fps).length} tables fingerprinted`);
        console.log(`timings: preconditions ${t1 - t0} ms · data fingerprints ${t2 - t1} ms · catalogue ${t3 - t2} ms (the commit runs fingerprints and catalogue twice, plus the migration, while holding its locks)`);
      });
    } else {
      await c.sql.begin("isolation level repeatable read", async (tx) => {
        await limits(tx, "write");
        const r = await applyIn(execOf(tx), f.migration, PRODUCTION, f.ref);
        console.log(`in-transaction checks OK: ${r.tablesFingerprinted} tables' data unchanged · catalogue unchanged outside 0137 · 0137 exactly as pinned · ${r.keys} settings keys · ${r.tables} tables · ledger ${PRODUCTION.ledger!.before} → ${PRODUCTION.ledger!.after}`);
        stage = "body";
      });
      stage = "committed";
      console.log("COMMITTED");
      await c.sql.begin("read only", async (tx) => {
        await limits(tx, "read");
        // Not requiring the tables empty: the app may write the moment 0137 exists.
        const checks = await verifyApplied(execOf(tx), PRODUCTION, f.ref, { requireEmpty: false });
        for (const k of checks) console.log(`${k.ok ? "OK  " : "FAIL"} ${k.check}`);
        if (checks.some((k) => !k.ok)) {
          console.error("POST-COMMIT VERIFICATION FAILED — 0137 is committed; investigate before anything else.");
          process.exitCode = 1;
        }
      });
    }
  } catch (e) {
    const m = (e as Error).message;
    if (stage === "committed") console.error(`0137 IS COMMITTED, but the read-only verification failed to run: ${m} — run verify.ts and investigate.`);
    else if (stage === "body") console.error(`OUTCOME UNKNOWN — the COMMIT itself failed (${m}). Do not retry: run --check (refuses if 0137 is present) and verify.ts to see which state the database is in.`);
    else console.error(`ABORTED (nothing committed in this transaction): ${m}`);
    process.exitCode = 1;
  } finally {
    await c.sql.end();
  }
}
run(main);
