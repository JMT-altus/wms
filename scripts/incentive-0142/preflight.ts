// READ-ONLY PREFLIGHT for migration 0142 in PRODUCTION — prepared for review, never run by its author.
//   npx tsx scripts/incentive-0142/preflight.ts --expect-fingerprint=ed679a28f0
// One `read only` transaction: production fingerprint; role; 0131–0133 in the ledger and nothing from 0142 on; every
// table with RLS; none of 0142's objects; the tables and guards it extends present; timings of the fingerprints. Writes
// nothing; never prints the URL.
import { PINS, PRODUCTION, PRODUCTION_FINGERPRINT, catalogue, dataFingerprints, preApply } from "./core";
import { args, connect, execOf, fail, files, limits, run } from "./cli";

async function main() {
  const a = args();
  if (a["expect-fingerprint"] !== PRODUCTION_FINGERPRINT) fail(`--expect-fingerprint must be ${PRODUCTION_FINGERPRINT}`);
  try {
    files();
  } catch (e) {
    fail((e as Error).message);
  }
  let c: ReturnType<typeof connect>;
  try {
    c = connect();
  } catch (e) {
    fail((e as Error).message);
  }
  console.log(`0142 sha256 ${PINS.migration} (pinned) · target fingerprint ${c.target.fingerprint} · port ${c.target.port} · READ ONLY`);
  try {
    await c.sql.begin("read only", async (tx) => {
      await limits(tx, "read");
      const x = execOf(tx);
      const t0 = Date.now();
      const pre = await preApply(x, PRODUCTION);
      const t1 = Date.now();
      const fps = await dataFingerprints(x);
      const t2 = Date.now();
      await catalogue(x);
      const t3 = Date.now();
      console.log(`PREFLIGHT OK: ledger ${pre.ledger.length}, last ${pre.ledger.at(-1)} · ${pre.tables.n} tables · 0142 absent · ${Object.keys(fps).length} tables fingerprinted`);
      console.log(`timings: checks ${t1 - t0} ms · fingerprints ${t2 - t1} ms · catalogue ${t3 - t2} ms`);
    });
  } catch (e) {
    console.error(`PREFLIGHT FAILED: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await c.sql.end();
  }
}
run(main);
