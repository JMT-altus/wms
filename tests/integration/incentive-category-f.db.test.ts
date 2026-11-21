import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Category F (Google reviews, 0137) end to end on an in-memory PGlite database built from db/schema.ts plus 0131–0137's
// own SQL: submission and the unique registry, the old engine before and after the cut-over (D1, D4), verification and
// its Field Permission, attribution, calculation by the verified publication month, separation of duties, late reviews,
// two-person invalidation and recovery, the two-person write-off, and employee deletion (D3). SYNTHETIC data only;
// only the session is mocked. No other database is reached.
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, superAdmins: new Set<string>(), me: null as null | { id: string; email: string; name: string; isActive: boolean; isAdmin: boolean; departmentId: null; role: string } };
});
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (f: unknown) => f, updateTag: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));
// Super-admins: synthetic emails only (superNoGrant, superVerifier) — they get NO Category F right without a grant.
vi.mock("@/lib/auth/super-admin", () => ({ SUPER_ADMIN_EMAILS: [], isSuperAdmin: (e: string | null | undefined) => !!e && h.superAdmins.has(e) }));
vi.mock("@/lib/auth/current", () => ({
  getCurrentEmployee: async () => h.me,
  requireUser: async () => {
    if (!h.me?.isActive) throw new Error("Unauthorized");
    return h.me;
  },
  requireAdmin: async () => {
    if (!h.me?.isActive || !h.me.isAdmin) throw new Error("Forbidden");
    return h.me;
  },
}));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";
import { completeConfig } from "../fixtures/incentive-config";
import type { SettingValue } from "@/lib/incentives/rules-config/spec";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let act: typeof import("@/app/(masters)/master-setup/incentive-rules/calculation/actions");
let activity: typeof import("@/app/(app)/incentive/actions");
let calc: typeof import("@/lib/queries/incentive-calc");
let rules: typeof import("@/lib/queries/incentive-rules");
let load: typeof import("@/lib/incentives/load");
const PEOPLE = ["author", "checker", "runner", "locker", "a1", "payer", "rep", "rep2", "rep3", "leaver", "verifier", "verifier2", "inval1", "inval2", "wo1", "wo2", "plainAdmin", "superNoGrant", "superVerifier"] as const;
type Who = (typeof PEOPLE)[number];
const who = {} as Record<Who, string>;
const ADMINS = new Set<Who>(["author", "checker", "runner", "locker", "a1", "payer", "verifier", "verifier2", "inval1", "inval2", "wo1", "wo2", "plainAdmin", "superNoGrant", "superVerifier"]);
const GRANTS: Partial<Record<Who, string[]>> = {
  runner: ["incentive.calc.run"], locker: ["incentive.calc.lock", "incentive.calc.submit"], a1: ["incentive.calc.approve"], payer: ["incentive.calc.pay"],
  verifier: ["incentive.f.verify", "incentive.calc.approve", "incentive.activity.anyMonth"], verifier2: ["incentive.f.verify"], inval1: ["incentive.f.invalidate"], inval2: ["incentive.f.invalidate"],
  wo1: ["incentive.f.writeOff"], wo2: ["incentive.f.writeOff"], superVerifier: ["incentive.f.verify", "incentive.activity.anyMonth"],
  rep: ["incentive.activity.anyMonth"], rep2: ["incentive.activity.anyMonth"], rep3: ["incentive.activity.anyMonth"], leaver: ["incentive.activity.anyMonth"],
};
const actor = (k: Who) => ({ id: who[k], name: k });
const signIn = (k: Who) => {
  h.me = { id: who[k], email: `${k}@example.test`, name: k, isActive: true, isAdmin: ADMINS.has(k), departmentId: null, role: "both" };
};
const q1 = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows;
const one = async <T = Record<string, unknown>>(text: string, params: unknown[] = []) => (await q1<T>(text, params))[0]!;
const MIG = (f: string) => readFileSync(resolve(__dirname, `../../db/migrations/${f}`), "utf8");
const RS = (r: number) => Math.round(r * 100);
let programId = "";
const SEP = "2026-09-01", OCT = "2026-10-01", NOV = "2026-11-01";
/** A Google Maps review link carrying its review ID (synthetic). */
const LINK = (id: string, extra = "") => `https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sCh${id}!2m1!1s0x0:0xabc${extra}`;

async function publishF(settings: Record<string, SettingValue>, from: string, without: Who[] = []) {
  const c = completeConfig({}, PEOPLE.filter((p) => (p.startsWith("rep") || p === "leaver") && !without.includes(p)).map((p) => ({ subjectType: "employee" as const, subjectId: who[p], role: null, subjectLabel: p, mode: "include" as const, effectiveFrom: "2025-01-01", effectiveTo: null })), "F");
  const config = { ...c, settings: { ...c.settings, "payout.approvalSteps": 1, "payout.release": "afterApproval", "caps.perEmployeeAllCategoriesMonth": "none", "caps.perEmployeeCategoryMonth": "none", ...settings } };
  const d = await rules.createDraft(actor("author"), { programId, category: "F", startFrom: "blank" });
  if (!d.ok) throw new Error(d.error);
  const s = await rules.saveDraft(actor("author"), d.versionId, 1, config, null);
  if (!s.ok) throw new Error(s.error);
  const sub = await rules.submit(actor("author"), d.versionId, s.rowVersion);
  if (!sub.ok) throw new Error(sub.error);
  const ap = await rules.approve(actor("checker"), d.versionId, sub.rowVersion, null);
  if (!ap.ok) throw new Error(ap.error);
  const pub = await rules.publish(actor("checker"), d.versionId, ap.rowVersion, from, { canBackdate: true });
  if (!pub.ok) throw new Error(pub.error);
}
const submit = async (k: Who, x: { url: string; publishedOn: string; rating?: number; text?: string; screenshot?: string; names?: boolean }) => {
  signIn(k);
  return activity.submitTestimonial({ kind: "google_review", wordCount: 0, starRating: x.rating ?? 5, namesTeamMember: !!x.names, reviewUrl: x.url, publishedOn: x.publishedOn, reviewText: x.text, screenshotUrl: x.screenshot ?? "https://files.example.test/shot.png" });
};
const reviewOf = async (url: string) => (await one<{ review_id: string }>(`select review_id from incentive_f_submissions where submitted_url = $1 order by created_at limit 1`, [url])).review_id;
const decide = async (k: Who, input: Record<string, unknown>) => {
  signIn(k);
  return act.recordCategoryFDecision(input);
};
/** A verification (0138's shape). By default whoever it names is also appreciated by name (F.4: the reward doubled). */
/** What identifies an email (Message-ID, sender, subject) or a letter (reference) — read off the original by the verifier. */
type Evidence = { messageId?: string | null; sender?: string | null; subject?: string | null; reference?: string | null };
const verify = async (k: Who, reviewId: string, x: { publishedOn: string; rating?: number; named?: Who[]; appreciated?: Who[]; customer?: string | null; text?: string; gid?: string | null; kind?: "google_review" | "email" | "letterhead"; evidence?: Evidence | null; findings?: [boolean, boolean, boolean] }) => {
  const kind = x.kind ?? "google_review";
  const found = x.findings ?? (kind === "google_review" ? [false, false, false] : [true, true, true]);
  return decide(k, { kind: "verify", reviewId, reason: "Checked the original", testimonialKind: kind, rating: kind === "google_review" ? (x.rating ?? 5) : null, publishedOn: x.publishedOn, reviewText: x.text ?? "Great service from the team", googleReviewId: x.gid ?? null, namedEmployeeIds: (x.named ?? []).map((n) => who[n]), appreciatedEmployeeIds: (x.appreciated ?? x.named ?? []).map((n) => who[n]), customerMasterId: x.customer ?? null, evidence: kind === "google_review" ? null : (x.evidence ?? null), confirmedFromCustomer: found[0], confirmedType: found[1], confirmedGenuine: found[2] });
};
/** An email or letterhead testimonial, submitted with its evidence link and its own date. */
const submitDoc = async (k: Who, x: { kind: "email" | "letterhead"; url?: string; dated?: string; text?: string; periodMonth?: string }) => {
  signIn(k);
  return activity.submitTestimonial({ kind: x.kind, wordCount: 60, namesTeamMember: false, evidenceUrl: x.url, publishedOn: x.dated, reviewText: x.text, periodMonth: x.periodMonth });
};
const per = async (month: string) => one<{ id: string; row_version: number; status: string; release_on: string | null; current_run_id: string }>(`select id, row_version, status, release_on::text, current_run_id from incentive_calc_periods where program_id = $1 and category_code = 'F' and month = $2`, [programId, month]);
const calcF = async (month: string, asOf = "2026-11-19") => {
  signIn("runner");
  return act.calculateCategoryAMonth({ programId, month, asOf, category: "F" });
};
const payable = async (month: string) => Object.fromEntries((await q1<{ name: string; p: string }>(`select r.employee_name name, r.payable_paise::text p from incentive_calc_results r join incentive_calc_periods per on per.current_run_id = r.run_id where per.program_id = $1 and per.category_code = 'F' and per.month = $2`, [programId, month])).map((r) => [r.name, Number(r.p)]));

beforeAll(async () => {
  const made = await createTestDb({
    employees: schema.employees, departments: schema.departments, employeeDepartments: schema.employeeDepartments, fieldPermissionGrants: schema.fieldPermissionGrants,
    customerMasters: schema.customerMasters, vendorMasters: schema.vendorMasters, tallyImportBatches: schema.tallyImportBatches, tallyDocuments: schema.tallyDocuments, salesOrderPreclosures: schema.salesOrderPreclosures,
    products: schema.products, productCategories: schema.productCategories,
    customers: schema.customers, salesOrders: schema.salesOrders, invoices: schema.invoices, receipts: schema.receipts,
    leadBatches: schema.leadBatches, leadConversions: schema.leadConversions, clientMeetings: schema.clientMeetings,
    incentiveSchemes: schema.incentiveSchemes, ruleVersions: schema.ruleVersions, incentivePeriods: schema.incentivePeriods, incentiveLedger: schema.incentiveLedger, payoutRuns: schema.payoutRuns, incentiveAudit: schema.incentiveAudit,
  });
  pg = made.pg;
  h.db = made.db;
  // testimonials as production has it: 0068's own table (NOT NULL employee, ON DELETE CASCADE), not the new schema.
  const t68 = MIG("0068_incentive_spine.sql");
  await pg.exec(t68.slice(t68.indexOf("CREATE TABLE IF NOT EXISTS testimonials"), t68.indexOf("CREATE INDEX IF NOT EXISTS testimonials_emp_period_idx")));
  for (const k of PEOPLE) who[k] = (await one<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', $3) returning id`, [k, `${k}@example.test`, ADMINS.has(k)])).id;
  for (const k of ["superNoGrant", "superVerifier"] as const) h.superAdmins.add(`${k}@example.test`);
  for (const [k, keys] of Object.entries(GRANTS)) for (const key of keys!) await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ($1, 'employee', $2, true)`, [key, who[k as Who]]);
  // A testimonial recorded BEFORE 0137 (the old shape): 0137 keeps its employee's name.
  await pg.query(`insert into testimonials (employee_id, period_month, kind, word_count) values ($1, '2026-07', 'email', 20)`, [who.leaver]);
  for (const f of ["0131_incentive_rule_config.sql", "0132_incentive_category_a_calculation.sql", "0133_incentive_category_a_inputs_approvals.sql", "0134_incentive_category_b.sql", "0135_incentive_categories_c_g.sql", "0136_incentive_category_c_review.sql", "0137_incentive_category_f_reviews.sql", "0138_incentive_category_f_testimonials.sql", "0139_incentive_category_f_identity.sql"]) await pg.exec(MIG(f));
  act = await import("@/app/(masters)/master-setup/incentive-rules/calculation/actions");
  activity = await import("@/app/(app)/incentive/actions");
  calc = await import("@/lib/queries/incentive-calc");
  rules = await import("@/lib/queries/incentive-rules");
  load = await import("@/lib/incentives/load");
  const p = await rules.createProgram(actor("author"), { code: "SALES", name: "Sales team", description: null });
  if (!p.ok) throw new Error(p.error);
  programId = p.programId;
}, 240_000);
afterAll(async () => {
  await pg?.close();
});

describe("0137 on the old testimonials table (D3)", () => {
  it("applies twice; a testimonial recorded before keeps its employee's name; employee_id is nullable ON DELETE SET NULL", async () => {
    // Re-running 0137 restores its own insert check and input-history entity list, so 0138 and 0139 (both safe to re-run)
    // follow it, in order, as they would in production.
    await pg.exec(MIG("0137_incentive_category_f_reviews.sql"));
    await pg.exec(MIG("0138_incentive_category_f_testimonials.sql"));
    await pg.exec(MIG("0139_incentive_category_f_identity.sql"));
    expect(await q1(`select employee_name from testimonials where employee_id = $1`, [who.leaver])).toEqual([{ employee_name: "leaver" }]);
    const fk = await q1<{ d: string }>(`select pg_get_constraintdef(oid) d from pg_constraint where conrelid = 'public.testimonials'::regclass and contype = 'f' and confrelid = 'public.employees'::regclass and conname = 'testimonials_employee_id_fkey'`);
    expect(fk[0]!.d).toMatch(/ON DELETE SET NULL/);
    expect(await q1(`select is_nullable from information_schema.columns where table_name = 'testimonials' and column_name = 'employee_id'`)).toEqual([{ is_nullable: "YES" }]);
  });
});

describe("before the cut-over (D1, D4): the old engine pays as today; the claim alone earns nothing", () => {
  it("a Google review needs its public link and its publication date; a link that isn't Google's, or a future date, is refused", async () => {
    expect(await submit("rep", { url: "", publishedOn: "2026-08-05" })).toEqual({ ok: false, error: expect.stringMatching(/Give the public Google review link/) });
    expect(await submit("rep", { url: "https://example.com/review/1", publishedOn: "2026-08-05" })).toEqual({ ok: false, error: expect.stringMatching(/Only a public Google review link is accepted/) });
    expect(await submit("rep", { url: LINK("AUG1"), publishedOn: "2099-01-01" })).toEqual({ ok: false, error: expect.stringMatching(/published in the future/) });
    expect(await submit("rep", { url: LINK("AUG1"), publishedOn: "" })).toEqual({ ok: false, error: expect.stringMatching(/Give the date the review was published/) });
  });
  it("the old record takes the CLAIMED publication month; unapproved it earns nothing in the old engine; approved by someone else it does (as today)", async () => {
    expect(await submit("rep", { url: LINK("AUG1AAAAAAAA"), publishedOn: "2026-08-05", text: Array.from({ length: 60 }, () => "helpful").join(" ") })).toEqual({ ok: true });
    const t = await one<{ id: string; period_month: string; employee_name: string; review_status: string }>(`select id, period_month, employee_name, review_status from testimonials where employee_id = $1 and kind = 'google_review'`, [who.rep]);
    expect(t).toMatchObject({ period_month: "2026-08", employee_name: "rep", review_status: "pending" });
    await load.computePeriodForEmployee(who.rep, "2026-08", new Date("2026-08-31T12:00:00Z"));
    expect(await q1(`select l.amount_paise from incentive_ledger l join incentive_periods p on p.id = l.period_id where l.employee_id = $1 and l.category = 'F'`, [who.rep])).toEqual([]);
    signIn("verifier");
    expect(await activity.reviewSubmission({ queue: "testimonial", id: t.id, decision: "approved", namesTeamMember: false })).toEqual({ ok: true });
    const ledger = await q1<{ a: string }>(`select l.amount_paise::text a from incentive_ledger l where l.employee_id = $1 and l.category = 'F'`, [who.rep]);
    expect(ledger.length).toBe(1);
    expect(Number(ledger[0]!.a)).toBeGreaterThan(0);
  });
  it("email and letterhead are still offered and recorded as before — and (0138) need their evidence link and their own date", async () => {
    expect(await submitDoc("rep2", { kind: "email", dated: "2026-08-03", periodMonth: "2026-08" })).toEqual({ ok: false, error: expect.stringMatching(/Give the link to the email/) });
    expect(await submitDoc("rep2", { kind: "letterhead", url: "https://files.example.test/aug-letter.pdf", periodMonth: "2026-08" })).toEqual({ ok: false, error: expect.stringMatching(/Give the date of the letter/) });
    expect(await submitDoc("rep2", { kind: "email", url: "https://files.example.test/aug-mail.eml", dated: "2099-01-01", periodMonth: "2026-08" })).toEqual({ ok: false, error: expect.stringMatching(/can't be dated in the future/) });
    expect(await submitDoc("rep2", { kind: "email", url: "https://files.example.test/aug-mail.eml", dated: "2026-08-03", periodMonth: "2026-08" })).toEqual({ ok: true });
    signIn("rep2");
    expect(await activity.submitTestimonial({ kind: "letterhead", wordCount: 60, namesTeamMember: true, periodMonth: "2026-08", evidenceUrl: "https://files.example.test/aug-letter.pdf", publishedOn: "2026-08-04" })).toEqual({ ok: true });
    expect(await q1(`select claimed_kind k, claimed_rating r, link_state s from incentive_f_submissions where submitted_by_name = 'rep2' order by created_at`)).toEqual([{ k: "email", r: null, s: "new" }, { k: "letterhead", r: null, s: "new" }]);
    expect(await q1(`select kind, period_month, employee_name from testimonials where employee_id = $1 order by kind`, [who.rep2])).toEqual([{ kind: "email", period_month: "2026-08", employee_name: "rep2" }, { kind: "letterhead", period_month: "2026-08", employee_name: "rep2" }]);
  });
});

describe("the review registry: one Google review is registered once, across employees", () => {
  beforeAll(async () => {
    // Category F published from September: the cut-over month.
    await publishF({}, SEP);
  });
  it("a screenshot is required while the version in force asks for one", async () => {
    signIn("rep");
    expect(await activity.submitTestimonial({ kind: "google_review", wordCount: 0, starRating: 5, namesTeamMember: false, reviewUrl: LINK("NOSHOTAAAAAA"), publishedOn: "2026-10-03" })).toEqual({ ok: false, error: expect.stringMatching(/Attach the review's screenshot/) });
  });
  it("the same review by another employee (same review ID, another link form) is a DUPLICATE; the same normalised link is a duplicate; a short link is unresolved", async () => {
    expect(await submit("rep", { url: LINK("R1AAAAAAAAAA"), publishedOn: "2026-10-05" })).toEqual({ ok: true });
    expect(await submit("rep2", { url: `${LINK("R1AAAAAAAAAA")}?hl=en&utm_source=x`, publishedOn: "2026-10-05" })).toEqual({ ok: true });
    expect(await submit("rep3", { url: "https://WWW.Google.com/maps/place/Acme/reviews/", publishedOn: "2026-10-06" })).toEqual({ ok: true });
    expect(await submit("rep2", { url: "https://www.google.com/maps/place/Acme/reviews?hl=en", publishedOn: "2026-10-06" })).toEqual({ ok: true });
    expect(await submit("rep3", { url: "https://maps.app.goo.gl/abcdEFGH", publishedOn: "2026-10-07" })).toEqual({ ok: true });
    const subs = await q1<{ s: string; n: string }>(`select link_state s, submitted_by_name n from incentive_f_submissions where claimed_published_on >= '2026-10-01' order by created_at`);
    expect(subs.map((x) => `${x.n}:${x.s}`)).toEqual(["rep:new", "rep2:duplicate", "rep3:new", "rep2:duplicate", "rep3:unresolved"]);
    // The database refuses a second registry row for the same review whatever the code does.
    const gid = (await one<{ g: string }>(`select google_review_id g from incentive_f_reviews where google_review_id like 'ChR1%'`)).g;
    await expect(pg.query(`insert into incentive_f_reviews (google_review_id, first_url, created_by_name) values ($1, 'x', 'x')`, [gid])).rejects.toThrow(/duplicate key/);
    await expect(pg.query(`update incentive_f_reviews set url_key = 'changed' where google_review_id = $1`, [gid])).rejects.toThrow(/append-only/);
  });
});

describe("verification, attribution and the month's calculation", () => {
  let r1 = "", r2 = "", r3 = "", r4 = "", r5 = "", low = "", cust = "";
  beforeAll(async () => {
    cust = (await one<{ id: string }>(`insert into customer_masters (name, sales_rep_id, credit_period_days) values ('Cust A', $1, 30) returning id`, [who.rep2])).id;
    r1 = await reviewOf(LINK("R1AAAAAAAAAA"));
    for (const [k, id] of [["rep", "R2AAAAAAAAAA"], ["rep", "R3AAAAAAAAAA"], ["rep3", "R4AAAAAAAAAA"], ["rep", "R5AAAAAAAAAA"], ["rep", "LOWAAAAAAAAA"]] as const) expect(await submit(k, { url: LINK(id), publishedOn: id === "R5AAAAAAAAAA" ? "2026-09-20" : "2026-10-08" })).toEqual({ ok: true });
    [r2, r3, r4, r5, low] = (await Promise.all(["R2AAAAAAAAAA", "R3AAAAAAAAAA", "R4AAAAAAAAAA", "R5AAAAAAAAAA", "LOWAAAAAAAAA"].map((x) => reviewOf(LINK(x))))) as [string, string, string, string, string];
  });
  it("only incentive.f.verify verifies, never the submitter, always with a reason; one active verdict at a time; decisions are retire-only", async () => {
    for (const k of ["rep", "plainAdmin", "inval1"] as const) {
      signIn(k);
      // Refused with a message (never a thrown error): a non-admin, an admin without the right, another F right only.
      expect(await act.recordCategoryFDecision({ kind: "verify", reviewId: r1, reason: "x", testimonialKind: "google_review", rating: 5, publishedOn: "2026-10-05", reviewText: null, googleReviewId: null, namedEmployeeIds: [], appreciatedEmployeeIds: [], customerMasterId: null, evidenceKey: null, confirmedFromCustomer: false, confirmedType: false, confirmedGenuine: false })).toEqual({ ok: false, error: expect.stringMatching(k === "rep" ? /Only an administrator/ : /Verify Category F reviews and testimonials \(F\.1–F\.4\)” permission/) });
    }
    // The verifier submitted a review of their own: they can't verify it.
    expect(await submit("verifier", { url: LINK("OWNAAAAAAAAA"), publishedOn: "2026-10-09" })).toEqual({ ok: true });
    expect(await verify("verifier", await reviewOf(LINK("OWNAAAAAAAAA")), { publishedOn: "2026-10-09" })).toEqual({ ok: false, error: expect.stringMatching(/Whoever submitted a Google review never verifies/) });
    expect(await decide("verifier", { kind: "reject", reviewId: r1, reason: "  " })).toEqual({ ok: false, error: expect.stringMatching(/Give the reason/) });
    expect(await verify("verifier", r1, { publishedOn: "2026-10-05", named: ["rep"] })).toMatchObject({ ok: true });
    expect(await verify("verifier2", r1, { publishedOn: "2026-10-05", named: ["rep"] })).toEqual({ ok: false, error: expect.stringMatching(/second active decision/) });
    const d = await one<{ id: string }>(`select id from incentive_f_decisions where review_id = $1 and kind = 'verify'`, [r1]);
    await expect(pg.query(`update incentive_f_decisions set rating = 4 where id = $1`, [d.id])).rejects.toThrow(/never changes/);
    await expect(pg.query(`delete from incentive_f_decisions where id = $1`, [d.id])).rejects.toThrow(/never deleted/);
    // Retire (with the reason) and verify again: the history keeps both.
    signIn("verifier");
    expect(await act.retireCategoryFDecision({ id: d.id, reason: "Rating misread" })).toMatchObject({ ok: true });
    expect(await verify("verifier", r1, { publishedOn: "2026-10-05", named: ["rep"] })).toMatchObject({ ok: true });
    expect((await q1(`select kind, retired_at is not null retired from incentive_f_decisions where review_id = $1 order by created_at`, [r1])).map((x) => x.retired)).toEqual([true, false]);
    expect((await q1(`select action from incentive_calc_input_history where entity = 'f-decision' order by event_no`)).length).toBeGreaterThanOrEqual(3);
  });
  it("every Category F right needs its EXPLICIT grant — super-admins too; one right never gives another; a right removed after the page opened is refused with a message", async () => {
    // Synthetic June reviews (no month is calculated for June here), so nothing else in this file changes.
    for (const id of ["SAJUNAAAAAAA", "OAJUNAAAAAAA", "SAOWNAAAAAAA"]) expect(await submit(id === "SAOWNAAAAAAA" ? "superVerifier" : "rep", { url: LINK(id), publishedOn: "2026-06-12" })).toEqual({ ok: true });
    const [sa, oa, own] = (await Promise.all(["SAJUNAAAAAAA", "OAJUNAAAAAAA", "SAOWNAAAAAAA"].map((x) => reviewOf(LINK(x))))) as [string, string, string];
    const hold = (reviewId: string) => ({ kind: "needs-review", reviewId, reason: "Checking with the customer" });
    const denied = { verify: /Verify Category F reviews and testimonials \(F\.1–F\.4\)” permission/, invalidate: /Invalidate a Category F review or testimonial” permission/, writeOff: /Write off a Category F recovery” permission/ };
    const tryAll = async (k: Who) => {
      signIn(k);
      return {
        verify: await act.recordCategoryFDecision(hold(sa)),
        invalidate: await act.requestCategoryFInvalidation({ reviewId: sa, reason: "x", evidenceUrl: "https://files.example.test/x.png" }),
        writeOff: await act.requestCategoryFWriteOff({ adjustmentId: "00000000-0000-4000-8000-000000000000", amountPaise: 100, reason: "x", evidenceUrl: null }),
      };
    };
    // A super-admin without a grant, and an ordinary admin without one: refused for all three.
    for (const k of ["superNoGrant", "plainAdmin"] as const) {
      const r = await tryAll(k);
      for (const right of ["verify", "invalidate", "writeOff"] as const) expect(r[right], `${k} ${right}`).toEqual({ ok: false, error: expect.stringMatching(denied[right]) });
    }
    // One right never gives another (verify only, invalidate only, write-off only).
    const onlyVerify = await tryAll("verifier2");
    expect([onlyVerify.invalidate, onlyVerify.writeOff]).toEqual([{ ok: false, error: expect.stringMatching(denied.invalidate) }, { ok: false, error: expect.stringMatching(denied.writeOff) }]);
    expect(onlyVerify.verify).toMatchObject({ ok: true }); // …while its own right works (an ordinary admin with the grant)
    const onlyInvalidate = await tryAll("inval1");
    expect([onlyInvalidate.verify, onlyInvalidate.writeOff]).toEqual([{ ok: false, error: expect.stringMatching(denied.verify) }, { ok: false, error: expect.stringMatching(denied.writeOff) }]);
    const onlyWriteOff = await tryAll("wo1");
    expect([onlyWriteOff.verify, onlyWriteOff.invalidate]).toEqual([{ ok: false, error: expect.stringMatching(denied.verify) }, { ok: false, error: expect.stringMatching(denied.invalidate) }]);
    // Only verifier2's hold was recorded; the refusals recorded nothing.
    expect(await q1(`select kind, created_by_id = $2 by_v2 from incentive_f_decisions where review_id = any($1)`, [[sa, oa, own], who.verifier2])).toEqual([{ kind: "needs-review", by_v2: true }]);
    // WITH the explicit grant a super-admin is allowed — and still never decides their own submission (service + trigger).
    expect(await decide("superVerifier", hold(oa))).toMatchObject({ ok: true });
    expect(await decide("superVerifier", hold(own))).toEqual({ ok: false, error: expect.stringMatching(/Whoever submitted a Google review never verifies/) });
    await expect(pg.query(`insert into incentive_f_decisions (review_id, kind, reason, created_by_id, created_by_name) values ($1, 'needs-review', 'x', $2, 'superVerifier')`, [own, who.superVerifier])).rejects.toThrow(/never verifies, links or attributes it/);
    // The right removed while the page is open: the next action is refused with the message, nothing recorded.
    await pg.query(`update field_permission_grants set allowed = false where subject_id = $1 and field_key = 'incentive.f.verify'`, [who.superVerifier]);
    expect(await decide("superVerifier", { kind: "needs-review", reviewId: own, reason: "x" })).toEqual({ ok: false, error: expect.stringMatching(denied.verify) });
    await pg.query(`update field_permission_grants set allowed = true where subject_id = $1 and field_key = 'incentive.f.verify'`, [who.superVerifier]);
    // …and the admin flag removed: refused too, with its own message.
    ADMINS.delete("superVerifier");
    expect(await decide("superVerifier", { kind: "needs-review", reviewId: own, reason: "x" })).toEqual({ ok: false, error: expect.stringMatching(/Only an administrator/) });
    ADMINS.add("superVerifier");
    expect(await q1(`select count(*)::int n from incentive_f_decisions where review_id = any($1)`, [[sa, oa, own]])).toEqual([{ n: 2 }]);
    // The submission form's permission: an earlier publication month needs "Log activity for an earlier month"; removed
    // after the page opened, the submission is refused with that message and nothing is registered.
    await pg.query(`update field_permission_grants set allowed = false where subject_id = $1 and field_key = 'incentive.activity.anyMonth'`, [who.rep3]);
    expect(await submit("rep3", { url: LINK("REVOKEDAAAAA"), publishedOn: "2026-06-14" })).toEqual({ ok: false, error: expect.stringMatching(/needs the “Incentive Tracker — Log activity for an earlier month” permission/) });
    await pg.query(`update field_permission_grants set allowed = true where subject_id = $1 and field_key = 'incentive.activity.anyMonth'`, [who.rep3]);
    expect(await q1(`select count(*)::int n from incentive_f_submissions where submitted_url = $1`, [LINK("REVOKEDAAAAA")])).toEqual([{ n: 0 }]);
  });
  it("attribution follows the priority: named → the customer's assigned salesperson → a confirmed claim; several named → Admin Review; never split", async () => {
    expect(await verify("verifier", r2, { publishedOn: "2026-10-08", customer: cust })).toMatchObject({ ok: true }); // nobody named, Cust A → rep2
    expect(await verify("verifier", r3, { publishedOn: "2026-10-08" })).toMatchObject({ ok: true }); // nobody, no customer → claim
    expect(await verify("verifier2", r4, { publishedOn: "2026-10-08", named: ["rep", "rep2"] })).toMatchObject({ ok: true }); // two named
    expect(await verify("verifier", r5, { publishedOn: "2026-09-20", named: ["rep"] })).toMatchObject({ ok: true }); // September
    expect(await verify("verifier", low, { publishedOn: "2026-10-08", rating: 4, named: ["rep"] })).toMatchObject({ ok: true }); // 4★
    // Wrong attributions are refused (service and database).
    expect(await decide("verifier", { kind: "attribute", reviewId: r2, reason: "x", creditedEmployeeId: who.rep3, basis: "assigned" })).toEqual({ ok: false, error: expect.stringMatching(/isn't the customer's assigned salesperson/) });
    expect(await decide("verifier", { kind: "attribute", reviewId: r2, reason: "x", creditedEmployeeId: who.rep3, basis: "claim" })).toEqual({ ok: false, error: expect.stringMatching(/A claim is confirmed only when/) });
    expect(await decide("verifier", { kind: "attribute", reviewId: r1, reason: "x", creditedEmployeeId: who.rep2, basis: "named" })).toEqual({ ok: false, error: expect.stringMatching(/attributed to one of those named/) });
    expect(await decide("verifier", { kind: "attribute", reviewId: r3, reason: "x", creditedEmployeeId: who.rep3, basis: "named" })).toEqual({ ok: false, error: expect.stringMatching(/names nobody/) });
    expect(await decide("verifier", { kind: "attribute", reviewId: r3, reason: "x", creditedEmployeeId: who.verifier, basis: "claim" })).toEqual({ ok: false, error: expect.stringMatching(/Nobody attributes a review to themselves/) });
    // Before the claim and the choice among the named: both reviews are held.
    expect(await calcF(OCT)).toMatchObject({ ok: true });
    const held = await one<{ result: { held: { message: string }[]; settled: boolean } }>(`select r.result from incentive_calc_runs r join incentive_calc_periods p on p.current_run_id = r.id where p.program_id = $1 and p.category_code = 'F' and p.month = $2`, [programId, OCT]);
    // (The held items are in review-id order, which is random here: each is checked on its own.)
    const heldText = held.result.held.map((x) => x.message).join(" ");
    expect(heldText).toMatch(/names 2 salespeople: held for Admin Review/);
    expect(heldText).toMatch(/names nobody and its customer has no assigned salesperson/);
    expect(await decide("verifier", { kind: "attribute", reviewId: r3, reason: "The salesperson's own customer (claim confirmed)", creditedEmployeeId: who.rep3, basis: "claim" })).toMatchObject({ ok: true });
    expect(await decide("verifier2", { kind: "attribute", reviewId: r4, reason: "rep2 handled the visit", creditedEmployeeId: who.rep2, basis: "named" })).toMatchObject({ ok: true });
  });
  it("October: F.1 ₹100, doubled (F.4) when it appreciates the named salesperson; ₹100 for the assigned one and for a claim; a 4★ review earns nothing; September's review isn't in October", async () => {
    expect(await calcF(OCT)).toMatchObject({ ok: true, adopted: true });
    expect(await payable(OCT)).toEqual({ rep: RS(200), rep2: RS(100 + 200), rep3: RS(100) });
    const run = await one<{ result: { excluded: { message: string }[] } }>(`select r.result from incentive_calc_runs r join incentive_calc_periods p on p.current_run_id = r.id where p.program_id = $1 and p.category_code = 'F' and p.month = $2`, [programId, OCT]);
    expect(run.result.excluded.map((x) => x.message).join(" ")).toMatch(/4★, below the lowest rating that earns \(5★\)/);
    expect(await calcF(SEP)).toMatchObject({ ok: true });
    expect(await payable(SEP)).toEqual({ rep: RS(200) });
  });
  it("September — F.2 email and F.3 letterhead: registered once across employees AND types; verified only with the customer, its identity and all three findings; ₹100 / ₹150, doubled by F.4", async () => {
    const MAIL = "https://files.example.test/sep/thanks-mail.eml";
    const COPY = "https://files.example.test/sep/thanks-mail-copy.eml";
    const LETTER = "https://files.example.test/sep/appreciation-letter.pdf";
    const UNVERIFIED = "https://files.example.test/sep/unverified.pdf";
    expect(await submitDoc("rep", { kind: "email", url: MAIL, dated: "2026-09-12", text: "Thank you rep for the quick support" })).toEqual({ ok: true });
    // The same email submitted by another salesperson as a LETTERHEAD testimonial: the same testimonial — a duplicate.
    expect(await submitDoc("rep2", { kind: "letterhead", url: `${MAIL}#copy`, dated: "2026-09-12" })).toEqual({ ok: true });
    expect(await submitDoc("rep3", { kind: "letterhead", url: LETTER, dated: "2026-09-15" })).toEqual({ ok: true });
    // The same email re-uploaded under ANOTHER link: registered, then caught at verification by its identity.
    expect(await submitDoc("rep2", { kind: "email", url: COPY, dated: "2026-09-12" })).toEqual({ ok: true });
    expect(await submitDoc("rep3", { kind: "letterhead", url: UNVERIFIED, dated: "2026-09-16" })).toEqual({ ok: true });
    const states = await q1<{ s: string; n: string; k: string }>(`select link_state s, submitted_by_name n, claimed_kind k from incentive_f_submissions where submitted_url like 'https://files.example.test/sep/%' order by created_at`);
    expect(states.map((x) => `${x.n}:${x.k}:${x.s}`)).toEqual(["rep:email:new", "rep2:letterhead:duplicate", "rep3:letterhead:new", "rep2:email:new", "rep3:letterhead:new"]);
    const [mail, copy, letter] = (await Promise.all([MAIL, COPY, LETTER].map((u) => reviewOf(u)))) as [string, string, string];
    // What the verifier reads off the email: its Message-ID, its sender and its subject (0139 derives the identity).
    const MAIL_ID: Evidence = { messageId: "<CA+thanks-123@cust-a.example>", sender: "Cust A Accounts <accounts@cust-a.example>", subject: "Thank you for the quick support" };
    // Never verified without its customer, all three findings or what identifies it — an uploaded document alone never earns.
    expect(await verify("verifier", mail, { kind: "email", publishedOn: "2026-09-12", named: ["rep"], evidence: MAIL_ID })).toEqual({ ok: false, error: expect.stringMatching(/Choose the customer the email comes from/) });
    expect(await verify("verifier", mail, { kind: "email", publishedOn: "2026-09-12", named: ["rep"], customer: cust, evidence: MAIL_ID, findings: [true, false, true] })).toEqual({ ok: false, error: expect.stringMatching(/Verify all three before recording it: the email is genuinely from the customer, it is an email testimonial/) });
    expect(await verify("verifier", letter, { kind: "letterhead", publishedOn: "2026-09-15", customer: cust, evidence: { reference: "ref 1" }, findings: [false, true, true] })).toEqual({ ok: false, error: expect.stringMatching(/the letterhead is the customer's/) });
    expect(await verify("verifier", mail, { kind: "email", publishedOn: "2026-09-12", named: ["rep"], customer: cust, evidence: { ...MAIL_ID, sender: " " } })).toEqual({ ok: false, error: expect.stringMatching(/Record the sender's email address/) });
    expect(await verify("verifier", mail, { kind: "email", publishedOn: "2026-09-12", named: ["rep"], customer: cust, evidence: { ...MAIL_ID, subject: null } })).toEqual({ ok: false, error: expect.stringMatching(/Record the email's subject/) });
    expect(await verify("verifier", mail, { kind: "email", publishedOn: "2026-09-12", named: ["rep"], customer: cust, evidence: { ...MAIL_ID, messageId: "not a message id" } })).toEqual({ ok: false, error: expect.stringMatching(/isn't an email Message-ID/) });
    // …and the database refuses the same whatever the code does: a rating on an email, missing findings, no customer
    // (each with a well-formed 0139 identity, so only the rule under test can refuse it).
    const fp = (s: string) => `email:${createHash("sha256").update(s).digest("hex")}`;
    const raw = (rating: number | null, found: boolean, customer: string | null, key: string) =>
      pg.query(`insert into incentive_f_decisions (review_id, kind, testimonial_kind, rating, published_on, review_month, evidence_key, evidence_fingerprint, confirmed_from_customer, confirmed_type, confirmed_genuine, customer_master_id, reason, created_by_name) values ($1, 'verify', 'email', $2, '2026-09-12', '2026-09-01', $3, $3, $4, $4, $4, $5, 'x', 'x')`, [mail, rating, key, found, customer]);
    await expect(raw(5, true, cust, fp("k-rating"))).rejects.toThrow(/incentive_f_decisions_verify_check/);
    await expect(raw(null, false, cust, fp("k-findings"))).rejects.toThrow(/incentive_f_decisions_verify_check/);
    await expect(raw(null, true, null, fp("k-customer"))).rejects.toThrow(/verified against its customer/);
    // 0139: an email verified without a derived identity, or with a Message-ID not matching its key, is refused too.
    await expect(pg.query(`insert into incentive_f_decisions (review_id, kind, testimonial_kind, published_on, review_month, evidence_key, confirmed_from_customer, confirmed_type, confirmed_genuine, customer_master_id, reason, created_by_name) values ($1, 'verify', 'email', '2026-09-12', '2026-09-01', 'free text key', true, true, true, $2, 'x', 'x')`, [mail, cust])).rejects.toThrow(/incentive_f_decisions_identity_check/);
    await expect(pg.query(`insert into incentive_f_decisions (review_id, kind, testimonial_kind, published_on, review_month, evidence_key, evidence_message_id, evidence_fingerprint, confirmed_from_customer, confirmed_type, confirmed_genuine, customer_master_id, reason, created_by_name) values ($1, 'verify', 'email', '2026-09-12', '2026-09-01', $2, 'Other@X.example', $2, true, true, true, $3, 'x', 'x')`, [mail, fp("k-mid"), cust])).rejects.toThrow(/incentive_f_decisions_identity_check/);
    // Verified: it appreciates rep by name (F.4). Its identity is the Message-ID; its fingerprint is always recorded.
    expect(await verify("verifier", mail, { kind: "email", publishedOn: "2026-09-12", named: ["rep"], customer: cust, evidence: MAIL_ID })).toMatchObject({ ok: true });
    const mailId = await one<{ k: string; m: string; f: string }>(`select evidence_key k, evidence_message_id m, evidence_fingerprint f from incentive_f_decisions where review_id = $1 and kind = 'verify' and retired_at is null`, [mail]);
    expect(mailId).toMatchObject({ k: "email:mid:ca+thanks-123@cust-a.example", m: "ca+thanks-123@cust-a.example", f: expect.stringMatching(/^email:[0-9a-f]{64}$/) });
    // The re-uploaded copy is the SAME email entered the other way — by its sender, date and subject only (no Message-ID),
    // in other case and spacing, with a reply prefix: the same fingerprint. Refused, and held for Admin Review (fail closed).
    expect(await verify("verifier2", copy, { kind: "email", publishedOn: "2026-09-12", named: ["rep2"], customer: cust, evidence: { sender: "ACCOUNTS@CUST-A.EXAMPLE", subject: "RE:  thank you for the QUICK support " } })).toEqual({ ok: false, error: expect.stringMatching(/already verified \(the same email or letter.*It is held for Admin Review: a possible duplicate is never verified\./) });
    expect(await q1(`select kind, created_by_name n from incentive_f_decisions where review_id = $1 and retired_at is null`, [copy])).toEqual([{ kind: "needs-review", n: "verifier2" }]);
    // The database refuses the same whatever the code does (on a review with no verdict yet, so only the identity can
    // refuse it): the same fingerprint under another key, or the same Message-ID, verified again.
    const rawOn = (review: string, key: string, mid: string | null, fingerprint: string) =>
      pg.query(`insert into incentive_f_decisions (review_id, kind, testimonial_kind, published_on, review_month, evidence_key, evidence_message_id, evidence_fingerprint, confirmed_from_customer, confirmed_type, confirmed_genuine, customer_master_id, reason, created_by_name) values ($1, 'verify', 'email', '2026-09-12', '2026-09-01', $2, $3, $4, true, true, true, $5, 'x', 'x')`, [review, key, mid, fingerprint, cust]);
    await expect(rawOn(letter, "email:mid:other-id@cust-a.example", "other-id@cust-a.example", mailId.f)).rejects.toThrow(/incentive_f_decisions_fingerprint_uq/);
    await expect(rawOn(letter, `email:mid:${mailId.m}`, mailId.m, fp("another subject"))).rejects.toThrow(/incentive_f_decisions_(message_id|evidence_key)_uq/);
    // The letter names no salesperson: Cust A's assigned salesperson (rep2) is credited; it appreciates a team member
    // (rep3) by name — F.4 applies to the credited salesperson's reward. Its identity: customer + reference.
    expect(await verify("verifier", letter, { kind: "letterhead", publishedOn: "2026-09-15", customer: cust, appreciated: ["rep3"], evidence: { reference: "CA / 2026-77" } })).toMatchObject({ ok: true });
    expect((await one<{ k: string }>(`select evidence_key k from incentive_f_decisions where review_id = $1 and kind = 'verify'`, [letter])).k).toBe(`letter:ref:${cust}:ca/2026/77`);
    expect(await calcF(SEP)).toMatchObject({ ok: true });
    // rep: the Google review (₹100 × 2) + the email (₹100 × 2); rep2: the letter (₹150 × 2). The unverified letter: nothing.
    expect(await payable(SEP)).toEqual({ rep: RS(200 + 200), rep2: RS(300) });
    const lines = await q1<{ line_code: string; employee_id: string }>(`select i.line_code, i.employee_id from incentive_calc_items i join incentive_calc_periods p on p.current_run_id = i.run_id where p.program_id = $1 and p.category_code = 'F' and p.month = $2 order by i.line_code`, [programId, SEP]);
    expect(lines.map((l) => l.line_code)).toEqual(["F.1", "F.2", "F.3"]);
    expect(lines.find((l) => l.line_code === "F.3")!.employee_id).toBe(who.rep2);
  });
  it("0139: the same letter by its reference written another way, or another letter from the same customer on the same date, is never verified — held for Admin Review", async () => {
    const AGAIN = "https://files.example.test/sep/letter-again.pdf";
    const NOREF = "https://files.example.test/sep/letter-noref.pdf";
    expect(await submitDoc("rep2", { kind: "letterhead", url: AGAIN, dated: "2026-09-15" })).toEqual({ ok: true });
    expect(await submitDoc("rep", { kind: "letterhead", url: NOREF, dated: "2026-09-15" })).toEqual({ ok: true });
    const [again, noref] = (await Promise.all([AGAIN, NOREF].map((u) => reviewOf(u)))) as [string, string];
    // "ca-2026-77" is "CA / 2026-77" (verified above) with other separators: the same reference of the same customer.
    expect(await verify("verifier2", again, { kind: "letterhead", publishedOn: "2026-09-16", customer: cust, evidence: { reference: "ca-2026-77" } })).toEqual({ ok: false, error: expect.stringMatching(/already verified \(the same email or letter.*held for Admin Review/) });
    // No reference: the customer and date are all that identify it — the same as the verified letter's. Fail closed.
    expect(await verify("verifier2", noref, { kind: "letterhead", publishedOn: "2026-09-15", customer: cust, evidence: { reference: null } })).toEqual({ ok: false, error: expect.stringMatching(/already verified \(the same email or letter.*held for Admin Review/) });
    expect(await q1(`select kind from incentive_f_decisions where review_id in ($1, $2) and retired_at is null order by kind`, [again, noref])).toEqual([{ kind: "needs-review" }, { kind: "needs-review" }]);
    // September's amounts are unchanged: a held testimonial earns nothing.
    expect(await calcF(SEP)).toMatchObject({ ok: true });
    expect(await payable(SEP)).toEqual({ rep: RS(200 + 200), rep2: RS(300) });
  });
  it("whoever decided a review of the month never approves it (service and database); another approver can; then it is paid", async () => {
    signIn("locker");
    expect(await act.setCategoryAMonthLocked({ programId, month: OCT, lock: true, rowVersion: Number((await per(OCT)).row_version), category: "F" })).toMatchObject({ ok: true });
    expect(await act.submitCategoryAMonth({ programId, month: OCT, rowVersion: Number((await per(OCT)).row_version), category: "F" })).toMatchObject({ ok: true });
    signIn("verifier");
    expect(await act.decideCategoryAMonth({ programId, month: OCT, rowVersion: Number((await per(OCT)).row_version), decision: "approve", reason: null, category: "F" })).toEqual({ ok: false, error: expect.stringMatching(/You verified, attributed or invalidated a Google review of this month/) });
    const p = await per(OCT);
    await expect(pg.query(`insert into incentive_calc_approvals (period_id, run_id, submission_no, step_no, decision, actor_id, actor_name) values ($1, $2, 1, 1, 'approve', $3, 'verifier')`, [p.id, p.current_run_id, who.verifier])).rejects.toThrow(/never approves or rejects that month/);
    signIn("a1");
    expect(await act.decideCategoryAMonth({ programId, month: OCT, rowVersion: Number((await per(OCT)).row_version), decision: "approve", reason: null, category: "F" })).toMatchObject({ ok: true, status: "approved" });
    const q = await per(OCT);
    signIn("payer");
    expect(await act.recordCategoryAPayout({ programId, month: OCT, rowVersion: Number(q.row_version), reference: "PAY-F-OCT", paidOn: q.release_on!, amountPaise: RS(600), note: null, category: "F" })).toMatchObject({ ok: true });
  });
});

describe("after payout: a late review, an invalidation, recovery and its write-off", () => {
  it("a review published in paid October and verified later: October never changes; the difference is carried into November", async () => {
    expect(await submit("rep3", { url: LINK("LATEAAAAAAAA"), publishedOn: "2026-10-20" })).toEqual({ ok: true });
    expect(await verify("verifier2", await reviewOf(LINK("LATEAAAAAAAA")), { publishedOn: "2026-10-20", named: ["rep3"] })).toMatchObject({ ok: true });
    const before = await payable(OCT);
    expect(await calcF(OCT)).toMatchObject({ ok: true, adopted: false });
    expect(await payable(OCT)).toEqual(before);
    expect(await q1(`select employee_name, kind, to_month::text t, amount_paise::int a from incentive_calc_adjustments where program_id = $1 and category_code = 'F' order by created_at`, [programId])).toEqual([{ employee_name: "rep3", kind: "recalc-difference", t: NOV, a: RS(200) }]);
  });
  it("an invalidation needs a reason and evidence, and a SECOND person; once approved, the paid month is recovered from the next month — once, however often it is recalculated", async () => {
    const r1 = await reviewOf(LINK("R1AAAAAAAAAA"));
    for (const k of ["verifier", "rep"] as const) {
      signIn(k);
      expect(await act.requestCategoryFInvalidation({ reviewId: r1, reason: "Deleted", evidenceUrl: "https://files.example.test/gone.png" })).toEqual({ ok: false, error: expect.stringMatching(k === "rep" ? /Only an administrator/ : /Invalidate a Category F review or testimonial” permission/) });
    }
    signIn("inval1");
    expect(await act.requestCategoryFInvalidation({ reviewId: r1, reason: "The review was deleted", evidenceUrl: "" })).toEqual({ ok: false, error: expect.stringMatching(/Give the evidence/) });
    const req = await act.requestCategoryFInvalidation({ reviewId: r1, reason: "The review was deleted by its author", evidenceUrl: "https://files.example.test/gone.png" });
    expect(req).toMatchObject({ ok: true });
    expect(await act.requestCategoryFInvalidation({ reviewId: r1, reason: "again", evidenceUrl: "x" })).toEqual({ ok: false, error: expect.stringMatching(/already awaits its second approval/) });
    expect(await act.decideCategoryFInvalidation({ requestId: (req as { id: string }).id, decision: "approve", reason: "self" })).toEqual({ ok: false, error: expect.stringMatching(/a second person approves or refuses it/) });
    signIn("inval2");
    expect(await act.decideCategoryFInvalidation({ requestId: (req as { id: string }).id, decision: "approve", reason: "Confirmed: no longer on Google" })).toMatchObject({ ok: true, reviewMonth: OCT });
    const before = await payable(OCT);
    expect(await calcF(OCT)).toMatchObject({ ok: true, adopted: false });
    expect(await calcF(OCT, "2026-11-20")).toMatchObject({ ok: true }); // recalculated again: nothing more is carried
    expect(await payable(OCT)).toEqual(before);
    const adj = await q1<{ n: string; a: number }>(`select employee_name n, amount_paise::int a from incentive_calc_adjustments where program_id = $1 and category_code = 'F' and to_month = $2 order by created_at`, [programId, NOV]);
    expect(adj).toEqual([{ n: "rep3", a: RS(200) }, { n: "rep", a: -RS(200) }]);
    // Invalidation decisions are permanent.
    const d = await one<{ id: string }>(`select id from incentive_f_decisions where review_id = $1 and kind = 'invalidate-approve'`, [r1]);
    await expect(pg.query(`update incentive_f_decisions set retired_at = now(), retired_reason = 'undo' where id = $1`, [d.id])).rejects.toThrow(/never changes/);
  });
  it("a recovery that can't be made is written off only with incentive.f.writeOff, a reason and a SECOND person; once; never more than the recovery", async () => {
    const target = (await one<{ id: string }>(`select id from incentive_calc_adjustments where program_id = $1 and category_code = 'F' and amount_paise < 0`, [programId])).id;
    signIn("payer");
    expect(await act.requestCategoryFWriteOff({ adjustmentId: target, amountPaise: RS(200), reason: "x", evidenceUrl: null })).toEqual({ ok: false, error: expect.stringMatching(/Write off a Category F recovery” permission/) });
    signIn("wo1");
    expect(await act.requestCategoryFWriteOff({ adjustmentId: target, amountPaise: RS(250), reason: "too much", evidenceUrl: null })).toEqual({ ok: false, error: expect.stringMatching(/never exceeds the recovery/) });
    const req = await act.requestCategoryFWriteOff({ adjustmentId: target, amountPaise: RS(200), reason: "The salesperson left; nothing to recover from", evidenceUrl: "HR exit letter" });
    expect(req).toEqual({ ok: true, id: expect.any(String) });
    expect(await act.decideCategoryFWriteOff({ requestId: (req as { id: string }).id, decision: "approve", reason: "self" })).toEqual({ ok: false, error: expect.stringMatching(/a second person approves or refuses it/) });
    signIn("wo2");
    expect(await act.decideCategoryFWriteOff({ requestId: (req as { id: string }).id, decision: "approve", reason: "Approved write-off" })).toMatchObject({ ok: true });
    expect(await q1(`select kind, amount_paise::int a, to_month::text t from incentive_calc_adjustments where kind = 'recovery-write-off'`)).toEqual([{ kind: "recovery-write-off", a: RS(200), t: NOV }]);
    signIn("wo1");
    expect(await act.requestCategoryFWriteOff({ adjustmentId: target, amountPaise: RS(1), reason: "again", evidenceUrl: null })).toEqual({ ok: false, error: expect.stringMatching(/already written off/) });
    await expect(pg.query(`delete from incentive_f_writeoffs`)).rejects.toThrow(/append-only/);
    // 0139: every request and decision is in the input history too — the employee, the recovery and the testimonial
    // behind it, the amount, the reason, the request it answers, who and when; refusals leave nothing there.
    const hist = await q1<{ actor_name: string; note: string; after: Record<string, unknown> }>(`select actor_name, note, after from incentive_calc_input_history where entity = 'f-writeoff' order by event_no`);
    expect(hist.map((x) => [x.actor_name, x.after.kind, x.note])).toEqual([
      ["wo1", "request", "The salesperson left; nothing to recover from"],
      ["wo2", "approve", "Approved write-off"],
    ]);
    const r1 = await reviewOf(LINK("R1AAAAAAAAAA"));
    expect(hist[0]!.after).toMatchObject({ requestId: null, recoveryAdjustmentId: target, writeOffAdjustmentId: null, employeeId: who.rep, employeeName: "rep", amountPaise: RS(200), recoveryPaise: -RS(200), fromMonth: OCT, toMonth: NOV, evidenceUrl: "HR exit letter", testimonials: [{ reviewId: r1, line: "F.1", label: expect.any(String) }], at: expect.any(String) });
    expect(hist[1]!.after).toMatchObject({ requestId: (req as { id: string }).id, writeOffAdjustmentId: expect.any(String), amountPaise: RS(200), testimonials: [{ reviewId: r1, line: "F.1", label: expect.any(String) }] });
    // …and that history is never edited or deleted.
    await expect(pg.query(`update incentive_calc_input_history set note = 'edited' where entity = 'f-writeoff'`)).rejects.toThrow(/append-only/);
    await expect(pg.query(`delete from incentive_calc_input_history where entity = 'f-writeoff'`)).rejects.toThrow(/append-only/);
    // November: rep's −₹200 recovery and the +₹200 write-off cancel; rep3's ₹200 late review is paid.
    expect(await calcF(NOV)).toMatchObject({ ok: true });
    const lines = await calc.payoutLines(h.db as never, programId, NOV, (await per(NOV)).current_run_id, "F");
    expect(Object.fromEntries(lines.map((l) => [l.employeeName, l.amountPaise]))).toEqual({ rep: 0, rep3: RS(200) });
  });
  it("a later configuration (4★ allowed from November) is never retroactive: paid October keeps its own version and settings; November uses the new one", async () => {
    const runOf = async (month: string) => one<{ no: number; v: string }>(`select r.config_version_no no, r.config_version_id v from incentive_calc_runs r join incentive_calc_periods p on p.current_run_id = r.id where p.program_id = $1 and p.category_code = 'F' and p.month = $2`, [programId, month]);
    const octBefore = await runOf(OCT);
    const adjBefore = await q1(`select id from incentive_calc_adjustments where program_id = $1 and category_code = 'F' order by id`, [programId]);
    await publishF({ "f.minRating": 4 }, NOV);
    // Recalculating paid October: still the version in force for October (5★ only), so the 4★ review still earns nothing
    // and nothing new is carried.
    expect(await calcF(OCT, "2026-11-21")).toMatchObject({ ok: true, adopted: false });
    const latestOct = await one<{ no: number; excluded: string }>(`select config_version_no no, result->'excluded' #>> '{}' excluded from incentive_calc_runs where program_id = $1 and category_code = 'F' and month = $2 order by computed_at desc limit 1`, [programId, OCT]);
    expect(latestOct.no).toBe(octBefore.no);
    expect(latestOct.excluded).toMatch(/4★, below the lowest rating that earns \(5★\)/);
    expect(await runOf(OCT)).toEqual(octBefore);
    expect(await q1(`select id from incentive_calc_adjustments where program_id = $1 and category_code = 'F' order by id`, [programId])).toEqual(adjBefore);
    expect(await calcF(NOV, "2026-11-21")).toMatchObject({ ok: true });
    expect((await runOf(NOV)).no).toBe(octBefore.no + 1);
  });
});

describe("employee deletion (D3) and the old engine after the cut-over", () => {
  it("deleting an employee keeps their testimonials and decisions, with their name; the old engine and the queue still work", async () => {
    expect(await submitDoc("leaver", { kind: "email", url: "https://files.example.test/leaver-aug.eml", dated: "2026-08-20", periodMonth: "2026-08" })).toEqual({ ok: true });
    await pg.query(`delete from field_permission_grants where subject_id = $1`, [who.leaver]);
    await pg.query(`delete from employees where id = $1`, [who.leaver]);
    expect(await q1(`select employee_id, employee_name from testimonials where employee_name = 'leaver' order by period_month`)).toEqual([{ employee_id: null, employee_name: "leaver" }, { employee_id: null, employee_name: "leaver" }]);
    const { getPendingSubmissions } = await import("@/lib/queries/incentives");
    expect((await getPendingSubmissions()).filter((x) => x.queue === "testimonial").map((x) => x.employeeName)).toContain("leaver");
    signIn("verifier");
    expect(await activity.recomputePeriod({ period: "2026-08" })).toMatchObject({ ok: true });
  });
  it("from the cut-over month the old engine pays no Category F (approved or not); earlier months stay as they were", async () => {
    signIn("rep2");
    expect(await activity.submitTestimonial({ kind: "email", wordCount: 60, namesTeamMember: false, periodMonth: "2026-10", evidenceUrl: "https://files.example.test/oct.eml", publishedOn: "2026-10-02" })).toEqual({ ok: false, error: expect.stringMatching(/Category F for 2026-10 is already locked/) });
    expect(await activity.submitTestimonial({ kind: "email", wordCount: 60, namesTeamMember: false, periodMonth: "2026-11", evidenceUrl: "https://files.example.test/nov.eml", publishedOn: "2026-11-02" })).toEqual({ ok: true });
    const t = await one<{ id: string }>(`select id from testimonials where employee_id = $1 and period_month = '2026-11'`, [who.rep2]);
    signIn("verifier");
    expect(await activity.reviewSubmission({ queue: "testimonial", id: t.id, decision: "approved" })).toEqual({ ok: true });
    expect(await q1(`select l.amount_paise from incentive_ledger l join incentive_periods p on p.id = l.period_id where l.employee_id = $1 and l.category = 'F' and p.month = '2026-11'`, [who.rep2])).toEqual([]);
    expect((await q1(`select l.amount_paise from incentive_ledger l join incentive_periods p on p.id = l.period_id where l.employee_id = $1 and l.category = 'F' and p.month = '2026-08'`, [who.rep])).length).toBe(1);
    // …and an UNVERIFIED email or letterhead earns nothing in the new Category F (F.2 / F.3 earn only once a verifier has
    // checked them): November's results have only the verified Google review.
    expect(await calcF(NOV)).toMatchObject({ ok: true });
    const items = await q1<{ label: string }>(`select i.label from incentive_calc_items i join incentive_calc_periods p on p.current_run_id = i.run_id where p.program_id = $1 and p.category_code = 'F' and p.month = $2`, [programId, NOV]);
    expect(items.every((i) => i.label.startsWith("Google review"))).toBe(true);
  });
});

describe("Category F safeguards: cut-over, reasons and paid-month immutability", () => {
  it("publishing Category F from a month the OLD engine has already paid with Category F amounts is refused; a later month is allowed", async () => {
    // The old engine paid August 2026 including a Category F amount (rep's approved review, earlier in this file).
    const f = await q1<{ n: number }>(`select count(*)::int n from incentive_ledger l join incentive_periods p on p.id = l.period_id where p.month = '2026-08' and l.category = 'F' and l.amount_paise <> 0`);
    expect(f[0]!.n).toBeGreaterThan(0);
    await pg.query(`update incentive_periods set status = 'paid' where month = '2026-08'`);
    await expect(publishF({}, "2026-08-01", ["leaver"])).rejects.toThrow(/The old engine's Category F is already paid for 2026-08\. Publishing Category F from 2026-08 would pay Category F twice/);
    // A later month passes the cut-over safeguard (and every other publication rule).
    await expect(publishF({}, "2027-01-01", ["leaver"])).resolves.toBeUndefined();
    await pg.query(`update incentive_periods set status = 'open' where month = '2026-08'`);
  });
  it("invalidation and write-off requests and decisions are refused without a reason", async () => {
    const someId = "00000000-0000-4000-8000-0000000000f1";
    signIn("inval1");
    expect(await act.requestCategoryFInvalidation({ reviewId: someId, reason: "   ", evidenceUrl: "https://files.example.test/x.png" })).toEqual({ ok: false, error: expect.stringMatching(/Give the reason/) });
    expect(await act.decideCategoryFInvalidation({ requestId: someId, decision: "approve", reason: "" })).toEqual({ ok: false, error: expect.stringMatching(/Give the reason/) });
    signIn("wo1");
    expect(await act.requestCategoryFWriteOff({ adjustmentId: someId, amountPaise: 100, reason: " ", evidenceUrl: null })).toEqual({ ok: false, error: expect.stringMatching(/Give the reason/) });
    expect(await act.decideCategoryFWriteOff({ requestId: someId, decision: "refuse", reason: "" })).toEqual({ ok: false, error: expect.stringMatching(/Give the reason/) });
  });
  it("a paid Category F month can't be changed, even directly in the database", async () => {
    const p = await per(OCT);
    expect(p.status).toBe("paid");
    await expect(pg.query(`update incentive_calc_periods set status = 'open' where id = $1`, [p.id])).rejects.toThrow(/A paid incentive month is final/);
    await expect(pg.query(`delete from incentive_calc_payouts where period_id = $1`, [p.id])).rejects.toThrow(/append-only/);
  });
});

describe("My Activity: an employee's own Category F verification state (0139)", () => {
  it("shows only the employee's OWN submissions, each with its state and a standard explanation — nothing internal, nothing of anyone else", async () => {
    const { myFTestimonials } = await import("@/lib/queries/incentive-f-review");
    const mine = async (k: Who) => (await myFTestimonials(who[k])).rows;
    const own = async (k: Who) => (await one<{ n: number }>(`select count(*)::int n from incentive_f_submissions where submitted_by_id = $1`, [who[k]])).n;
    const rep = await mine("rep");
    const rep2 = await mine("rep2");
    expect(rep.length).toBe(await own("rep"));
    expect(rep2.length).toBe(await own("rep2"));
    // Every row is one of the employee's own submissions.
    const ids = async (k: Who) => (await q1<{ id: string }>(`select id from incentive_f_submissions where submitted_by_id = $1`, [who[k]])).map((r) => r.id).sort();
    expect(rep.map((r) => r.submissionId).sort()).toEqual(await ids("rep"));
    expect(rep2.map((r) => r.submissionId).sort()).toEqual(await ids("rep2"));
    const sub = async (url: string) => (await one<{ id: string }>(`select id from incentive_f_submissions where submitted_url = $1`, [url])).id;
    const row = (rows: typeof rep, id: string) => rows.find((r) => r.submissionId === id)!;
    // rep: the September email — verified, counted in September, with appreciation by name (not who).
    expect(row(rep, await sub("https://files.example.test/sep/thanks-mail.eml"))).toMatchObject({ kind: "email", ownDate: "2026-09-12", status: "verified", countsIn: "2026-09", appreciation: true });
    // rep: the October review a second person invalidated after payment.
    expect(row(rep, await sub(LINK("R1AAAAAAAAAA")))).toMatchObject({ kind: "google_review", status: "invalidated", explanation: expect.stringMatching(/recovered from later months/) });
    // rep: the letter held as a possible duplicate (0139).
    expect(row(rep, await sub("https://files.example.test/sep/letter-noref.pdf"))).toMatchObject({ kind: "letterhead", status: "on-hold" });
    // rep2: the same review as rep's — shown as a DUPLICATE, never with the original's (rep's) invalidated state.
    expect(row(rep2, await sub(`${LINK("R1AAAAAAAAAA")}?hl=en&utm_source=x`))).toMatchObject({ status: "duplicate", countsIn: null, appreciation: null });
    // Nothing internal: no reviewer, reason, evidence link, credited or appreciated person, other employee's name.
    const shown = JSON.stringify([...rep, ...rep2]);
    for (const secret of ["verifier", "inval1", "inval2", "wo1", "wo2", "Checked the original", "The review was deleted", "files.example.test", "google.com", "Held automatically", who.rep3, "rep3"]) expect(shown).not.toContain(secret);
    expect(Object.keys(rep[0]!).sort()).toEqual(["appreciation", "countsIn", "explanation", "kind", "ownDate", "status", "submissionId", "submittedAt"]);
    // Someone who submitted nothing sees nothing; an id that isn't one is refused quietly.
    expect(await myFTestimonials(who.checker)).toEqual({ ready: true, rows: [] });
    expect(await myFTestimonials("not-an-id")).toEqual({ ready: false, rows: [] });
  });
});
