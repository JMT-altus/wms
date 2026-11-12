import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests for Admin Panel → Attendance Settings, on an in-memory PGlite database built from
// db/schema.ts. DATABASE_URL is forced to an unresolvable address and @/lib/db is the in-memory instance:
// nothing here can reach a shared or production database. Only the session (who is signed in), Next's
// cache and the rate limiter are mocked; grading, permissions and the policy table are real.
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | Record<string, unknown> };
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

import * as schema from "@/db/schema";
import { SUPER_ADMIN_EMAILS } from "@/lib/auth/super-admin";
import { createTestDb, ATTENDANCE_TABLES } from "./_pglite";

type Made = Awaited<ReturnType<typeof createTestDb>>;
let db: Made["db"];
let pg: Made["pg"];
let status: typeof import("@/lib/queries/attendance-status");
let settings: typeof import("@/app/(admin)/admin/attendance-settings/actions");
let policy: typeof import("@/lib/queries/attendance-policy");

let SUPER = "";
let ADMIN = "";
let GRANTED = "";
let STAFF = "";
let EMP = "";
let DEPT = "";

async function addEmployee(name: string, over: Record<string, unknown> = {}): Promise<string> {
  const [row] = await db
    .insert(schema.employees)
    .values({ name, email: `${name.toLowerCase().replace(/\W+/g, ".")}@example.test`, role: "both", timezone: "Asia/Kolkata", joinedAt: new Date("2026-01-05T00:00:00+05:30"), ...over } as typeof schema.employees.$inferInsert)
    .returning({ id: schema.employees.id });
  return row!.id;
}
async function signIn(id: string) {
  const [row] = await pg.query<Record<string, unknown>>(`select * from employees where id = $1`, [id]).then((r) => r.rows);
  h.me = { id: row!.id, isAdmin: row!.is_admin, isActive: row!.is_active, email: row!.email, name: row!.name, departmentId: row!.department_id ?? null, timezone: "Asia/Kolkata" };
}
async function setting(key: string, value: unknown, effectiveFrom: string, createdAt = "2026-01-01T00:00:00Z") {
  await pg.query(`insert into attendance_policy_changes (policy_key, value, effective_from, reason, created_at) values ($1, $2::jsonb, $3, 'test', $4)`, [key, JSON.stringify(value), effectiveFrom, createdAt]);
}
async function punch(employeeId: string, date: string, inAt: string, outAt: string) {
  await pg.query(
    `insert into attendance_logs (employee_id, log_date, kind, logged_at) values ($1, $2::date, 'in', ($2::text || ' ' || $3::text || ':00+05:30')::timestamptz), ($1, $2::date, 'out', ($2::text || ' ' || $4::text || ':00+05:30')::timestamptz)`,
    [employeeId, date, inAt, outAt],
  );
}
const shift = (over: Record<string, unknown> = {}) => ({ id: "general", name: "General", start: "09:00", end: "18:00", workingHours: 8.5, active: true, isDefault: true, employeeIds: [], departmentIds: [], ...over });
const march = async (id = EMP) => {
  const s = await status.getEmployeeMonthStatus(id, 2026, 3, "2026-03-31");
  return Object.fromEntries(s.days.filter((d) => d.inAt).map((d) => [d.logDate, { late: d.late, leftEarly: d.leftEarly, code: d.code }]));
};
const istToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
const nextMonthFirst = () => {
  const [y, m] = istToday().split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
};

beforeAll(async () => {
  const made = await createTestDb({ ...ATTENDANCE_TABLES, departments: schema.departments, employeeDepartments: schema.employeeDepartments, fieldPermissionGrants: schema.fieldPermissionGrants });
  db = made.db;
  pg = made.pg;
  h.db = db;
  status = await import("@/lib/queries/attendance-status");
  settings = await import("@/app/(admin)/admin/attendance-settings/actions");
  policy = await import("@/lib/queries/attendance-policy");

  SUPER = await addEmployee("Super Person", { isAdmin: true, email: SUPER_ADMIN_EMAILS[0] });
  ADMIN = await addEmployee("Plain Admin", { isAdmin: true });
  GRANTED = await addEmployee("Granted Admin", { isAdmin: true });
  STAFF = await addEmployee("Staff Person");
  EMP = await addEmployee("Alpha One");
  const [d] = await db.insert(schema.departments).values({ name: "Store" } as typeof schema.departments.$inferInsert).returning({ id: schema.departments.id });
  DEPT = d!.id;
  // Mon 2 – Fri 6 March 2026: in 09:10, out 18:00 every day.
  for (const date of ["2026-03-02", "2026-03-03", "2026-03-04", "2026-03-05", "2026-03-06"]) await punch(EMP, date, "09:10", "18:00");
}, 180_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(() => {
  h.me = null;
});

describe("grading reads the saved settings, from their effective dates only", () => {
  it("applies shift, grace and department assignment per date; days before each change grade exactly as before", async () => {
    const baseline = await march(); // nothing configured: the company times (late after 10:50)
    expect(baseline["2026-03-04"]!.late).toBe(false);

    await setting("work_shifts", { shifts: [shift()] }, "2026-03-04");
    const withShift = await march();
    expect(withShift["2026-03-02"]).toEqual(baseline["2026-03-02"]); // before the effective date: unchanged
    expect(withShift["2026-03-03"]).toEqual(baseline["2026-03-03"]);
    expect(withShift["2026-03-04"]).toMatchObject({ late: true, leftEarly: false }); // 09:10 > 09:00; 18:00 = end is on time

    await setting("check_in_grace", { enabled: true, minutes: 15 }, "2026-03-05");
    const withGrace = await march();
    expect(withGrace["2026-03-04"]!.late).toBe(true); // grace not yet in force
    expect(withGrace["2026-03-05"]!.late).toBe(false); // 09:10 within 09:00 + 15

    // From the 6th: a department shift starting 09:05 with no change to grace (still 15) → late after 09:20.
    await pg.query(`insert into employee_departments (employee_id, department_id) values ($1, $2)`, [EMP, DEPT]);
    await setting("work_shifts", { shifts: [shift(), shift({ id: "store", name: "Store", start: "09:05", end: "18:30", workingHours: 8, isDefault: false, departmentIds: [DEPT] })] }, "2026-03-06");
    const withDept = await march();
    expect(withDept["2026-03-06"]).toMatchObject({ late: false, leftEarly: true }); // 18:00 < 18:30 end
    expect(withDept["2026-03-05"]).toEqual(withGrace["2026-03-05"]);
    expect(withDept["2026-03-02"]).toEqual(baseline["2026-03-02"]);
  });

  it("the batched dashboard (and strict salary read) uses the same settings; a corrupt stored value stops salary but not the page", async () => {
    const rows = await status.getMonthDashboard(2026, 3, "2026-03-31", { strictPolicy: true });
    const alpha = rows.find((r) => r.employeeId === EMP)!;
    // Only the 4th is late (shift, no grace yet) — and waived by the existing rule, since 8h50m worked ≥ the shift's 8.5 h full day.
    expect(alpha.summary.lateRaw).toBe(1);
    expect(alpha.summary.lateWaived).toBe(2); // the 4th (late) and the 6th (left before the Store shift's 18:30 end), both full days
    await setting("check_out_grace", { enabled: "yes", minutes: -1 }, "2026-03-01");
    await expect(status.getMonthDashboard(2026, 3, "2026-03-31", { strictPolicy: true })).rejects.toThrow(/invalid value/);
    const display = await status.getMonthDashboard(2026, 3, "2026-03-31");
    expect(display.find((r) => r.employeeId === EMP)!.summary.lateRaw).toBe(1);
    await pg.query(`delete from attendance_policy_changes where policy_key = 'check_out_grace' and value->>'enabled' = 'yes'`);
  });

  it("shift rows don't disturb the payroll policy (strict read) or its page history", async () => {
    const strict = await policy.getPolicyAsOfStrict("2026-03-31");
    expect(strict.approved_leave_payment).toBe("paid");
    const hist = await policy.listPolicyHistory(100, "policy");
    expect(hist.some((x) => ["work_shifts", "check_in_grace", "check_out_grace"].includes(x.key))).toBe(false);
    expect((await policy.listPolicyHistory(100, "shifts")).length).toBeGreaterThan(0);
  });
});

describe("who may change the settings (server-side)", () => {
  const grace = () => ({ key: "check_in_grace" as const, enabled: true, minutes: 12, effectiveFrom: nextMonthFirst(), reason: "Test change" });

  it("a non-admin, and an admin without the grant, are refused before anything is written", async () => {
    const before = (await pg.query(`select count(*)::int n from attendance_policy_changes`)).rows[0];
    await signIn(STAFF);
    await expect(settings.saveGrace(grace())).rejects.toThrow("Forbidden");
    await signIn(ADMIN);
    await expect(settings.saveGrace(grace())).rejects.toThrow("Forbidden");
    await expect(settings.saveWorkShifts({ shifts: [shift()], effectiveFrom: nextMonthFirst(), reason: "x x x" })).rejects.toThrow("Forbidden");
    expect((await pg.query(`select count(*)::int n from attendance_policy_changes`)).rows[0]).toEqual(before);
  });

  it("an admin holding the sensitive grant may; a super-admin may without one", async () => {
    await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('attendance.settings.manage', 'employee', $1, true)`, [GRANTED]);
    await signIn(GRANTED);
    expect(await settings.saveGrace(grace())).toMatchObject({ ok: true });
    await signIn(SUPER);
    expect(await settings.saveGrace({ ...grace(), key: "check_out_grace", minutes: 10 })).toMatchObject({ ok: true });
  });
});

describe("saving: history, validation and effective-date limits", () => {
  it("records previous value, new value, who, when, effective date and reason; an identical save is refused", async () => {
    await signIn(SUPER);
    const eff = nextMonthFirst();
    const res = await settings.saveGrace({ key: "check_in_grace", enabled: true, minutes: 20, effectiveFrom: eff, reason: "Traffic on the new route" });
    expect(res).toMatchObject({ ok: true });
    const r = (
      await pg.query<{ value: unknown; previous_value: unknown; changed_by_id: string; effective_from: string; reason: string; created_at: Date }>(
        `select value, previous_value, changed_by_id, effective_from::text, reason, created_at from attendance_policy_changes where policy_key = 'check_in_grace' and effective_from = $1 order by created_at desc limit 1`,
        [eff],
      )
    ).rows[0]!;
    expect(r).toMatchObject({ value: { enabled: true, minutes: 20 }, previous_value: { enabled: true, minutes: 12 }, changed_by_id: SUPER, effective_from: eff, reason: "Traffic on the new route" });
    expect(r.created_at).toBeInstanceOf(Date);
    expect(await settings.saveGrace({ key: "check_in_grace", enabled: true, minutes: 20, effectiveFrom: eff, reason: "Again" })).toEqual({ ok: false, error: expect.stringMatching(/Nothing changed/) });
  });

  it("refuses a date before this month, a month whose salary exists, bad shifts and unknown assignees — writing nothing", async () => {
    await signIn(SUPER);
    const count = async () => (await pg.query(`select count(*)::int n from attendance_policy_changes`)).rows[0];
    const before = await count();
    expect(await settings.saveGrace({ key: "check_in_grace", enabled: true, minutes: 5, effectiveFrom: "2026-01-01", reason: "Backdated" })).toEqual({ ok: false, error: expect.stringMatching(/at the earliest/) });
    expect(await settings.saveWorkShifts({ shifts: [shift({ start: "18:00", end: "09:00" })], effectiveFrom: nextMonthFirst(), reason: "Bad shift" })).toEqual({ ok: false, error: expect.stringMatching(/end time must be after/) });
    expect(await settings.saveWorkShifts({ shifts: [shift({ workingHours: 4 })], effectiveFrom: nextMonthFirst(), reason: "Too short" })).toEqual({ ok: false, error: expect.stringMatching(/half-day threshold/) });
    expect(await settings.saveWorkShifts({ shifts: [shift({ employeeIds: ["99999999-9999-4999-8999-999999999999"] })], effectiveFrom: nextMonthFirst(), reason: "Ghost" })).toEqual({ ok: false, error: expect.stringMatching(/doesn't exist or is inactive/) });
    expect(await settings.saveGrace({ key: "check_in_grace", enabled: true, minutes: 5, effectiveFrom: nextMonthFirst(), reason: "" })).toEqual({ ok: false, error: expect.stringMatching(/reason/) });

    // A salary run for next month: changes must now start the month after.
    const month = nextMonthFirst().slice(0, 7);
    await pg.query(`insert into salary_runs (employee_id, month, payable_days, gross_paise, net_paise) values ($1, $2, 0, 0, 0)`, [EMP, month]).catch(async () => {
      // Column set differs by schema version: fall back to the minimal NOT NULL columns.
      const cols = (await pg.query<{ column_name: string }>(`select column_name from information_schema.columns where table_name = 'salary_runs' and is_nullable = 'NO' and column_default is null`)).rows.map((c) => c.column_name);
      const vals = cols.map((c) => (c === "employee_id" ? EMP : c === "month" ? month : c.endsWith("_by") || c.endsWith("_id") ? null : 0));
      await pg.query(`insert into salary_runs (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")})`, vals);
    });
    expect(await settings.saveGrace({ key: "check_in_grace", enabled: true, minutes: 5, effectiveFrom: nextMonthFirst(), reason: "After payroll" })).toEqual({ ok: false, error: expect.stringMatching(/Salary is already generated/) });
    expect(await count()).toEqual(before);
  });

  it("saves shifts with employee and department assignments", async () => {
    await signIn(SUPER);
    const res = await settings.saveWorkShifts({
      shifts: [shift(), shift({ id: "store", name: "Store", start: "10:00", end: "19:00", workingHours: 8, isDefault: false, employeeIds: [EMP], departmentIds: [DEPT] })],
      effectiveFrom: "2099-01-01",
      reason: "New store timings",
    });
    expect(res).toMatchObject({ ok: true });
    const row = (await pg.query<{ value: { shifts: unknown[] }; previous_value: unknown }>(`select value, previous_value from attendance_policy_changes where policy_key = 'work_shifts' and effective_from = '2099-01-01'`)).rows[0]!;
    expect(row.value.shifts).toHaveLength(2);
    expect((row.previous_value as { shifts: { name: string }[] }).shifts.map((s) => s.name)).toEqual(["General", "Store"]); // the 6-March set
  });
});
