// READ-ONLY POST-MIGRATION VERIFIER for 0139 in PRODUCTION — prepared for review, never run by its author.
//   npx tsx scripts/incentive-0139/verify.ts --expect-fingerprint=ed679a28f0
// One `read only` transaction: ledger 152 with 0139 recorded once and last; Category F's columns, the identity check, the
// two unique indexes, the input-history entity list and security exactly as pinned; 0138's objects and 0137's other
// checks unchanged; 170 tables all with RLS; Category F's decisions and their history preserved; whether a rollback is
// still possible. Writes nothing; never prints the URL.
import { PRODUCTION, PRODUCTION_FINGERPRINT, verifyApplied } from "./core";
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
  console.log(`0139 verification · target fingerprint ${c.target.fingerprint} · READ ONLY`);
  try {
    await c.sql.begin("read only", async (tx) => {
      await limits(tx, "read");
      const checks = await verifyApplied(execOf(tx), PRODUCTION, f.ref);
      for (const k of checks) console.log(`${k.ok ? "OK  " : "FAIL"} ${k.check}`);
      if (checks.some((k) => !k.ok)) process.exitCode = 1;
    });
  } catch (e) {
    console.error(`VERIFICATION FAILED TO RUN: ${(e as Error).message}`);
    process.exitCode = 1;
  } finally {
    await c.sql.end();
  }
}
run(main);
