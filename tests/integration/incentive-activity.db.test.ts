import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite) for logging and reviewing Categories D, E and F activity
// (app/(app)/incentive/actions.ts): the incentive month (current by default; an earlier one only with the Field
// Permission; never a future, locked or paid month, nor one whose category's calculation is past "open"), Google
// reviews recorded with their real rating (the configuration decides at calculation), the admin's award stored as given
// (no fixed limit), and independent review (nobody reviews their own submission). SYNTHETIC data; only the session is mocked.
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | { id: string; email: string; name: string; isActive: boolean; isAdmin: boolean; departmentId: null; role: string } };
});
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (f: unknown) => f, updateTag: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));
vi.mock("@/lib/auth/super-admin", () => ({ SUPER_ADMIN_EMAILS: [], isSuperAdmin: () => false }));
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

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let act: typeof import("@/app/(app)/incentive/actions");
let current = "";
const PEOPLE = ["rep", "backdater", "admin1", "admin2"] as const;
type Who = (typeof PEOPLE)[number];
const who = {} as Record<Who, string>;
const signIn = (k: Who) => {
  h.me = { id: who[k], email: `${k}@example.test`, name: k, isActive: true, isAdmin: k.startsWith("admin"), departmentId: null, role: "both" };
};
const q1 = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await pg.query<T>(sql, params)).rows;
const monthAdd = (m: string, n: number) => {
  const [y, mm] = m.split("-").map(Number);
  return new Date(Date.UTC(y!, mm! - 1 + n, 1)).toISOString().slice(0, 7);
};

beforeAll(async () => {
  const made = await createTestDb({
    employees: schema.employees, departments: schema.departments, employeeDepartments: schema.employeeDepartments, fieldPermissionGrants: schema.fieldPermissionGrants,
    customers: schema.customers, salesOrders: schema.salesOrders, invoices: schema.invoices, receipts: schema.receipts,
    leadBatches: schema.leadBatches, leadConversions: schema.leadConversions, clientMeetings: schema.clientMeetings, testimonials: schema.testimonials,
    incentiveSchemes: schema.incentiveSchemes, ruleVersions: schema.ruleVersions, incentivePeriods: schema.incentivePeriods, incentiveLedger: schema.incentiveLedger, payoutRuns: schema.payoutRuns, incentiveAudit: schema.incentiveAudit,
  });
  pg = made.pg;
  h.db = made.db;
  for (const k of PEOPLE) who[k] = (await q1<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', $3) returning id`, [k, `${k}@example.test`, k.startsWith("admin")]))[0]!.id;
  await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('incentive.activity.anyMonth', 'employee', $1, true)`, [who.backdater]);
  // Incentive Rules (0131, as in production), and a stand-in for the new engine's calculation periods (0132's table,
  // only the columns read here).
  await pg.exec(readFileSync(resolve(__dirname, "../../db/migrations/0131_incentive_rule_config.sql"), "utf8"));
  await pg.exec(`create table incentive_calc_periods (category_code text not null, month date not null, status text not null)`);
  act = await import("@/app/(app)/incentive/actions");
  current = (await import("@/lib/queries/incentives")).currentPeriodIST();
}, 120_000);
afterAll(async () => {
  await pg.close();
});

describe("the incentive month of a submission", () => {
  it("is the current month by default; a future month is refused for everyone", async () => {
    signIn("rep");
    expect(await act.submitLeadBatch({ leadCount: 12, profiled: true })).toEqual({ ok: true });
    expect(await q1(`select period_month from lead_batches where employee_id = $1`, [who.rep])).toEqual([{ period_month: current }]);
    signIn("backdater");
    expect(await act.submitLeadBatch({ leadCount: 12, profiled: true, periodMonth: monthAdd(current, 1) })).toEqual({ ok: false, error: expect.stringMatching(/future month/) });
    expect(await act.submitLeadBatch({ leadCount: 12, profiled: true, periodMonth: "2026-13" })).toEqual({ ok: false, error: expect.stringMatching(/YYYY-MM/) });
  });
  it("an earlier month needs the Field Permission; with it, the submission belongs to that month", async () => {
    const earlier = monthAdd(current, -2);
    signIn("rep");
    expect(await act.submitLeadConversion({ convertedCount: 6, periodMonth: earlier })).toEqual({ ok: false, error: expect.stringMatching(/needs the “Incentive Tracker — Log activity for an earlier month” permission/) });
    expect(await q1(`select count(*)::int n from lead_conversions`)).toEqual([{ n: 0 }]);
    signIn("backdater");
    expect(await act.submitLeadConversion({ convertedCount: 6, periodMonth: earlier })).toEqual({ ok: true });
    expect(await act.submitMeeting({ potentialBand: "high", justification: "Plant visit", periodMonth: earlier })).toEqual({ ok: true });
    expect(await q1(`select period_month from lead_conversions union all select period_month from client_meetings`)).toEqual([{ period_month: earlier }, { period_month: earlier }]);
  });
  it("never into a month the tracker locked or paid, nor one whose category's calculation is past open", async () => {
    const paid = monthAdd(current, -3);
    await pg.query(`insert into incentive_periods (month, status) values ($1, 'paid')`, [paid]);
    signIn("backdater");
    expect(await act.submitMeeting({ potentialBand: "low", justification: "x", periodMonth: paid })).toEqual({ ok: false, error: `${paid} is locked or paid in the Incentive Tracker: nothing can be added to it.` });
    const m = monthAdd(current, -1);
    await pg.query(`insert into incentive_calc_periods values ('F', $1, 'approved'), ('D', $1, 'open')`, [`${m}-01`]);
    expect(await act.submitTestimonial({ kind: "email", wordCount: 80, namesTeamMember: false, periodMonth: m })).toEqual({ ok: false, error: `Category F for ${m} is already locked, submitted, approved or paid: nothing can be added to it.` });
    expect(await act.submitLeadBatch({ leadCount: 10, profiled: true, periodMonth: m })).toEqual({ ok: true }); // D's month is still open
  });
});

describe("Google reviews are recorded as they are", () => {
  it("any 1–5★ rating is kept (the configuration decides at calculation); a Google review without a rating, its public link or its publication date is refused", async () => {
    signIn("rep");
    // 0137: a Google review gives its public link and the date it was published (this month: no permission needed).
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const link = "https://www.google.com/maps/reviews/data=!4m8!14m7!1m6!2m5!1sChActivityTest01!2m1!1s0x0:0xabc";
    expect(await act.submitTestimonial({ kind: "google_review", wordCount: 70, starRating: 4, namesTeamMember: false, reviewUrl: link, publishedOn: today, screenshotUrl: "shot.png" })).toEqual({ ok: true });
    expect(await act.submitTestimonial({ kind: "google_review", wordCount: 70, namesTeamMember: false, reviewUrl: link, publishedOn: today })).toEqual({ ok: false, error: expect.stringMatching(/star rating/) });
    expect(await act.submitTestimonial({ kind: "google_review", wordCount: 70, starRating: 5, namesTeamMember: false, publishedOn: today })).toEqual({ ok: false, error: expect.stringMatching(/public Google review link/) });
    expect(await act.submitTestimonial({ kind: "google_review", wordCount: 70, starRating: 5, namesTeamMember: false, reviewUrl: link })).toEqual({ ok: false, error: expect.stringMatching(/date the review was published/) });
    expect(await q1(`select kind, star_rating from testimonials where employee_id = $1`, [who.rep])).toEqual([{ kind: "google_review", star_rating: 4 }]);
  });
});

describe("independent review", () => {
  it("an admin can't review their own submission; another admin can, with the award as given and an audit record", async () => {
    signIn("admin1");
    expect(await act.submitMeeting({ potentialBand: "high", justification: "Own meeting" })).toEqual({ ok: true });
    const [mine] = await q1<{ id: string }>(`select id from client_meetings where employee_id = $1`, [who.admin1]);
    expect(await act.reviewSubmission({ queue: "meeting", id: mine!.id, decision: "approved", awardedRupees: 800 })).toEqual({ ok: false, error: expect.stringMatching(/can't review your own submission/) });
    expect(await q1(`select review_status, reviewed_by_id from client_meetings where id = $1`, [mine!.id])).toEqual([{ review_status: "pending", reviewed_by_id: null }]);
    signIn("admin2");
    expect(await act.reviewSubmission({ queue: "meeting", id: mine!.id, decision: "approved", awardedRupees: -5 })).toEqual({ ok: false, error: expect.stringMatching(/award in rupees/) });
    // No fixed largest award here: ₹1,500 is stored; the configuration in force keeps it within range at calculation.
    expect(await act.reviewSubmission({ queue: "meeting", id: mine!.id, decision: "approved", awardedRupees: 1500 })).toEqual({ ok: true });
    expect(await q1(`select review_status, reviewed_by_id, awarded_paise::int a from client_meetings where id = $1`, [mine!.id])).toEqual([{ review_status: "approved", reviewed_by_id: who.admin2, a: 150_000 }]);
    expect(await q1(`select actor_id, action, entity_type, employee_id from incentive_audit where entity_id = $1`, [mine!.id])).toEqual([{ actor_id: who.admin2, action: "approved", entity_type: "submission", employee_id: who.admin1 }]);
  });
  it("a meeting's approval states its award: NO award and ₹0 are refused (never stored as ₹0 and paid as the ₹250 smallest award); a positive award is stored; rejecting needs none", async () => {
    signIn("rep");
    expect(await act.submitMeeting({ potentialBand: "low", justification: "Award cases" })).toEqual({ ok: true });
    expect(await act.submitMeeting({ potentialBand: "medium", justification: "Rejected one" })).toEqual({ ok: true });
    const [m, r] = await q1<{ id: string }>(`select id from client_meetings where employee_id = $1 order by created_at`, [who.rep]);
    signIn("admin2");
    // 1. No award configured (a blank box): refused, nothing changes.
    expect(await act.reviewSubmission({ queue: "meeting", id: m!.id, decision: "approved" })).toEqual({ ok: false, error: expect.stringMatching(/Enter the award before approving: no award was given/) });
    // 2. An award explicitly set to ₹0: refused (the current scheme would raise it to its smallest award).
    expect(await act.reviewSubmission({ queue: "meeting", id: m!.id, decision: "approved", awardedRupees: 0 })).toEqual({ ok: false, error: expect.stringMatching(/₹0 isn't an award/) });
    expect(await q1(`select review_status, awarded_paise::int a from client_meetings where id = $1`, [m!.id])).toEqual([{ review_status: "pending", a: 0 }]);
    // 3. A valid positive award: stored as given.
    expect(await act.reviewSubmission({ queue: "meeting", id: m!.id, decision: "approved", awardedRupees: 400 })).toEqual({ ok: true });
    expect(await q1(`select review_status, awarded_paise::int a from client_meetings where id = $1`, [m!.id])).toEqual([{ review_status: "approved", a: 40_000 }]);
    // Rejecting needs no award.
    expect(await act.reviewSubmission({ queue: "meeting", id: r!.id, decision: "rejected", note: "Not a client meeting" })).toEqual({ ok: true });
  });
  it("the same holds for leads, enquiries and reviews; a non-admin can't review at all", async () => {
    const [lead] = await q1<{ id: string }>(`select id from lead_batches where employee_id = $1 limit 1`, [who.rep]);
    signIn("rep");
    await expect(act.reviewSubmission({ queue: "lead_batch", id: lead!.id, decision: "approved" })).rejects.toThrow("Forbidden");
    signIn("admin1");
    expect(await act.reviewSubmission({ queue: "lead_batch", id: lead!.id, decision: "rejected", note: "Duplicate list" })).toEqual({ ok: true });
    expect(await q1(`select review_status, reviewed_by_id from lead_batches where id = $1`, [lead!.id])).toEqual([{ review_status: "rejected", reviewed_by_id: who.admin1 }]);
    expect(await act.reviewSubmission({ queue: "lead_batch", id: "00000000-0000-4000-8000-000000000000", decision: "approved" })).toEqual({ ok: false, error: "That submission no longer exists." });
  });
});

describe("the Control Room's month (old engine): a paid month is final", () => {
  it("acts on the month given; paid only once locked; never paid twice (one payout run); never reopened, unlocked or sent back to review", async () => {
    const m = monthAdd(current, -6);
    const status = async () => (await q1<{ status: string }>(`select status from incentive_periods where month = $1`, [m]))[0]?.status;
    const runs = async () => (await q1<{ n: number }>(`select count(*)::int n from payout_runs r join incentive_periods p on p.id = r.period_id where p.month = $1`, [m]))[0]!.n;
    signIn("rep");
    await expect(act.setPeriodStatus({ period: m, status: "locked" })).rejects.toThrow("Forbidden");
    signIn("admin1");
    expect(await act.setPeriodStatus({ period: "2026-13", status: "locked" })).toEqual({ ok: false, error: "Choose a month." });
    expect(await act.setPeriodStatus({ period: m, status: "paid" })).toEqual({ ok: false, error: "Lock the month before marking it paid." });
    expect(await status()).toBe("open");
    expect(await act.setPeriodStatus({ period: m, status: "review" })).toEqual({ ok: true });
    expect(await act.setPeriodStatus({ period: m, status: "locked" })).toEqual({ ok: true });
    expect(await act.setPeriodStatus({ period: m, status: "paid" })).toEqual({ ok: true });
    expect([await status(), await runs()]).toEqual(["paid", 1]);
    expect(await act.setPeriodStatus({ period: m, status: "paid" })).toEqual({ ok: false, error: expect.stringMatching(/already paid/) });
    for (const to of ["open", "review", "locked"] as const) expect(await act.setPeriodStatus({ period: m, status: to })).toEqual({ ok: false, error: expect.stringMatching(/A paid month is final/) });
    expect([await status(), await runs()]).toEqual(["paid", 1]);
    // The current month was never touched by any of this.
    expect(await q1(`select status from incentive_periods where month = $1`, [current])).not.toEqual([{ status: "paid" }]);
    expect((await q1<{ action: string }>(`select action from incentive_audit where entity_type = 'period' order by created_at`)).map((x) => x.action)).toEqual(["moved-to-review", "locked", "paid"]);
  });
});

describe("a decision on a submission of a month the old engine has settled", () => {
  it("is refused while the month is locked or paid there (it would be silently ignored, or no longer match what was paid); nothing changes", async () => {
    const m = monthAdd(current, -8);
    await pg.query(`insert into incentive_periods (month, status) values ($1, 'paid')`, [m]);
    const lead = (await q1<{ id: string }>(`insert into lead_batches (employee_id, period_month, lead_count, profiled, review_status) values ($1, $2, 10, true, 'pending') returning id`, [who.rep, m]))[0]!.id;
    const meet = (await q1<{ id: string }>(`insert into client_meetings (employee_id, period_month, potential_band, review_status, reviewed_by_id, awarded_paise) values ($1, $2, 'high', 'approved', $3, 50000) returning id`, [who.rep, m, who.admin1]))[0]!.id;
    signIn("admin2");
    expect(await act.reviewSubmission({ queue: "lead_batch", id: lead, decision: "approved" })).toEqual({ ok: false, error: `${m} is locked or paid in the Incentive Tracker: a decision on its submissions can't be made or changed now (it would no longer match what was settled).` });
    expect(await act.reviewSubmission({ queue: "meeting", id: meet, decision: "rejected", note: "changed my mind" })).toEqual({ ok: false, error: expect.stringMatching(/locked or paid in the Incentive Tracker/) });
    expect(await q1(`select review_status from lead_batches where id = $1 union all select review_status || ':' || reviewed_by_id::text from client_meetings where id = $2`, [lead, meet])).toEqual([{ review_status: "pending" }, { review_status: `approved:${who.admin1}` }]);
  });
});
