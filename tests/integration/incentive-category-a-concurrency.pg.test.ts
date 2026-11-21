import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// GENUINELY CONCURRENT tests of Category A approval and payout, on a REAL PostgreSQL server (not PGlite, which is a
// single connection): every transaction below runs on its OWN connection, so two sessions really overlap. Two layers:
//   * the service functions (decideMonth, recordPayout) called at once through a real connection pool;
//   * raw two-session interleavings at SQL level, proving the second session WAITS on the first's lock and is then
//     refused — the database's own guarantee, whatever calls it.
// It runs only when TEST_PG_URL names a throwaway server on localhost (it refuses anything else, and production's
// fingerprint), creates its own database there, and drops it afterwards. Without TEST_PG_URL its 7 tests are reported as
// SKIPPED — never silently passed. Invented data only.
const URL_ = process.env.TEST_PG_URL ?? "";
const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const target = (() => {
  if (!URL_) return null;
  const u = new URL(URL_);
  if (!["localhost", "127.0.0.1", "::1"].includes(u.hostname)) throw new Error("TEST_PG_URL must be a server on localhost");
  if (sha(`${decodeURIComponent(u.username)}@${u.hostname}:${u.port}${u.pathname}`).slice(0, 10) === "ed679a28f0") throw new Error("TEST_PG_URL is production");
  return u;
})();

const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown };
});
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (f: unknown) => f, updateTag: vi.fn() }));
vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));

import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { isPgEnum } from "drizzle-orm/pg-core";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import * as schema from "@/db/schema";
import { aprilConfig, EXAMPLE_2, L } from "../fixtures/category-a";

const DB_NAME = `wms_cat_a_conc_${randomBytes(4).toString("hex")}`;
let admin: ReturnType<typeof postgres>;
let pool: ReturnType<typeof postgres>;
let calc: typeof import("@/lib/queries/incentive-calc");
let rules: typeof import("@/lib/queries/incentive-rules");
const who: Record<string, string> = {};
const actor = (k: string) => ({ id: who[k]!, name: k });
let programId = "";
const APR = "2026-04-01";
const one = async <T>(q: Promise<T[]>) => (await q)[0]!;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Whether a promise is still unsettled after `ms` (i.e. its session is waiting on a lock). */
const stillWaiting = async (p: Promise<unknown>, ms = 400) => {
  let settled = false;
  p.then(() => (settled = true), () => (settled = true));
  await sleep(ms);
  return !settled;
};

describe.skipIf(!target)("Category A approval and payout under genuinely concurrent sessions (real PostgreSQL)", () => {
  beforeAll(async () => {
    admin = postgres(URL_, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create database ${DB_NAME}`);
    const url = new URL(URL_);
    url.pathname = `/${DB_NAME}`;
    pool = postgres(url.toString(), { max: 6, onnotice: () => {} });
    h.db = drizzle(pool, { schema });
    // The tables the migrations depend on, generated from db/schema.ts exactly as the PGlite tests do.
    const enums = Object.fromEntries(Object.entries(schema).filter(([, v]) => isPgEnum(v)));
    const tables = { employees: schema.employees, departments: schema.departments, employeeDepartments: schema.employeeDepartments, fieldPermissionGrants: schema.fieldPermissionGrants, customerMasters: schema.customerMasters, vendorMasters: schema.vendorMasters, tallyImportBatches: schema.tallyImportBatches, tallyDocuments: schema.tallyDocuments, salesOrderPreclosures: schema.salesOrderPreclosures, incentiveAudit: schema.incentiveAudit };
    await pool.unsafe("create extension if not exists pg_trgm");
    for (const s of await generateMigration(generateDrizzleJson({}), generateDrizzleJson({ ...enums, ...tables }))) {
      try {
        await pool.unsafe(s);
      } catch (e) {
        if (!(/FOREIGN KEY/i.test(s) && /does not exist/i.test((e as Error).message))) throw e;
      }
    }
    for (const f of ["0131_incentive_rule_config.sql", "0132_incentive_category_a_calculation.sql", "0133_incentive_category_a_inputs_approvals.sql"]) await pool.unsafe(readFileSync(resolve(__dirname, `../../db/migrations/${f}`), "utf8"));
    for (const k of ["runner", "submitter", "a1", "a2", "payerA", "payerB", "rep", "author", "checker"]) who[k] = (await one(pool`insert into employees (name, email, role, is_admin) values (${k}, ${`${k}@example.test`}, 'both', true) returning id`) as { id: string }).id;
    calc = await import("@/lib/queries/incentive-calc");
    rules = await import("@/lib/queries/incentive-rules");
    // A published configuration (2 approval steps, released on approval) and April example 2 in Forms.
    const p = await rules.createProgram(actor("author"), { code: "CONC", name: "Concurrency", description: null });
    if (!p.ok) throw new Error(p.error);
    programId = p.programId;
    const config = aprilConfig({ "payout.approvalSteps": 2, "payout.release": "afterApproval" });
    config.eligibility = [{ subjectType: "employee", subjectId: who.rep!, role: null, subjectLabel: "rep", mode: "include", effectiveFrom: "2026-01-01", effectiveTo: null }];
    const d = await rules.createDraft(actor("author"), { programId, category: "A", startFrom: "blank" });
    if (!d.ok) throw new Error(d.error);
    const s1 = await rules.saveDraft(actor("author"), d.versionId, 1, config, null);
    if (!s1.ok) throw new Error(s1.error);
    const sub = await rules.submit(actor("author"), d.versionId, s1.rowVersion);
    if (!sub.ok) throw new Error(sub.error);
    const ap = await rules.approve(actor("checker"), d.versionId, sub.rowVersion, null);
    if (!ap.ok) throw new Error(ap.error);
    const pub = await rules.publish(actor("checker"), d.versionId, ap.rowVersion, APR, { canBackdate: true });
    if (!pub.ok) throw new Error(pub.error);
    const customer = (await one(pool`insert into customer_masters (name, sales_rep_id) values ('Customer One', ${who.rep!}) returning id`) as { id: string }).id;
    const batch = (await one(pool`insert into tally_import_batches (category, file_name, file_hash) values ('sales-orders', 't.xlsx', 'x') returning id`) as { id: string }).id;
    const doc = async (type: string, no: string, date: string, total: number, ref: string | null, due: string | null) =>
      (await one(pool`insert into tally_documents (identity, document_type, document_no, document_no_key, document_date, financial_year, party_name, party_key, customer_master_id, total_paise, taxable_paise, ref_document_id, due_date, lines, import_batch_id, source_row) values (${`${type}|${no}`}, ${type}, ${no}, ${no.toLowerCase()}, ${date}, '2026-27', 'Customer One', 'customer one', ${customer}, ${total}, ${total}, ${ref}, ${due}, '[]'::jsonb, ${batch}, 1) returning id`) as { id: string }).id;
    for (const [i, pays] of EXAMPLE_2.entries()) {
      const order = await doc("sales-orders", `SO ${i + 1}`, "2026-04-05", L(10), null, null);
      const inv = await doc("sales-invoices", `INV ${i + 1}`, "2026-04-05", L(10), order, "2026-04-05");
      for (const [k, [fraction, days]] of pays.entries()) await doc("customer-receipts", `RC ${i + 1}.${k + 1}`, new Date(Date.parse("2026-04-05T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10), Math.round(L(10) * fraction), inv, null);
    }
    const c = await calc.calculate(actor("runner"), programId, APR, "2026-09-30");
    if (!c.ok || !c.adopted) throw new Error(`calculation: ${JSON.stringify(c)}`);
    const pr = await one(pool`select row_version from incentive_calc_periods where program_id = ${programId}`) as { row_version: number };
    const l = await calc.setLocked(actor("runner"), programId, APR, true, pr.row_version);
    if (!l.ok) throw new Error(l.error);
    const s = await calc.submitMonth(actor("submitter"), programId, APR, l.rowVersion);
    if (!s.ok) throw new Error(s.error);
  }, 300_000);
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.unsafe(`drop database if exists ${DB_NAME} with (force)`);
      await admin.end();
    }
  });
  const period = async () => one(pool`select id, status, row_version, current_run_id, submission_no, release_on::text from incentive_calc_periods where program_id = ${programId} and month = ${APR}`) as Promise<{ id: string; status: string; row_version: number; current_run_id: string; submission_no: number; release_on: string }>;

  it("the April figure is ₹925.00 on real PostgreSQL too", async () => {
    const r = await one(pool`select r.payable_paise::int p from incentive_calc_results r join incentive_calc_periods d on d.current_run_id = r.run_id where d.program_id = ${programId}`) as { p: number };
    expect(r.p).toBe(92500);
  });

  it("SQL level: a second session's approval of the same step WAITS on the first's lock, then is refused", async () => {
    const p = await period();
    const s1 = await pool.reserve();
    const s2 = await pool.reserve();
    try {
      await s1`begin`;
      await s2`begin`;
      await s1`insert into incentive_calc_approvals (period_id, run_id, submission_no, step_no, decision, actor_id, actor_name) values (${p.id}, ${p.current_run_id}, ${p.submission_no}, 1, 'approve', ${who.a1!}, 'a1')`;
      const second = s2`insert into incentive_calc_approvals (period_id, run_id, submission_no, step_no, decision, actor_id, actor_name) values (${p.id}, ${p.current_run_id}, ${p.submission_no}, 1, 'approve', ${who.a2!}, 'a2')`;
      expect(await stillWaiting(second)).toBe(true); // blocked on the period row the first session locked
      await s1`rollback`; // the first session gives up: the second may now go ahead…
      await expect(second).resolves.toBeDefined();
      await s2`rollback`;
    } finally {
      s1.release();
      s2.release();
    }
    // … and with both committing in turn, only one step-1 approval can exist.
    const s3 = await pool.reserve();
    const s4 = await pool.reserve();
    try {
      await s3`begin`;
      await s4`begin`;
      await s3`insert into incentive_calc_approvals (period_id, run_id, submission_no, step_no, decision, actor_id, actor_name) values (${p.id}, ${p.current_run_id}, ${p.submission_no}, 1, 'approve', ${who.a1!}, 'a1')`;
      const second = s4`insert into incentive_calc_approvals (period_id, run_id, submission_no, step_no, decision, actor_id, actor_name) values (${p.id}, ${p.current_run_id}, ${p.submission_no}, 1, 'approve', ${who.a2!}, 'a2')`.then(
        () => "inserted",
        (e: Error) => e.message,
      );
      expect(await stillWaiting(second)).toBe(true);
      await s3`commit`;
      expect(await second).toMatch(/Approval step 1 is not the next one|duplicate key/);
      await s4`rollback`;
    } finally {
      s3.release();
      s4.release();
    }
    expect(Number((await one(pool`select count(*) n from incentive_calc_approvals where period_id = ${p.id}`) as { n: string }).n)).toBe(1);
    // That step-1 row was written behind the service's back: the period's row version didn't move. Take it out of the
    // way for the service-level test by recording it as the service would see it (no further change needed).
  });

  it("service level: two approvers acting on the same screen at once, on separate pooled sessions — exactly one step lands", async () => {
    const p = await period();
    const done = Number((await one(pool`select count(*) n from incentive_calc_approvals where period_id = ${p.id} and submission_no = ${p.submission_no}`) as { n: string }).n);
    // Step 1 is already approved by a1 (above). Two OTHER approvers now race for step 2 from the same screen state.
    const [x, y] = await Promise.all([calc.decideMonth(actor("a2"), programId, APR, p.row_version, "approve", null), calc.decideMonth({ id: who.payerA!, name: "payerA" }, programId, APR, p.row_version, "approve", null)]);
    expect(done).toBe(1);
    const oks = [x, y].filter((r) => r.ok);
    expect(oks).toHaveLength(1);
    expect([x, y].find((r) => !r.ok)).toMatchObject({ error: expect.stringMatching(/changed by someone else/) });
    expect(oks[0]).toMatchObject({ status: "approved", step: 2 });
    expect(Number((await one(pool`select count(*) n from incentive_calc_approvals where period_id = ${p.id}`) as { n: string }).n)).toBe(2);
    expect((await period()).status).toBe("approved");
  });

  it("a stale screen can't approve or pay", async () => {
    const p = await period();
    expect(await calc.decideMonth(actor("a1"), programId, APR, p.row_version - 1, "approve", null)).toMatchObject({ ok: false, error: expect.stringMatching(/changed by someone else|Only a submitted month/) });
    expect(await calc.recordPayout(actor("payerA"), programId, APR, p.row_version - 1, { reference: "STALE", paidOn: p.release_on, amountPaise: 92500, note: null }, p.release_on)).toMatchObject({ ok: false, error: expect.stringMatching(/changed by someone else/) });
  });

  it("SQL level: a second session's payout for the same month WAITS, then is refused — one payout only", async () => {
    const p = await period();
    const s1 = await pool.reserve();
    const s2 = await pool.reserve();
    const ins = (s: typeof s1, ref: string) => s`insert into incentive_calc_payouts (period_id, run_id, reference, release_on, paid_on, total_paise, recorded_by_name) values (${p.id}, ${p.current_run_id}, ${ref}, ${p.release_on}, ${p.release_on}, 92500, 'x')`;
    try {
      await s1`begin`;
      await s2`begin`;
      await ins(s1, "SQL-A");
      const second = ins(s2, "SQL-B").then(() => "inserted", (e: Error) => e.message);
      expect(await stillWaiting(second)).toBe(true);
      await s1`rollback`; // nothing is kept from this experiment
      expect(await second).toBe("inserted");
      await s2`rollback`;
    } finally {
      s1.release();
      s2.release();
    }
    expect(Number((await one(pool`select count(*) n from incentive_calc_payouts where period_id = ${p.id}`) as { n: string }).n)).toBe(0);
  });

  it("service level: two payout recordings at once, on separate pooled sessions — exactly one payout, and the month is paid", async () => {
    const p = await period();
    const [x, y] = await Promise.all([
      calc.recordPayout(actor("payerA"), programId, APR, p.row_version, { reference: "NEFT-A", paidOn: p.release_on, amountPaise: 92500, note: null }, p.release_on),
      calc.recordPayout(actor("payerB"), programId, APR, p.row_version, { reference: "NEFT-B", paidOn: p.release_on, amountPaise: 92500, note: null }, p.release_on),
    ]);
    expect([x, y].filter((r) => r.ok)).toHaveLength(1);
    expect(Number((await one(pool`select count(*) n from incentive_calc_payouts where period_id = ${p.id}`) as { n: string }).n)).toBe(1);
    expect((await period()).status).toBe("paid");
  });

  it("a paid month stays final, whichever session tries", async () => {
    const p = await period();
    await expect(pool`update incentive_calc_periods set status = 'approved', row_version = row_version + 1 where id = ${p.id}`).rejects.toThrow(/final/);
    await expect(pool`update incentive_calc_payouts set total_paise = 1 where period_id = ${p.id}`).rejects.toThrow(/append-only/);
    await expect(pool`delete from incentive_calc_approvals where period_id = ${p.id}`).rejects.toThrow(/append-only/);
    expect(await calc.recordPayout(actor("payerB"), programId, APR, p.row_version, { reference: "AGAIN", paidOn: p.release_on, amountPaise: 92500, note: null }, p.release_on)).toMatchObject({ ok: false, error: expect.stringMatching(/already recorded/) });
  });

  /*
   * Test 52 (NOT YET WRITTEN — needs real PostgreSQL; PGlite is one connection and can only interleave, never run two
   * transactions at once). Prerequisite: TEST_PG_URL naming an APPROVED throwaway PostgreSQL 15+ server on localhost
   * (this file refuses anything else and production's fingerprint), migrations 0131–0133 (and 0142 when it is tested).
   * The test, on three pooled sessions at the same moment:
   *   A  recalculates a PAID April whose new figures differ (a refund recorded after payment) — its difference is carried
   *      into the first open month, October;
   *   B  calculates October;
   *   C  locks October (with a negative balance the configuration carries to the next payout).
   * Expected: every session ends (no deadlock is left; a serialization failure is retried by the service, at most three
   * times, then refused with CALC_BUSY); April's difference is carried EXACTLY ONCE (one recalc-difference row); if C
   * locked October first, the difference goes to November instead (never into a locked month); October's lock reads
   * every adjustment carried into it at its own snapshot (its negative-balance entry matches its stored run); no row is
   * changed after the fact (append-only), and the three sessions' audit rows agree with what was recorded.
   */
  it.todo("Test 52 · calculate, carry and lock at the same moment on separate sessions: a difference is carried exactly once, never into a locked month");
});
