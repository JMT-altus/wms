// READ-ONLY PREFLIGHT for migration 0139 in PRODUCTION — prepared for review, never run by its author.
//   npx tsx scripts/incentive-0139/preflight.ts --expect-fingerprint=ed679a28f0
// One `read only` transaction: production fingerprint; role; ledger 151 with 0138 last and nothing from 0139 on; 170
// tables all with RLS; the database EXACTLY at 0138 (0138's pinned listing, 0137's entity list) with none of 0139's
// objects; no email / letterhead verification (0139 would refuse it); row counts and timings. Writes nothing; never
// prints the URL.
import { PINS, PRODUCTION, PRODUCTION_FINGERPRINT, fFingerprints, preApply } from "./core";
import { catalogue, dataFingerprints } from "../incentive-0137/core";
import { args, connect, execOf, fail, files, limits, run } from "./cli";

async function main() {
  const a = args();
  if (a["expect-fingerprint"] !== PRODUCTION_FINGERPRINT) fail(`--expect-fingerprint must be ${PRODUCTION_FINGERPRINT}`);
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
  console.log(`0139 sha256 ${PINS.migration} (pinned) · target fingerprint ${c.target.fingerprint} · port ${c.target.port} · READ ONLY`);
  let bad = false;
  try {
    await c.sql.begin("read only", async (tx) => {
      await limits(tx, "read");
      const x = execOf(tx);
      const t0 = Date.now();
      const pre = await preApply(x, PRODUCTION, f.ref);
      const t1 = Date.now();
      const fps = await dataFingerprints(x);
      await fFingerprints(x);
      const t2 = Date.now();
      await catalogue(x);
      const t3 = Date.now();
      console.log(`PREFLIGHT OK: ledger ${pre.ledger.length}, last ${pre.ledger.at(-1)} · ${pre.tables.n} tables · exactly 0138 · 0139 absent · rows ${JSON.stringify(pre.rows)} · ${Object.keys(fps).length} tables fingerprinted`);
      console.log(`timings: checks ${t1 - t0} ms · fingerprints ${t2 - t1} ms · catalogue ${t3 - t2} ms (the commit runs fingerprints and catalogue twice, plus the migration, while holding its locks)`);
    });
  } catch (e) {
    bad = true;
    console.error(`PREFLIGHT FAILED: ${(e as Error).message}`);
  } finally {
    await c.sql.end();
  }
  process.exitCode = bad ? 1 : 0;
}
run(main);
