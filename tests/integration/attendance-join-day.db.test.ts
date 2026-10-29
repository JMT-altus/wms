import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// REGRESSION — April 2026 attendance import vs the calendar's "join day" rule,
// on an in-memory PGlite database built from db/schema.ts (nothing here can
// reach a shared or production database).
//
// The bug: `employees.joined_at` is stamped at the employee's FIRST SIGN-IN to
// the WMS (else `created_at` is used), so every day before it was graded "not
// joined" and its punches were dropped — all 339 imported April punches were
// invisible. The fix (lib/attendance/join-day.ts): the effective join day is the
// EARLIER of that account day and the employee's first recorded attendance date.
// The punches are inserted ONCE, exactly as the import writes them, and are
// never re-imported.
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: { id: "", isAdmin: true, isActive: true, email: "hr@example.test", timezone: "Asia/Kolkata", name: "HR" } as Record<string, unknown> };
});
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/db", () => ({
  get db() {
    if (!h.db) throw new Error("test database not ready");
    return h.db;
  },
}));
vi.mock("@/lib/auth/current", () => ({
  requireUser: async () => h.me,
  requireAdmin: async () => {
    if (!h.me.isAdmin) throw new Error("Forbidden");
    return h.me;
  },
}));
vi.mock("@/lib/auth/module-access", () => ({ getModuleAccessFor: async () => ({ hr: { allowed: true, source: "employee" } }) }));
vi.mock("@/lib/attendance/punch-notify", () => ({
  notifyOnDayFinalized: vi.fn(),
  notifyAdminLateDeduction: vi.fn(),
  notifyOnInPunch: vi.fn(),
  clockInTz: () => "00:00",
  alertAdminsNewAttendanceDevice: vi.fn(),
}));

import * as schema from "@/db/schema";
import { createTestDb, ATTENDANCE_TABLES } from "./_pglite";
import { effectiveJoinDay } from "@/lib/attendance/join-day";

let pg: Awaited<ReturnType<typeof createTestDb>>["pg"];
let db: Awaited<ReturnType<typeof createTestDb>>["db"];
let status: typeof import("@/lib/queries/attendance-status");
let hr: typeof import("@/app/(app)/hr/attendance-correction/actions");
const TODAY = "2026-10-28";
const E: Record<string, string> = {};

async function addEmployee(key: string, joinedAt: string | null, createdAt = "2026-07-21T10:00:00+05:30") {
  const [row] = await db
    .insert(schema.employees)
    .values({
      name: key,
      email: `${key.toLowerCase()}@example.test`,
      role: "both",
      timezone: "Asia/Kolkata",
      joinedAt: joinedAt ? new Date(joinedAt) : null,
      createdAt: new Date(createdAt),
    } as typeof schema.employees.$inferInsert)
    .returning({ id: schema.employees.id });
  E[key] = row!.id;
}
/** One day's in/out, written exactly as the attendance import writes it (source admin, reason import). */
async function imported(key: string, date: string, inT = "09:30", outT = "18:30") {
  for (const [kind, t] of [["in", inT], ["out", outT]] as const) {
    await pg.query(
      `insert into attendance_logs (employee_id, log_date, kind, logged_at, source, reason, recorded_by_id, verify_method, note)
       values ($1, $2, $3, $4, 'admin', 'import', $5, 'none', 'import batch test')`,
      [E[key], date, kind, `${date}T${t}:00+05:30`, E.HR],
    );
  }
}
const april = (key: string) => status.getEmployeeMonthStatus(E[key]!, 2026, 4, TODAY);
const day = async (key: string, ymd: string) => (await april(key)).days.find((d) => d.logDate === ymd)!;
const logsFingerprint = async () =>
  (await pg.query<{ n: number; h: string }>(`select count(*)::int as n, coalesce(md5(string_agg(x::text, ',' order by x::text)), '') as h from attendance_logs x`)).rows[0]!;

beforeAll(async () => {
  const made = await createTestDb({ ...ATTENDANCE_TABLES, settingsEvents: schema.settingsEvents, notifications: schema.notifications });
  pg = made.pg;
  db = made.db;
  h.db = db;
  status = await import("@/lib/queries/attendance-status");
  hr = await import("@/app/(app)/hr/attendance-correction/actions");

  await addEmployee("HR", "2026-01-05T09:00:00+05:30");
  await addEmployee("SignedInOct", "2026-10-05T11:00:00+05:30"); // first WMS sign-in in October
  await addEmployee("NeverSignedIn", null); // joined_at null → created_at (21 July)
  await addEmployee("FirstPunchMid", "2026-10-05T11:00:00+05:30"); // first recorded punch 15 April
  await addEmployee("NoAprilData", "2026-10-05T11:00:00+05:30"); // nothing imported
  await addEmployee("RealEarlyJoin", "2026-01-05T09:00:00+05:30"); // a genuine earlier join stamp, no April punches

  // April 2026: Wed 1 … Thu 30; Sundays 5, 12, 19, 26.
  for (const d of ["2026-04-01", "2026-04-02", "2026-04-06"]) await imported("SignedInOct", d);
  await imported("NeverSignedIn", "2026-04-01");
  for (const d of ["2026-04-15", "2026-04-16"]) await imported("FirstPunchMid", d);
  h.me = { ...h.me, id: E.HR };
}, 180_000);
afterAll(async () => {
  await pg?.close();
});
beforeEach(() => {
  h.me = { ...h.me, id: E.HR };
});

describe("effectiveJoinDay (pure)", () => {
  it("is the earlier of the account join day and the first recorded attendance", () => {
    expect(effectiveJoinDay("2026-10-05", "2026-04-01")).toBe("2026-04-01");
    expect(effectiveJoinDay("2026-01-05", "2026-04-01")).toBe("2026-01-05");
    expect(effectiveJoinDay("2026-10-05", null)).toBe("2026-10-05");
    expect(effectiveJoinDay("2026-10-05", undefined)).toBe("2026-10-05");
  });
});

describe("the employee calendar (getEmployeeMonthStatus) — April 2026", () => {
  it("REGRESSION: imported April punches are shown, already in the database — nothing re-imported", async () => {
    for (const ymd of ["2026-04-01", "2026-04-02", "2026-04-06"]) {
      const d = await day("SignedInOct", ymd);
      expect(d).toMatchObject({ inAt: "09:30", outAt: "18:30" });
      expect(d.code).not.toBe(status.NOT_JOINED_CODE);
      expect(d.dayValue).toBeGreaterThan(0);
    }
  });

  it("…also for an employee who never signed in (created_at fallback)", async () => {
    expect(await day("NeverSignedIn", "2026-04-01")).toMatchObject({ inAt: "09:30", outAt: "18:30" });
    expect((await day("NeverSignedIn", "2026-04-01")).code).not.toBe(status.NOT_JOINED_CODE);
  });

  it("after the first punch, the month is graded normally: unpunched workdays are absent, Sundays weekly off", async () => {
    expect(await day("SignedInOct", "2026-04-03")).toMatchObject({ code: "A", dayValue: 0, inAt: null });
    expect(await day("SignedInOct", "2026-04-05")).toMatchObject({ code: "W/O", dayValue: 1 });
  });

  it("days BEFORE the first recorded punch are not treated as attendance days", async () => {
    const days = (await april("FirstPunchMid")).days;
    for (const d of days.filter((x) => x.logDate < "2026-04-15")) expect(d).toMatchObject({ code: status.NOT_JOINED_CODE, dayValue: 0 });
    expect(days.find((d) => d.logDate === "2026-04-15")).toMatchObject({ inAt: "09:30", outAt: "18:30" });
    expect(days.find((d) => d.logDate === "2026-04-15")!.code).not.toBe(status.NOT_JOINED_CODE);
  });

  it("an employee with no recorded April attendance is unchanged: the whole month is 'not joined'", async () => {
    const { days, summary } = await april("NoAprilData");
    expect(days.every((d) => d.code === status.NOT_JOINED_CODE)).toBe(true);
    expect(summary.payableDays).toBe(0);
  });

  it("an employee with a genuinely earlier join stamp is graded exactly as before", async () => {
    expect(await day("RealEarlyJoin", "2026-04-03")).toMatchObject({ code: "A" });
    expect(await day("RealEarlyJoin", "2026-04-05")).toMatchObject({ code: "W/O" });
  });

  it("a month BEFORE any recorded punch stays 'not joined' (March has no data)", async () => {
    const march = await status.getEmployeeMonthStatus(E.SignedInOct!, 2026, 3, TODAY);
    expect(march.days.every((d) => d.code === status.NOT_JOINED_CODE)).toBe(true);
  });

  it("KNOWN CONSEQUENCE: a later month with no data yet (May, before the October sign-in) is graded — its workdays read absent", async () => {
    const may = await status.getEmployeeMonthStatus(E.SignedInOct!, 2026, 5, TODAY);
    expect(may.days.find((d) => d.logDate === "2026-05-04")).toMatchObject({ code: "A" }); // a Monday, nothing imported yet
  });
});

describe("the monthly dashboard and salary summaries (getMonthDashboard) agree with the calendar", () => {
  it("April payable days now count the imported days, per employee, identical to the calendar's summary", async () => {
    const rows = await status.getMonthDashboard(2026, 4, TODAY);
    const by = new Map(rows.map((r) => [r.employeeId, r.summary]));
    for (const key of ["SignedInOct", "NeverSignedIn", "FirstPunchMid", "NoAprilData", "RealEarlyJoin"]) {
      expect(by.get(E[key]!), key).toEqual((await april(key)).summary);
    }
    expect(by.get(E.SignedInOct!)!.payableDays).toBeGreaterThan(0);
    expect(by.get(E.NoAprilData!)!.payableDays).toBe(0);
  });

  it("reading changes nothing: attendance rows are byte-identical and no salary run is created", async () => {
    const before = await logsFingerprint();
    await status.getMonthDashboard(2026, 4, TODAY);
    await april("SignedInOct");
    expect(await logsFingerprint()).toEqual(before);
    expect((await pg.query(`select 1 from salary_runs`)).rows).toEqual([]);
  });
});

describe("HR attendance correction follows the same rule", () => {
  const WHY = "Biometric machine was off; supervisor confirmed the time.";
  /** A correction preview for a day with nothing stored (adds an in-punch) — the plan check that refuses pre-join dates. */
  const preview = (key: string, date: string) =>
    hr.previewCorrection({ employeeId: E[key]!, date, inTime: "09:30", outTime: "", reason: "missed_punch", explanation: WHY, snapshot: { in: null, out: null } });

  it("the lookup reports the effective join day: the first recorded punch", async () => {
    const r = await hr.lookupDay({ employeeId: E.SignedInOct!, date: "2026-04-03" });
    if (!r.ok) throw new Error(r.error);
    expect(r.day.employee.joinDay).toBe("2026-04-01");
  });

  it("an April day from the first recorded punch on can now be corrected (preview only — nothing is saved)", async () => {
    const before = await logsFingerprint();
    const r = await preview("SignedInOct", "2026-04-03");
    expect(r.ok).toBe(true);
    expect(await logsFingerprint()).toEqual(before);
  });

  it("a day before the first recorded punch is still refused", async () => {
    expect(await preview("FirstPunchMid", "2026-04-10")).toEqual({ ok: false, error: expect.stringMatching(/joined on 2026-04-15/) });
  });

  it("an employee with no recorded attendance keeps their account join day", async () => {
    expect(await preview("NoAprilData", "2026-04-03")).toEqual({ ok: false, error: expect.stringMatching(/joined on 2026-10-05/) });
  });
});
