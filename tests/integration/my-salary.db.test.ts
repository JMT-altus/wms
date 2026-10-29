import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite built from db/schema.ts) for the salary
// module end to end: Generate Salary from real punches through the real
// attendance grader, the employee's own loader (run + attendance + stale check
// + history), the protection of disbursed runs on re-runs, the single-employee
// recalculation, and who may open which statement. Nothing here can reach a
// shared or production database; the session is mocked, the SQL is real.
type Me = { id: string; name: string; email: string; isAdmin: boolean; isActive: boolean; timezone: string };
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | Me };
});
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), revalidateTag: vi.fn(), unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/db", () => ({
  get db() {
    if (!h.db) throw new Error("test database not ready");
    return h.db;
  },
}));
vi.mock("@/lib/auth/current", () => ({
  getCurrentEmployee: async () => h.me,
  requireUser: async () => {
    if (!h.me) throw new Error("Forbidden");
    return h.me;
  },
  requireAdmin: async () => {
    if (!h.me?.isAdmin) throw new Error("Forbidden");
    return h.me;
  },
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/components/layout/header", () => ({ DashboardHeader: () => null }));
vi.mock("@/components/layout/footer", () => ({ DashboardFooter: () => null }));

import * as schema from "@/db/schema";
import { createTestDb, ATTENDANCE_TABLES } from "./_pglite";
import { buildBreakdown } from "@/lib/salary/daily-report";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let actions: typeof import("@/app/(app)/salary/actions");
let q: typeof import("@/lib/queries/salary");
let loader: typeof import("@/lib/salary/my-salary");

const MONTH = "2026-09"; // fully in the past, so every day is graded
const TODAY = "2026-10-29";
const people = { admin: "Admin Person", a: "Alpha One", b: "Beta Two" } as const;
type Who = keyof typeof people;
const ids = {} as Record<Who, string>;
const as = (k: Who | null) => {
  h.me = k ? { id: ids[k], name: people[k], email: `${k}@example.test`, isAdmin: k === "admin", isActive: true, timezone: "Asia/Kolkata" } : null;
};
const punch = (who: Who, date: string, inAt: string, outAt: string) =>
  pg.query(`insert into attendance_logs (employee_id, log_date, kind, logged_at) values ($1, $2, 'in', $3::timestamptz), ($1, $2, 'out', $4::timestamptz)`, [
    ids[who],
    date,
    `${date}T${inAt}:00+05:30`,
    `${date}T${outAt}:00+05:30`,
  ]);
const runOf = async (who: Who) =>
  (await pg.query<{ payable_days: string; gross: string; net_payable: string; disbursed: boolean; disbursed_amount: string | null; updated_at: string }>(
    `select payable_days, gross, net_payable, disbursed, disbursed_amount, updated_at::text from salary_runs where employee_id = $1 and month = $2`,
    [ids[who], MONTH],
  )).rows[0] ?? null;

beforeAll(async () => {
  const made = await createTestDb({
    ...ATTENDANCE_TABLES,
    designations: schema.designations,
    payingEntities: schema.payingEntities,
    salaryProfiles: schema.salaryProfiles,
    salaryAdvances: schema.salaryAdvances,
  });
  pg = made.pg;
  h.db = made.db;
  for (const k of Object.keys(people) as Who[]) {
    ids[k] = (
      await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin, timezone, joined_at) values ($1, $2, 'both', $3, 'Asia/Kolkata', '2026-01-05T00:00:00+05:30') returning id`, [
        people[k],
        `${k}@example.test`,
        k === "admin",
      ])
    ).rows[0]!.id;
  }
  // Alpha has a CTC profile (₹3,72,000 a year → ₹31,000 a month, ₹1,033.33 a day in September); Beta has none.
  await pg.query(`insert into salary_profiles (employee_id, annual_ctc, tds_monthly, pt_exempt) values ($1, 372000, 0, false)`, [ids.a]);
  // A few September working days for both.
  for (const d of ["2026-09-01", "2026-09-02", "2026-09-03"]) {
    await punch("a", d, "10:00", "19:00");
    await punch("b", d, "10:00", "19:00");
  }
  actions = await import("@/app/(app)/salary/actions");
  q = await import("@/lib/queries/salary");
  loader = await import("@/lib/salary/my-salary");
}, 180_000);
afterAll(async () => {
  await pg?.close();
});
beforeEach(() => as("admin"));

describe("Generate Salary", () => {
  it("is refused to a non-admin, before anything is written", async () => {
    as("a");
    await expect(actions.generateSalary({ month: MONTH })).rejects.toThrow("Forbidden");
    await expect(actions.recalculateEmployeeRun({ month: MONTH, employeeId: ids.a })).rejects.toThrow("Forbidden");
    expect((await pg.query(`select count(*)::int as n from salary_runs`)).rows[0]).toEqual({ n: 0 });
  });

  it("creates a run from the real attendance grader for the employee with a CTC profile and skips the one without", async () => {
    const r = await actions.generateSalary({ month: MONTH });
    expect(r).toEqual({ ok: true, generated: 1, skippedDisbursed: 0, skippedNoProfile: 2 }); // Beta and the admin have no profile
    const run = await runOf("a");
    expect(run).not.toBeNull();
    expect(Number(run!.payable_days)).toBeGreaterThan(0);
    expect(await runOf("b")).toBeNull();
    // The stored run reconciles by the engine's own formula (gross − PT 200).
    const row = (await q.listRunsForEmployee(ids.a))[0]!;
    expect(buildBreakdown(row).reconciles).toBe(true);
    expect(row.netPayable).toBe(Number((row.gross - 200).toFixed(2)));
  });
});

describe("the employee's loader", () => {
  it("returns Alpha's run, attendance, history and a 'current' stale check; Beta sees no run and an empty history", async () => {
    const d = await loader.loadMySalary({ id: ids.a }, MONTH, TODAY);
    expect(d.run?.employeeId).toBe(ids.a);
    expect(d.profile).toMatchObject({ hasProfile: true });
    expect(d.attendance?.days.length).toBe(30);
    expect(d.attendance?.summary.present).toBeGreaterThanOrEqual(3);
    expect(d.stale).toEqual({ status: "current" });
    expect(d.history.map((r) => r.month)).toEqual([MONTH]);
    expect(d.bounds).toEqual({ earliest: "2026-01", latest: "2026-10" });

    const e = await loader.loadMySalary({ id: ids.b }, MONTH, TODAY);
    expect(e.run).toBeNull();
    expect(e.profile.hasProfile).toBe(false);
    expect(e.history).toEqual([]);
    expect(e.attendance?.summary.present).toBeGreaterThanOrEqual(3); // attendance is still theirs to see
  });

  it("ownership: each employee's queries return only their own runs", async () => {
    expect((await q.listRunsForEmployee(ids.a)).every((r) => r.employeeId === ids.a)).toBe(true);
    expect(await q.listRunsForEmployee(ids.b)).toEqual([]);
    expect(await q.getRunForEmployeeMonth(ids.b, MONTH)).toBeNull();
  });

  it("an attendance change after generation shows as 'stale' with the old and new payable days; the saved run is untouched", async () => {
    await punch("a", "2026-09-10", "10:00", "19:00");
    const before = await runOf("a");
    const d = await loader.loadMySalary({ id: ids.a }, MONTH, TODAY);
    expect(d.stale).toMatchObject({ status: "stale", savedPayableDays: Number(before!.payable_days) });
    expect((d.stale as { nowPayableDays: number }).nowPayableDays).toBeGreaterThan(Number(before!.payable_days));
    expect(await runOf("a")).toEqual(before);
  });
});

describe("re-runs never silently rewrite a paid month", () => {
  it("a disbursed run keeps its figures on Generate Salary (reported as skipped) and is refused by Recalculate; an explicit includeDisbursed recomputes it and still keeps it disbursed", async () => {
    const run = (await q.listRunsForEmployee(ids.a))[0]!;
    expect(await actions.setDisbursed(run.id, true)).toEqual({ ok: true });
    const paid = await runOf("a");
    expect(paid!.disbursed).toBe(true);

    expect(await actions.generateSalary({ month: MONTH })).toEqual({ ok: true, generated: 0, skippedDisbursed: 1, skippedNoProfile: 2 });
    expect(await runOf("a")).toEqual(paid); // nothing changed, not even updated_at

    expect(await actions.recalculateEmployeeRun({ month: MONTH, employeeId: ids.a })).toMatchObject({ ok: false, error: expect.stringMatching(/already marked disbursed/) });
    expect(await runOf("a")).toEqual(paid);

    expect(await actions.generateSalary({ month: MONTH, includeDisbursed: true })).toEqual({ ok: true, generated: 1, skippedDisbursed: 0, skippedNoProfile: 2 });
    const after = await runOf("a");
    expect(Number(after!.payable_days)).toBeGreaterThan(Number(paid!.payable_days)); // the 10 Sept punch now counts
    expect(after!.disbursed).toBe(true); // the disbursement itself is never wiped
    expect(after!.disbursed_amount).toBe(paid!.disbursed_amount);
  });

  it("un-disbursed again, Recalculate recomputes just this employee and the loader reads 'current'", async () => {
    const run = (await q.listRunsForEmployee(ids.a))[0]!;
    expect(await actions.setDisbursed(run.id, false)).toEqual({ ok: true });
    await punch("a", "2026-09-11", "10:00", "19:00");
    const r = await actions.recalculateEmployeeRun({ month: MONTH, employeeId: ids.a });
    expect(r).toMatchObject({ ok: true });
    expect((await loader.loadMySalary({ id: ids.a }, MONTH, TODAY)).stale).toEqual({ status: "current" });
    expect(await actions.recalculateEmployeeRun({ month: MONTH, employeeId: ids.b })).toMatchObject({ ok: false, error: expect.stringMatching(/No salary profile/) });
    expect(await runOf("b")).toBeNull();
  });
});

describe("the statement page", () => {
  const open = async (runId: string) => {
    const { default: Page } = await import("@/app/(app)/my-salary/statement/[runId]/page");
    return Page({ params: Promise.resolve({ runId }) });
  };
  it("opens for the run's own employee and for an admin; is a 404 for anyone else", async () => {
    const run = (await q.listRunsForEmployee(ids.a))[0]!;
    as("a");
    await expect(open(run.id)).resolves.toBeTruthy();
    as("admin");
    await expect(open(run.id)).resolves.toBeTruthy();
    as("b");
    await expect(open(run.id)).rejects.toThrow("NEXT_NOT_FOUND");
    as(null);
    await expect(open(run.id)).rejects.toThrow("Forbidden");
  });
});
