import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests for attendance waivers and the daily hours highlight (HR → Attendance Correction), on an
// in-memory PGlite database built from db/schema.ts (so it includes the 0126 table). DATABASE_URL is forced to an
// unresolvable address and @/lib/db is the in-memory instance: nothing can reach a shared or production database.
// Mocked: who is signed in, HR module access, Next's cache and the rate limiter. Grading, salary staleness, the
// permission matrix and every write are real.
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | Record<string, unknown>, hr: new Set<string>() };
});

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/db", () => ({
  get db() {
    if (!h.db) throw new Error("test database not ready");
    return h.db;
  },
}));
vi.mock("@/lib/auth/current", () => ({
  requireUser: async () => {
    if (!h.me) throw new Error("Unauthorized");
    return h.me;
  },
  requireAdmin: async () => {
    if (!h.me?.isAdmin) throw new Error("Forbidden");
    return h.me;
  },
  getCurrentEmployee: async () => h.me,
}));
vi.mock("@/lib/auth/module-access", () => ({
  getModuleAccessFor: async (me: { id: string }) => ({ hr: { allowed: h.hr.has(me.id), source: "employee" } }),
}));

import * as schema from "@/db/schema";
import { SUPER_ADMIN_EMAILS } from "@/lib/auth/super-admin";
import { createTestDb, ATTENDANCE_TABLES } from "./_pglite";

type Made = Awaited<ReturnType<typeof createTestDb>>;
let db: Made["db"];
let pg: Made["pg"];
let waivers: typeof import("@/app/(app)/hr/attendance-correction/waiver-actions");
let correction: typeof import("@/app/(app)/hr/attendance-correction/actions");
let status: typeof import("@/lib/queries/attendance-status");
let staleChecksForMonth: typeof import("@/lib/queries/salary-stale").staleChecksForMonth;

let SUPER = "";
let HR_GRANTED = "";
let HR_PLAIN = "";
let STAFF = "";
let EMP = "";
let IMP = "";
const WHY = "Approved client visit; site had no biometric";

async function addEmployee(name: string, over: Record<string, unknown> = {}): Promise<string> {
  const [row] = await db
    .insert(schema.employees)
    .values({ name, email: `${name.toLowerCase().replace(/\W+/g, ".")}@example.test`, role: "both", timezone: "Asia/Kolkata", weeklyOff: 0, joinedAt: new Date("2026-01-05T00:00:00+05:30"), ...over } as typeof schema.employees.$inferInsert)
    .returning({ id: schema.employees.id });
  return row!.id;
}
async function signIn(id: string) {
  const [row] = (await pg.query<Record<string, unknown>>(`select * from employees where id = $1`, [id])).rows;
  h.me = { id: row!.id, isAdmin: row!.is_admin, isActive: row!.is_active, email: row!.email, name: row!.name, departmentId: row!.department_id ?? null, timezone: "Asia/Kolkata" };
}
async function punch(employeeId: string, date: string, kind: "in" | "out", hhmm: string, extra = "") {
  await pg.query(
    `insert into attendance_logs (employee_id, log_date, kind, logged_at${extra ? ", source, reason, note" : ""}) values ($1, $2::date, $3, ($2::text || ' ' || $4::text || ':00+05:30')::timestamptz${extra ? ", 'admin', 'import', 'Biometric import · batch T'" : ""})`,
    [employeeId, date, kind, hhmm],
  );
}
const march = async (id = EMP) => {
  const s = await status.getEmployeeMonthStatus(id, 2026, 3, "2026-03-31");
  return { days: Object.fromEntries(s.days.map((d) => [d.logDate, d])), summary: s.summary };
};
const punches = async (id: string) =>
  (await pg.query<{ kind: string; d: string; logged_at: Date; source: string; note: string | null }>(`select kind, log_date::text d, logged_at, source, note from attendance_logs where employee_id = $1 order by log_date, kind`, [id])).rows;
const events = async (id: string) =>
  (await pg.query<{ event_type: string; actor_id: string; from_value: Record<string, unknown>; to_value: Record<string, unknown>; note: string }>(`select event_type, actor_id, from_value, to_value, note from employee_events where employee_id = $1 and event_type like 'attendance_waiver%' order by created_at`, [id])).rows;

beforeAll(async () => {
  const made = await createTestDb({
    ...ATTENDANCE_TABLES,
    attendanceWaivers: schema.attendanceWaivers,
    fieldPermissionGrants: schema.fieldPermissionGrants,
    employeeDepartments: schema.employeeDepartments,
    departments: schema.departments,
  });
  db = made.db;
  pg = made.pg;
  h.db = db;
  waivers = await import("@/app/(app)/hr/attendance-correction/waiver-actions");
  correction = await import("@/app/(app)/hr/attendance-correction/actions");
  status = await import("@/lib/queries/attendance-status");
  staleChecksForMonth = (await import("@/lib/queries/salary-stale")).staleChecksForMonth;

  SUPER = await addEmployee("Super Person", { isAdmin: true, email: SUPER_ADMIN_EMAILS[0] });
  HR_GRANTED = await addEmployee("Hr Granted");
  HR_PLAIN = await addEmployee("Hr Plain", { isAdmin: true }); // an admin with HR access but no waiver grant
  STAFF = await addEmployee("Staff Person");
  EMP = await addEmployee("Alpha One");
  IMP = await addEmployee("Imported Person");
  for (const id of [SUPER, HR_GRANTED, HR_PLAIN]) h.hr.add(id);
  await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('attendance.waivers.manage', 'employee', $1, true)`, [HR_GRANTED]);

  // March 2026 for EMP (company times: late after 10:50, early before 19:20, full day 9 h, half day 5 h).
  // Sun 1 weekly off · Mon 2 absent · Tue 3 half day · Wed 4 late (8h30 worked, not waived) · Thu 5 no check-out · Fri 6 complete.
  await punch(EMP, "2026-03-03", "in", "09:30");
  await punch(EMP, "2026-03-03", "out", "13:00");
  await punch(EMP, "2026-03-04", "in", "11:00");
  await punch(EMP, "2026-03-04", "out", "19:30");
  await punch(EMP, "2026-03-05", "in", "09:30");
  await punch(EMP, "2026-03-06", "in", "09:30");
  await punch(EMP, "2026-03-06", "out", "19:30");
  // Imported (bulk) punches for the hours highlight.
  for (const [d, i, o] of [["2026-03-09", "09:00", "17:30"], ["2026-03-10", "09:00", "17:29"], ["2026-03-11", "09:00", "18:30"], ["2026-03-12", "09:00", "18:31"]] as const) {
    await punch(IMP, d, "in", i, "import");
    await punch(IMP, d, "out", o, "import");
  }
  await punch(IMP, "2026-03-13", "in", "09:00", "import");
}, 180_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(() => {
  h.me = null;
});

describe("daily hours highlight in the month view (real grading, imported punches)", () => {
  it("8:30 and 9:30 exactly are normal, below / above are yellow / green, a missing punch is never coloured", async () => {
    await signIn(SUPER);
    const r = await correction.loadMonth({ employeeId: IMP, month: "2026-03" });
    if (!r.ok) throw new Error(r.error);
    expect(r.view.bands).toEqual({ "2026-03-10": "short", "2026-03-12": "long" });
    expect(r.view.highlight).toEqual({ shortBelowMinutes: 510, longAboveMinutes: 570 });
    const d13 = r.view.days.find((d) => d.logDate === "2026-03-13")!;
    expect(d13.outAt).toBeNull(); // no check-out: no colour (and the report shows no hours for it)
    // The imported punches are read as recorded and never modified.
    expect((await punches(IMP)).every((p) => p.source === "admin" && String(p.note).startsWith("Biometric import"))).toBe(true);
  });

  it("limits saved in Attendance Settings apply from their effective date only", async () => {
    await pg.query(`insert into attendance_policy_changes (policy_key, value, effective_from, reason) values ('hours_highlight', '{"shortBelowMinutes":480,"longAboveMinutes":540}'::jsonb, '2026-03-11', 'test')`);
    await signIn(SUPER);
    const r = await correction.loadMonth({ employeeId: IMP, month: "2026-03" });
    if (!r.ok) throw new Error(r.error);
    // 10 Mar (8:29) is graded with the default limits (short); from 11 Mar 9:30 and 9:31 are both above 9:00 → green.
    expect(r.view.bands).toEqual({ "2026-03-10": "short", "2026-03-11": "long", "2026-03-12": "long" });
    await pg.query(`delete from attendance_policy_changes where policy_key = 'hours_highlight'`);
  });
});

describe("who may waive (server-side, Field Permissions)", () => {
  it("no HR access, or HR without the sensitive grant, is refused before anything is read or written", async () => {
    for (const who of [STAFF, HR_PLAIN]) {
      await signIn(who);
      await expect(waivers.previewWaiver({ employeeId: EMP, date: "2026-03-02" })).rejects.toThrow("Forbidden");
      await expect(waivers.waiveDay({ employeeId: EMP, date: "2026-03-02", reason: WHY, confirmed: true })).rejects.toThrow("Forbidden");
      await expect(waivers.reverseWaiver({ waiverId: "11111111-1111-4111-8111-111111111111", reason: WHY, confirmed: true })).rejects.toThrow("Forbidden");
    }
    expect((await pg.query(`select count(*)::int n from attendance_waivers`)).rows[0]).toEqual({ n: 0 });
  });

  it("the month view tells the page who may waive", async () => {
    await signIn(HR_PLAIN);
    expect((await correction.loadMonth({ employeeId: EMP, month: "2026-03" })) as { view: { canWaive: boolean } }).toMatchObject({ view: { canWaive: false } });
    await signIn(HR_GRANTED);
    expect((await correction.loadMonth({ employeeId: EMP, month: "2026-03" })) as { view: { canWaive: boolean } }).toMatchObject({ view: { canWaive: true } });
  });
});

describe("waiving: preview, grading, salary, audit", () => {
  it("previews an absent day: 0 → 1 payable day; no salary run yet", async () => {
    await signIn(HR_GRANTED);
    const r = await waivers.previewWaiver({ employeeId: EMP, date: "2026-03-02" });
    expect(r).toMatchObject({ ok: true, preview: { current: { code: "A", dayValue: 0 }, payable: { before: 0, after: 1 }, removesLateMark: false, salaryRun: null } });
  });

  it("waives the absent day: WV, one payable day, punches untouched, waiver row + audit event", async () => {
    const before = await march();
    const punchesBefore = await punches(EMP);
    await signIn(HR_GRANTED);
    expect(await waivers.waiveDay({ employeeId: EMP, date: "2026-03-02", reason: WHY, confirmed: true })).toMatchObject({ ok: true });
    const after = await march();
    expect(after.days["2026-03-02"]).toMatchObject({ code: "WV", dayValue: 1, inAt: null, outAt: null, workedMinutes: 0 }); // no hours invented
    expect(after.summary.payableDays).toBe(before.summary.payableDays + 1);
    expect(after.summary).toMatchObject({ absent: before.summary.absent - 1, waived: 1 });
    expect(await punches(EMP)).toEqual(punchesBefore);
    const w = (await pg.query(`select reason, waived_by_id, waived_at, reversed_at from attendance_waivers where employee_id = $1 and log_date = '2026-03-02'`, [EMP])).rows;
    expect(w).toEqual([expect.objectContaining({ reason: WHY, waived_by_id: HR_GRANTED, reversed_at: null })]);
    const ev = await events(EMP);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ event_type: "attendance_waiver", actor_id: HR_GRANTED, from_value: { date: "2026-03-02", code: "A", dayValue: 0 }, to_value: { code: "WV", dayValue: 1 } });
  });

  it("refuses a duplicate (and the database refuses a second active row on its own)", async () => {
    await signIn(SUPER);
    expect(await waivers.waiveDay({ employeeId: EMP, date: "2026-03-02", reason: WHY, confirmed: true })).toEqual({ ok: false, error: expect.stringMatching(/already waived/) });
    await expect(pg.query(`insert into attendance_waivers (employee_id, log_date, reason) values ($1, '2026-03-02', 'direct duplicate')`, [EMP])).rejects.toThrow(/duplicate key|unique/);
  });

  it("a waived late day no longer counts toward the every-3rd-late deduction; a half day and a no-check-out pay a full day", async () => {
    const before = await march();
    expect(before.days["2026-03-04"]).toMatchObject({ code: "P", late: true, lateWaived: false });
    await signIn(SUPER); // a super-admin needs no grant
    for (const date of ["2026-03-03", "2026-03-04", "2026-03-05"]) expect(await waivers.waiveDay({ employeeId: EMP, date, reason: WHY, confirmed: true })).toMatchObject({ ok: true });
    const after = await march();
    expect(after.days["2026-03-04"]).toMatchObject({ code: "WV", late: false, inAt: "11:00", outAt: "19:30" });
    expect(after.days["2026-03-03"]).toMatchObject({ code: "WV", dayValue: 1, workedMinutes: before.days["2026-03-03"]!.workedMinutes });
    expect(after.summary.late).toBe(before.summary.late - 1);
    expect(after.summary.payableDays).toBe(before.summary.payableDays + 0.5 + 0 + 1); // H/D 0.5→1, P 1→1, incomplete 0→1
  });

  it("refuses weekly offs, complete days, future days, one's own attendance, a missing reason or confirmation", async () => {
    await signIn(SUPER);
    expect(await waivers.waiveDay({ employeeId: EMP, date: "2026-03-01", reason: WHY, confirmed: true })).toEqual({ ok: false, error: expect.stringMatching(/Weekly Off days can't be waived/) });
    expect(await waivers.waiveDay({ employeeId: EMP, date: "2026-03-06", reason: WHY, confirmed: true })).toEqual({ ok: false, error: expect.stringMatching(/Nothing to waive/) });
    expect(await waivers.waiveDay({ employeeId: EMP, date: "2099-01-05", reason: WHY, confirmed: true })).toEqual({ ok: false, error: expect.stringMatching(/hasn't happened/) });
    expect((await waivers.waiveDay({ employeeId: SUPER, date: "2026-03-02", reason: WHY, confirmed: true })).ok).toBe(false);
    expect(await waivers.waiveDay({ employeeId: EMP, date: "2026-03-09", reason: "x", confirmed: true })).toEqual({ ok: false, error: expect.stringMatching(/reason/) });
    expect((await waivers.waiveDay({ employeeId: EMP, date: "2026-03-09", reason: WHY })).ok).toBe(false);
  });

  it("the batched dashboard and the strict salary read count waived days the same way", async () => {
    const rows = await status.getMonthDashboard(2026, 3, "2026-03-31", { strictPolicy: true });
    const alpha = rows.find((r) => r.employeeId === EMP)!;
    expect(alpha.summary).toMatchObject({ waived: 4, payableDays: (await march()).summary.payableDays });
  });
});

describe("reversal and history", () => {
  it("needs a reason and confirmation; restores the day's own grade; keeps both rows and both events", async () => {
    const [w] = (await pg.query<{ id: string }>(`select id from attendance_waivers where employee_id = $1 and log_date = '2026-03-02' and reversed_at is null`, [EMP])).rows;
    await signIn(HR_GRANTED);
    expect(await waivers.reverseWaiver({ waiverId: w!.id, reason: "", confirmed: true })).toEqual({ ok: false, error: expect.stringMatching(/reason/) });
    expect((await waivers.reverseWaiver({ waiverId: w!.id, reason: "Visit was not approved" })).ok).toBe(false);
    expect(await waivers.reverseWaiver({ waiverId: w!.id, reason: "Visit was not approved", confirmed: true })).toMatchObject({ ok: true });
    expect((await march()).days["2026-03-02"]).toMatchObject({ code: "A", dayValue: 0 });
    expect(await waivers.reverseWaiver({ waiverId: w!.id, reason: "again", confirmed: true })).toEqual({ ok: false, error: expect.stringMatching(/already been reversed/) });

    // Waiving again starts a new episode; the history keeps both, with who / when / why.
    expect(await waivers.waiveDay({ employeeId: EMP, date: "2026-03-02", reason: "Approved after review", confirmed: true })).toMatchObject({ ok: true });
    const r = await correction.loadMonth({ employeeId: EMP, month: "2026-03" });
    if (!r.ok) throw new Error(r.error);
    const hist = r.view.waivers.filter((x) => x.date === "2026-03-02");
    expect(hist).toEqual([
      expect.objectContaining({ reason: WHY, waivedBy: "Hr Granted", reversedBy: "Hr Granted", reverseReason: "Visit was not approved" }),
      expect.objectContaining({ reason: "Approved after review", reversedAt: null }),
    ]);
    const for02 = (await events(EMP)).filter((e) => e.from_value.date === "2026-03-02" || e.to_value.date === "2026-03-02");
    expect(for02.map((e) => e.event_type)).toEqual(["attendance_waiver", "attendance_waiver_reversed", "attendance_waiver"]);
    expect(for02[1]).toMatchObject({ actor_id: HR_GRANTED, note: expect.stringMatching(/reversed: Visit was not approved/) });
  });
});

describe("migration 0126 itself (the SQL file, applied to a fresh in-memory database)", () => {
  it("creates the table with its rules, and is safe to re-run", async () => {
    const fresh = await createTestDb({ employees: schema.employees });
    const sql = readFileSync(resolve(__dirname, "../../db/migrations/0126_attendance_waivers.sql"), "utf8");
    await fresh.pg.exec(sql);
    await fresh.pg.exec(sql); // idempotent
    const [e] = (await fresh.pg.query<{ id: string }>(`insert into employees (name, email, role) values ('X', 'x@example.test', 'both') returning id`)).rows;
    const ins = (reason: string) => fresh.pg.query(`insert into attendance_waivers (employee_id, log_date, reason) values ($1, '2026-03-02', $2) returning id`, [e!.id, reason]);
    await expect(ins("  ")).rejects.toThrow(/reason_check/); // a reason is required
    const [w] = (await ins("Valid reason")).rows as { id: string }[];
    await expect(ins("Second active")).rejects.toThrow(/duplicate key|unique/); // one active waiver per day
    await expect(fresh.pg.query(`update attendance_waivers set reversed_at = now() where id = $1`, [w!.id])).rejects.toThrow(/reversal_check/); // reversal needs a reason
    await fresh.pg.query(`update attendance_waivers set reversed_at = now(), reverse_reason = 'Not approved' where id = $1`, [w!.id]);
    await expect(ins("New episode after reversal")).resolves.toBeTruthy();
    const rls = (await fresh.pg.query<{ r: boolean }>(`select relrowsecurity r from pg_class where relname = 'attendance_waivers'`)).rows[0];
    expect(rls).toEqual({ r: true });
    await fresh.pg.close();
  });
});

describe("a month whose salary is already generated", () => {
  it("is warned about in the preview, never changed, and shows as needing review after the waiver", async () => {
    const OTHER = await addEmployee("Beta Two");
    const month = "2026-03";
    const now = (await march(OTHER)).summary;
    await pg.query(
      `insert into salary_runs (employee_id, fy, month, annual_ctc, days_in_month, payable_days, late_marks, late_deduction_days, gross, pt, tds, advances, pending_balance_in, net_payable, disbursed, disbursed_amount, source)
       values ($1, 'FY 25-26', $2, 600000, 31, $3, $4, 0, 1000, 200, 0, 0, 0, 800, true, 800, 'generated')`,
      [OTHER, month, now.payableDays.toFixed(2), now.late],
    );
    const runBefore = (await pg.query(`select * from salary_runs where employee_id = $1 and month = $2`, [OTHER, month])).rows;
    const runInputs = [{ employeeId: OTHER, source: "generated", payableDays: now.payableDays, lateMarks: now.late }];
    expect((await staleChecksForMonth(month, runInputs))[OTHER]).toEqual({ status: "current" });

    await signIn(SUPER);
    const p = await waivers.previewWaiver({ employeeId: OTHER, date: "2026-03-02" });
    expect(p).toMatchObject({ ok: true, preview: { salaryRun: { month, disbursed: true } } });
    expect(await waivers.waiveDay({ employeeId: OTHER, date: "2026-03-02", reason: WHY, confirmed: true })).toMatchObject({ ok: true });

    expect((await pg.query(`select * from salary_runs where employee_id = $1 and month = $2`, [OTHER, month])).rows).toEqual(runBefore);
    expect((await staleChecksForMonth(month, runInputs))[OTHER]).toMatchObject({ status: "stale", savedPayableDays: now.payableDays, nowPayableDays: now.payableDays + 1 });
  });
});
