// READ-ONLY POST-MIGRATION VERIFIER for 0142 in PRODUCTION — prepared for review, never run by its author.
//   npx tsx scripts/incentive-0142/verify.ts --expect-fingerprint=ed679a28f0
// One `read only` transaction: 0142 recorded once; its objects exactly as pinned, with RLS and no REST access; every
// table with RLS; whether a rollback is still possible. Writes nothing; never prints the URL.
import { PRODUCTION, PRODUCTION_FINGERPRINT, verifyApplied } from "./core";
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
  console.log(`0142 verification · target fingerprint ${c.target.fingerprint} · READ ONLY`);
  try {
    await c.sql.begin("read only", async (tx) => {
      await limits(tx, "read");
      const checks = await verifyApplied(execOf(tx), PRODUCTION);
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
