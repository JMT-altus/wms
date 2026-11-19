// READ ONLY verification of migration 0136 in PRODUCTION after a separately approved apply. Prepared, never run by its
// author. One `read only` transaction; writes nothing; never prints the connection URL.
//   npx tsx scripts/incentive-0136/verify.ts --expect-fingerprint=ed679a28f0 [--allow-data]
// --allow-data: once Category C is in use its three tables hold rows; without it they must be empty (straight after
// the apply).
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
      const checks = await verifyApplied(execOf(tx), PRODUCTION, f.ref, { requireEmpty: a["allow-data"] !== true });
      for (const k of checks) {
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
