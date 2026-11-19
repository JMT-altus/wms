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
  it("any 1–5★ rating is kept (the configuration decides at calculation); a Google review without a rating is refused", async () => {
    signIn("rep");
    expect(await act.submitTestimonial({ kind: "google_review", wordCount: 70, starRating: 4, namesTeamMember: false, evidenceUrl: "shot.png" })).toEqual({ ok: true });
    expect(await act.submitTestimonial({ kind: "google_review", wordCount: 70, namesTeamMember: false })).toEqual({ ok: false, error: expect.stringMatching(/star rating/) });
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
