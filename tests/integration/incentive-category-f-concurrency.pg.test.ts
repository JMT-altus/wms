import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// GENUINELY CONCURRENT tests of Category F (0137–0139) on a REAL PostgreSQL server (not PGlite, which is a single
// connection): every transaction below runs on its OWN pooled connection, so two sessions really overlap.
//   * the same email link registered by two people at once — one registry entry, the other a duplicate;
//   * two verifications of the same email (different submissions, its identity entered differently) at once — the second
//     WAITS on the first's unique identity and is refused (SQL level), and the service verifies exactly one (the other is
//     held for Admin Review);
//   * two verdicts on the same submission at once — exactly one active verdict;
//   * two invalidation requests / two second-person decisions on the same review at once — exactly one of each;
//   * a paid month recalculated twice at once after an invalidation — the recovery is carried ONCE;
//   * two write-off requests / two approvals of the same recovery at once — exactly one of each, with its history.
// It runs only when TEST_PG_URL names a throwaway server on localhost (it refuses anything else, and production's
// fingerprint), creates its own database there, and drops it afterwards. Without TEST_PG_URL every test is reported as
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
import { completeConfig } from "../fixtures/incentive-config";

const DB_NAME = `wms_cat_f_conc_${randomBytes(4).toString("hex")}`;
let admin: ReturnType<typeof postgres>;
let pool: ReturnType<typeof postgres>;
let calc: typeof import("@/lib/queries/incentive-calc");
let rules: typeof import("@/lib/queries/incentive-rules");
let fr: typeof import("@/lib/queries/incentive-f-review");
const who: Record<string, string> = {};
const actor = (k: string) => ({ id: who[k]!, name: k });
let programId = "";
let cust = "";
const OCT = "2026-10-01";
const MIG = (f: string) => readFileSync(resolve(__dirname, `../../db/migrations/${f}`), "utf8").replace(/\r\n/g, "\n");
const one = async <T>(q: Promise<T[]>) => (await q)[0]!;
const count = async (q: Promise<{ n: string }[]>) => Number((await one(q)).n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Whether a promise is still unsettled after `ms` (i.e. its session is waiting on a lock). */
const stillWaiting = async (p: Promise<unknown>, ms = 400) => {
  let settled = false;
  p.then(
    () => (settled = true),
    () => (settled = true),
  );
  await sleep(ms);
  return !settled;
};
const LINK = (id: string) => `https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sCh${id}!2m1!1s0x0:0xabc`;
/** Registers a submission through the service (its own transaction), as the Activity page does. */
const register = (k: string, url: string, kind: "google_review" | "email" | "letterhead", publishedOn: string) =>
  (h.db as { transaction: <T>(f: (tx: never) => Promise<T>) => Promise<T> }).transaction((tx) => fr.registerTestimonial(tx, actor(k), null, { kind, url, screenshotUrl: kind === "google_review" ? "https://files.example.test/s.png" : null, publishedOn, rating: kind === "google_review" ? 5 : null, text: null }));
const reviewOfUrl = async (url: string) => (await one(pool`select review_id from incentive_f_submissions where submitted_url = ${url} order by created_at limit 1`) as { review_id: string }).review_id;
const verifyEmail = (k: string, reviewId: string, evidence: { messageId?: string | null; sender: string; subject: string }, named: string[] = []) =>
  fr.recordFDecision(actor(k), { kind: "verify", reviewId, reason: "Checked the original email", testimonialKind: "email", rating: null, publishedOn: "2026-10-12", reviewText: null, googleReviewId: null, namedEmployeeIds: named.map((n) => who[n]!), appreciatedEmployeeIds: [], customerMasterId: cust, evidence, confirmedFromCustomer: true, confirmedType: true, confirmedGenuine: true });
const verifyGoogle = (k: string, reviewId: string, named: string[]) =>
  fr.recordFDecision(actor(k), { kind: "verify", reviewId, reason: "Checked the public review", testimonialKind: "google_review", rating: 5, publishedOn: "2026-10-08", reviewText: null, googleReviewId: null, namedEmployeeIds: named.map((n) => who[n]!), appreciatedEmployeeIds: [], customerMasterId: null, evidence: null, confirmedFromCustomer: false, confirmedType: false, confirmedGenuine: false });
const per = async () => one(pool`select id, row_version, status, release_on::text, current_run_id from incentive_calc_periods where program_id = ${programId} and category_code = 'F' and month = ${OCT}`) as Promise<{ id: string; row_version: number; status: string; release_on: string; current_run_id: string }>;

describe.skipIf(!target)("Category F under genuinely concurrent sessions (real PostgreSQL)", () => {
  beforeAll(async () => {
    admin = postgres(URL_, { max: 1, onnotice: () => {} });
    await admin.unsafe(`create database ${DB_NAME}`);
    const url = new URL(URL_);
    url.pathname = `/${DB_NAME}`;
    pool = postgres(url.toString(), { max: 8, onnotice: () => {} });
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
    // testimonials as production has it (0068's own table), then 0131–0139's own SQL.
    const t68 = MIG("0068_incentive_spine.sql");
    await pool.unsafe(t68.slice(t68.indexOf("CREATE TABLE IF NOT EXISTS testimonials ("), t68.indexOf("\n", t68.indexOf("CREATE INDEX IF NOT EXISTS testimonials_emp_period_idx"))));
    for (const f of ["0131_incentive_rule_config.sql", "0132_incentive_category_a_calculation.sql", "0133_incentive_category_a_inputs_approvals.sql", "0134_incentive_category_b.sql", "0135_incentive_categories_c_g.sql", "0136_incentive_category_c_review.sql", "0137_incentive_category_f_reviews.sql", "0138_incentive_category_f_testimonials.sql", "0139_incentive_category_f_identity.sql"]) await pool.unsafe(MIG(f));
    for (const k of ["rep", "rep2", "rep3", "v1", "v2", "inv1", "inv2", "inv3", "wo1", "wo2", "wo3", "author", "checker", "runner", "runner2", "locker", "a1", "payer"]) who[k] = (await one(pool`insert into employees (name, email, role, is_admin) values (${k}, ${`${k}@example.test`}, 'both', true) returning id`) as { id: string }).id;
    cust = (await one(pool`insert into customer_masters (name, sales_rep_id, credit_period_days) values ('Cust A', ${who.rep2!}, 30) returning id`) as { id: string }).id;
    calc = await import("@/lib/queries/incentive-calc");
    rules = await import("@/lib/queries/incentive-rules");
    fr = await import("@/lib/queries/incentive-f-review");
    // A published Category F configuration from October (the reference amounts; no limit; one approval step).
    const p = await rules.createProgram(actor("author"), { code: "FCONC", name: "F concurrency", description: null });
    if (!p.ok) throw new Error(p.error);
    programId = p.programId;
    const c = completeConfig({}, ["rep", "rep2", "rep3"].map((k) => ({ subjectType: "employee" as const, subjectId: who[k]!, role: null, subjectLabel: k, mode: "include" as const, effectiveFrom: "2025-01-01", effectiveTo: null })), "F");
    const config = { ...c, settings: { ...c.settings, "payout.approvalSteps": 1, "payout.release": "afterApproval", "caps.perEmployeeAllCategoriesMonth": "none", "caps.perEmployeeCategoryMonth": "none" } };
    const d = await rules.createDraft(actor("author"), { programId, category: "F", startFrom: "blank" });
    if (!d.ok) throw new Error(d.error);
    const s = await rules.saveDraft(actor("author"), d.versionId, 1, config, null);
    if (!s.ok) throw new Error(s.error);
    const sub = await rules.submit(actor("author"), d.versionId, s.rowVersion);
    if (!sub.ok) throw new Error(sub.error);
    const ap = await rules.approve(actor("checker"), d.versionId, sub.rowVersion, null);
    if (!ap.ok) throw new Error(ap.error);
    const pub = await rules.publish(actor("checker"), d.versionId, ap.rowVersion, OCT, { canBackdate: true });
    if (!pub.ok) throw new Error(pub.error);
  }, 300_000);
  afterAll(async () => {
    await pool?.end();
    if (admin) {
      await admin.unsafe(`drop database if exists ${DB_NAME} with (force)`);
      await admin.end();
    }
  });

  it("the same email link registered by two people at the same moment: ONE registry entry; the other is a duplicate", async () => {
    const url = "https://files.example.test/oct/race-mail.eml";
    const states = await Promise.all([register("rep", url, "email", "2026-10-12"), register("rep2", url, "email", "2026-10-12")]);
    expect(states.map((s) => s.state).sort()).toEqual(["duplicate", "new"]);
    expect(await count(pool`select count(*) n from incentive_f_reviews where url_key like '%race-mail.eml'`)).toBe(1);
    expect(await count(pool`select count(*) n from incentive_f_submissions where submitted_url = ${url}`)).toBe(2);
  });

  it("SQL level: two sessions verifying the same email (two submissions, one fingerprint) — the second WAITS on the first's unique identity, then is refused", async () => {
    await register("rep", "https://files.example.test/oct/sql-a.eml", "email", "2026-10-12");
    await register("rep2", "https://files.example.test/oct/sql-b.eml", "email", "2026-10-12");
    const [a, b] = await Promise.all(["https://files.example.test/oct/sql-a.eml", "https://files.example.test/oct/sql-b.eml"].map(reviewOfUrl));
    const fp = `email:${sha("sql-level-email")}`;
    const ins = (s: postgres.ReservedSql, review: string, mid: string) =>
      s`insert into incentive_f_decisions (review_id, kind, testimonial_kind, published_on, review_month, evidence_key, evidence_message_id, evidence_fingerprint, confirmed_from_customer, confirmed_type, confirmed_genuine, customer_master_id, reason, created_by_id, created_by_name) values (${review}, 'verify', 'email', '2026-10-12', ${OCT}, ${`email:mid:${mid}`}, ${mid}, ${fp}, true, true, true, ${cust}, 'x', ${who.v1!}, 'v1')`;
    const s1 = await pool.reserve();
    const s2 = await pool.reserve();
    try {
      await s1`begin`;
      await s2`begin`;
      await ins(s1, a!, "sql-1@cust-a.example");
      const second = ins(s2, b!, "sql-2@cust-a.example").then(
        () => "inserted",
        (e: Error) => e.message,
      );
      expect(await stillWaiting(second)).toBe(true); // waits on the first session's uncommitted unique identity
      await s1`commit`;
      expect(await second).toMatch(/incentive_f_decisions_fingerprint_uq/);
      await s2`rollback`;
    } finally {
      s1.release();
      s2.release();
    }
    expect(await count(pool`select count(*) n from incentive_f_decisions where evidence_fingerprint = ${fp} and kind = 'verify' and retired_at is null`)).toBe(1);
  });

  it("service level: two verifiers verify two submissions of the same email at once (by Message-ID / by sender, date and subject) — exactly one is verified; the other is refused and held", async () => {
    await register("rep", "https://files.example.test/oct/svc-a.eml", "email", "2026-10-12");
    await register("rep3", "https://files.example.test/oct/svc-b.eml", "email", "2026-10-12");
    const [a, b] = await Promise.all(["https://files.example.test/oct/svc-a.eml", "https://files.example.test/oct/svc-b.eml"].map(reviewOfUrl));
    const [x, y] = await Promise.all([
      verifyEmail("v1", a!, { messageId: "<svc-77@cust-a.example>", sender: "Cust A <ops@cust-a.example>", subject: "Thanks for the service visit" }),
      verifyEmail("v2", b!, { sender: "OPS@CUST-A.EXAMPLE", subject: "Re: thanks for the service visit" }),
    ]);
    expect([x, y].filter((r) => r.ok)).toHaveLength(1);
    expect([x, y].find((r) => !r.ok)).toMatchObject({ error: expect.stringMatching(/already verified \(the same email or letter/) });
    expect(await count(pool`select count(*) n from incentive_f_decisions where review_id in (${a!}, ${b!}) and kind = 'verify' and retired_at is null`)).toBe(1);
    expect(await count(pool`select count(*) n from incentive_f_decisions where review_id in (${a!}, ${b!}) and kind = 'needs-review' and retired_at is null`)).toBe(1);
  });

  it("two verifiers record a verdict on the SAME submission at once — exactly one active verdict", async () => {
    await register("rep", LINK("SAMEAAAAAAAA"), "google_review", "2026-10-08");
    const r = await reviewOfUrl(LINK("SAMEAAAAAAAA"));
    const [x, y] = await Promise.all([verifyGoogle("v1", r!, ["rep"]), verifyGoogle("v2", r!, ["rep"])]);
    expect([x, y].filter((v) => v.ok)).toHaveLength(1);
    expect(await count(pool`select count(*) n from incentive_f_decisions where review_id = ${r!} and kind in ('verify', 'reject', 'needs-review') and retired_at is null`)).toBe(1);
  });

  it("October paid; then two invalidation requests at once (one lands) and two second-person decisions at once (one lands)", async () => {
    // October: rep's verified Google review (above) and another; calculate, lock, submit, approve, pay.
    await register("rep2", LINK("PAIDAAAAAAAA"), "google_review", "2026-10-08");
    const paid = await reviewOfUrl(LINK("PAIDAAAAAAAA"));
    expect(await verifyGoogle("v1", paid!, ["rep2"])).toMatchObject({ ok: true });
    expect(await calc.calculate(actor("runner"), programId, OCT, "2026-11-19", "F")).toMatchObject({ ok: true });
    expect(await calc.setLocked(actor("locker"), programId, OCT, true, (await per()).row_version, "F")).toMatchObject({ ok: true });
    expect(await calc.submitMonth(actor("locker"), programId, OCT, (await per()).row_version, "F")).toMatchObject({ ok: true });
    expect(await calc.decideMonth(actor("a1"), programId, OCT, (await per()).row_version, "approve", null, undefined, "F")).toMatchObject({ ok: true, status: "approved" });
    const p = await per();
    const total = await count(pool`select coalesce(sum(r.payable_paise), 0)::text n from incentive_calc_results r where r.run_id = ${p.current_run_id}`);
    expect(await calc.recordPayout(actor("payer"), programId, OCT, p.row_version, { reference: "PAY-F-OCT", paidOn: p.release_on, amountPaise: total, note: null }, p.release_on, "F")).toMatchObject({ ok: true });
    expect((await per()).status).toBe("paid");
    // Two invalidation requests for the same review at once: exactly one.
    const reqs = await Promise.all([fr.requestFInvalidation(actor("inv1"), { reviewId: paid!, reason: "Deleted by its author", evidenceUrl: "https://files.example.test/gone-1.png" }), fr.requestFInvalidation(actor("inv3"), { reviewId: paid!, reason: "Deleted", evidenceUrl: "https://files.example.test/gone-2.png" })]);
    expect(reqs.filter((r) => r.ok)).toHaveLength(1);
    const req = reqs.find((r) => r.ok) as { ok: true; id: string };
    // Two second people decide it at once: exactly one decision.
    const requester = (await one(pool`select created_by_name n from incentive_f_decisions where id = ${req.id}`) as { n: string }).n;
    const deciders = ["inv2", requester === "inv1" ? "inv3" : "inv1"];
    const decs = await Promise.all(deciders.map((k) => fr.decideFInvalidation(actor(k), { requestId: req.id, decision: "approve", reason: "Confirmed: no longer on Google" })));
    expect(decs.filter((r) => r.ok)).toHaveLength(1);
    expect(await count(pool`select count(*) n from incentive_f_decisions where request_id = ${req.id}`)).toBe(1);
  });

  it("the paid month recalculated twice at the same moment after the invalidation: the recovery is carried ONCE; October never changes", async () => {
    const before = await count(pool`select coalesce(sum(r.payable_paise), 0)::text n from incentive_calc_results r join incentive_calc_periods p on p.current_run_id = r.run_id where p.program_id = ${programId} and p.category_code = 'F' and p.month = ${OCT}`);
    const runs = await Promise.all([calc.calculate(actor("runner"), programId, OCT, "2026-11-19", "F"), calc.calculate(actor("runner2"), programId, OCT, "2026-11-19", "F")]);
    expect(runs.some((r) => r.ok)).toBe(true);
    expect(await count(pool`select count(*) n from incentive_calc_adjustments where program_id = ${programId} and category_code = 'F' and amount_paise < 0 and to_month is not null`)).toBe(1);
    expect(await count(pool`select coalesce(sum(r.payable_paise), 0)::text n from incentive_calc_results r join incentive_calc_periods p on p.current_run_id = r.run_id where p.program_id = ${programId} and p.category_code = 'F' and p.month = ${OCT}`)).toBe(before);
  });

  it("two write-off requests for the same recovery at once (one lands); two approvals at once (one lands) — one write-off, its history recorded once each", async () => {
    const recovery = (await one(pool`select id, amount_paise::int a from incentive_calc_adjustments where program_id = ${programId} and category_code = 'F' and amount_paise < 0 and to_month is not null`) as { id: string; a: number });
    const amount = -recovery.a;
    const reqs = await Promise.all([fr.requestFWriteOff(actor("wo1"), { adjustmentId: recovery.id, amountPaise: amount, reason: "Left the company", evidenceUrl: null }), fr.requestFWriteOff(actor("wo3"), { adjustmentId: recovery.id, amountPaise: amount, reason: "Left", evidenceUrl: null })]);
    expect(reqs.filter((r) => r.ok)).toHaveLength(1);
    const req = reqs.find((r) => r.ok) as { ok: true; id: string };
    const requester = (await one(pool`select created_by_name n from incentive_f_writeoffs where id = ${req.id}`) as { n: string }).n;
    const approvers = ["wo2", requester === "wo1" ? "wo3" : "wo1"];
    const decs = await Promise.all(approvers.map((k) => fr.decideFWriteOff(actor(k), { requestId: req.id, decision: "approve", reason: "Approved write-off" })));
    expect(decs.filter((r) => r.ok)).toHaveLength(1);
    expect(await count(pool`select count(*) n from incentive_f_writeoffs where adjustment_id = ${recovery.id} and kind = 'approve'`)).toBe(1);
    expect(await count(pool`select count(*) n from incentive_calc_adjustments where kind = 'recovery-write-off' and program_id = ${programId}`)).toBe(1);
    // The input history (0139): exactly the request and the one approval, never a refused attempt.
    expect(await count(pool`select count(*) n from incentive_calc_input_history where entity = 'f-writeoff'`)).toBe(2);
    await expect(pool`delete from incentive_calc_input_history where entity = 'f-writeoff'`).rejects.toThrow(/append-only/);
    // A paid month stays final, whichever session tries.
    await expect(pool`update incentive_calc_periods set status = 'approved' where program_id = ${programId} and category_code = 'F' and month = ${OCT}`).rejects.toThrow(/final/);
  });
});
