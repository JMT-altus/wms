// READ-ONLY POST-MIGRATION VERIFIER for 0138 in PRODUCTION — prepared for review, never run by its author.
//   npx tsx scripts/incentive-0138/verify.ts --expect-fingerprint=ed679a28f0
// One `read only` transaction: ledger 151 with 0138 recorded once and last; Category F's columns, checks, index, insert
// rule and security exactly as pinned; 0137's other checks unchanged; 170 tables all with RLS; how many existing Google
// records it preserved; whether a rollback is still possible. Writes nothing; never prints the URL.
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
  let bad = 0;
  try {
    await c.sql.begin("read only", async (tx) => {
      await limits(tx, "read");
      const [ro] = await tx.unsafe(`select current_setting('transaction_read_only') v, now()::text ts`);
      console.log(`read-only=${ro?.v} at ${ro?.ts} · fingerprint ${c.target.fingerprint}`);
      for (const k of await verifyApplied(execOf(tx), PRODUCTION, f.ref)) {
        if (!k.ok) bad++;
        console.log(`${k.ok ? "OK  " : "FAIL"} ${k.check}`);
      }
    });
  } catch (e) {
    bad++;
    console.error(`FAILED: ${(e as Error).message}`);
  } finally {
    await c.sql.end();
  }
  console.log(bad ? `${bad} CHECK(S) FAILED` : "ALL CHECKS OK");
  process.exitCode = bad ? 1 : 0;
}
run(main);
