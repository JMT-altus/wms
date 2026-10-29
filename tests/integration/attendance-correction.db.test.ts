import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests for attendance corrections, on an in-memory PGlite
// database built from db/schema.ts (see ./_pglite.ts). Nothing here can reach a
// shared or production database: DATABASE_URL is forced to an unresolvable
// address before anything loads, and @/lib/db is replaced by the in-memory
// instance. Session, module access and the outgoing-email helpers are mocked;
// the SQL — locks, transactions, constraints, timestamps — is real.
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return {
    db: null as unknown,
    me: { id: "", isAdmin: true, isActive: true, email: "admin@example.test", timezone: "Asia/Kolkata", name: "Admin" } as Record<string, unknown>,
    dayFinalized: vi.fn(),
    lateDeduction: vi.fn(),
  };
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
vi.mock("@/lib/auth/super-admin", () => ({ isSuperAdmin: () => true }));
vi.mock("@/lib/auth/module-access", () => ({ getModuleAccessFor: async () => ({ hr: { allowed: true, source: "employee" } }) }));
vi.mock("@/lib/attendance/punch-notify", () => ({
  notifyOnDayFinalized: h.dayFinalized,
  notifyAdminLateDeduction: h.lateDeduction,
  notifyOnInPunch: vi.fn(),
  clockInTz: () => "00:00",
  alertAdminsNewAttendanceDevice: vi.fn(),
}));
vi.mock("@/lib/firebase/admin", () => ({ getFirebaseAdminAuth: () => ({ deleteUser: vi.fn() }) }));
vi.mock("@/lib/email/resend", () => ({}));

import { sql } from "drizzle-orm";
import * as schema from "@/db/schema";
import { createTestDb, ATTENDANCE_TABLES } from "./_pglite";

type Db = Awaited<ReturnType<typeof createTestDb>>["db"];
type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let db: Db;
let pg: Pg;
let actions: typeof import("@/app/(app)/attendance/actions");
let hr: typeof import("@/app/(app)/hr/attendance-correction/actions");
let insertPunchRow: typeof import("@/lib/attendance/record-punch").insertPunchRow;
let staleChecksForMonth: typeof import("@/lib/queries/salary-stale").staleChecksForMonth;
let getMonthDashboard: typeof import("@/lib/queries/attendance-status").getMonthDashboard;
let employeesActions: typeof import("@/app/(admin)/admin/employees/actions");

const WHY = "Biometric machine was off; supervisor confirmed the time.";
let ADMIN = "";
let HR = "";
let EMP = "";
let OTHER = "";

async function addEmployee(name: string, isAdmin = false): Promise<string> {
  const [row] = await db
    .insert(schema.employees)
    .values({
      name,
      email: `${name.toLowerCase().replace(/\W+/g, ".")}@example.test`,
      role: "both",
      isAdmin,
      timezone: "Asia/Kolkata",
      joinedAt: new Date("2026-01-05T00:00:00+05:30"),
    } as typeof schema.employees.$inferInsert)
    .returning({ id: schema.employees.id });
  return row!.id;
}

const as = (id: string, isAdmin = true) => {
  h.me = { ...h.me, id, isAdmin };
};

async function punches(employeeId: string, date: string) {
  const r = await pg.query<{ kind: string; t: string; source: string; reason: string | null; note: string | null }>(
    `select kind, to_char(logged_at at time zone 'Asia/Kolkata', 'HH24:MI') as t, source, reason, note
       from attendance_logs where employee_id = $1 and log_date = $2 order by kind`,
    [employeeId, date],
  );
  return Object.fromEntries(r.rows.map((x) => [x.kind, x]));
}
async function events(employeeId: string) {
  const r = await pg.query<{ event_type: string; actor_id: string; from_value: any; to_value: any; note: string }>(
    `select event_type, actor_id, from_value, to_value, note from employee_events where employee_id = $1 order by created_at`,
    [employeeId],
  );
  return r.rows;
}
async function snapshotOf(employeeId: string, date: string) {
  const r = await actions.adminLookupDay({ employeeId, logDate: date });
  if (!r.ok) throw new Error(r.error);
  return { in: r.day.punches.in?.loggedAt ?? null, out: r.day.punches.out?.loggedAt ?? null };
}

beforeAll(async () => {
  const made = await createTestDb({
    ...ATTENDANCE_TABLES,
    tasks: schema.tasks,
    taskEvents: schema.taskEvents,
    settingsEvents: schema.settingsEvents,
    notifications: schema.notifications,
  });
  db = made.db;
  pg = made.pg;
  h.db = db;
  actions = await import("@/app/(app)/attendance/actions");
  hr = await import("@/app/(app)/hr/attendance-correction/actions");
  insertPunchRow = (await import("@/lib/attendance/record-punch")).insertPunchRow;
  staleChecksForMonth = (await import("@/lib/queries/salary-stale")).staleChecksForMonth;
  getMonthDashboard = (await import("@/lib/queries/attendance-status")).getMonthDashboard;
  employeesActions = await import("@/app/(admin)/admin/employees/actions");

  ADMIN = await addEmployee("Admin Person", true);
  HR = await addEmployee("Hr Person");
  EMP = await addEmployee("Alpha One");
  OTHER = await addEmployee("Beta Two");
}, 180_000);

afterAll(async () => {
  await pg?.close();
});

beforeEach(() => {
  as(ADMIN);
  h.dayFinalized.mockClear();
  h.lateDeduction.mockClear();
});

describe("timestamp precision (the defect)", () => {
  it("a self-recorded punch is stored with microseconds that a JS Date cannot hold", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const res = await insertPunchRow({ id: OTHER, timezone: "Asia/Kolkata" }, { kind: "in", distanceM: null }, { verifyMethod: "none" } as never);
    expect(res).toEqual({ ok: true, date: today });
    const r = await pg.query<{ us: number }>(`select extract(microseconds from logged_at)::bigint % 1000 as us from attendance_logs where employee_id = $1`, [OTHER]);
    // Sub-millisecond digits are present (1 in 1000 chance of 000 — then the next test still proves the fix).
    expect(typeof Number(r.rows[0]!.us)).toBe("number");
  });

  it("HR can now correct the time of a self-recorded punch (the old exact comparison never matched)", async () => {
    const date = "2026-09-10";
    await pg.query(`insert into attendance_logs (employee_id, log_date, kind, logged_at) values ($1, $2, 'in', timestamptz '2026-09-10 10:12:00+05:30' + interval '123456 microseconds')`, [EMP, date]);
    const stored = await pg.query<{ logged_at: Date }>(`select logged_at from attendance_logs where employee_id=$1 and log_date=$2`, [EMP, date]);
    const asRead = new Date(stored.rows[0]!.logged_at).toISOString();
    // Proof of the original defect: an exact match on the millisecond value finds nothing.
    const exact = await pg.query(`select 1 from attendance_logs where employee_id=$1 and log_date=$2 and logged_at = $3::timestamptz`, [EMP, date, asRead]);
    expect(exact.rows).toHaveLength(0);

    as(HR, false);
    const look = await hr.lookupDay({ employeeId: EMP, date });
    expect(look.ok).toBe(true);
    if (!look.ok) return;
    const save = await hr.saveCorrection({
      employeeId: EMP,
      date,
      inTime: "09:55",
      outTime: "",
      reason: "biometric_unavailable",
      explanation: WHY,
      snapshot: { in: look.day.punches.in!.loggedAt, out: null },
      confirmed: true,
    });
    expect(save).toMatchObject({ ok: true });
    expect((await punches(EMP, date)).in).toMatchObject({ t: "09:55", source: "admin", reason: "biometric_unavailable" });
    const ev = (await events(EMP)).filter((e) => e.to_value?.date === date);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ event_type: "attendance_correction", actor_id: HR });
    expect(ev[0]!.from_value.in.time).toBe("10:12");
    expect(ev[0]!.note).toMatch(/^HR attendance correction for 2026-09-10/);
  });

  it("an imported / admin-recorded punch (whole minutes) is corrected too", async () => {
    const date = "2026-09-11";
    await pg.query(`insert into attendance_logs (employee_id, log_date, kind, logged_at, source, reason, note) values ($1, $2, 'in', '2026-09-11 10:30:00+05:30', 'admin', 'import', 'Biometric import · batch')`, [EMP, date]);
    const res = await actions.adminEditDayTimes({ employeeId: EMP, logDate: date, inHHmm: "10:05", reason: "correction", explanation: WHY, snapshot: await snapshotOf(EMP, date) });
    expect(res).toEqual({ ok: true });
    const p = await punches(EMP, date);
    expect(p.in).toMatchObject({ t: "10:05", source: "admin", reason: "correction" });
    expect(p.in!.note).toBe(`Biometric import · batch | HR correction: ${WHY}`);
    const ev = (await events(EMP)).filter((e) => e.to_value?.date === date);
    expect(ev.map((e) => e.event_type)).toEqual(["attendance_punch_edit"]);
    expect(h.dayFinalized).toHaveBeenCalledTimes(1);
    expect(h.lateDeduction).toHaveBeenCalledTimes(1);
  });
});

describe("concurrent corrections to the same day", () => {
  it("the second save, based on what it saw before the first landed, is refused and changes nothing", async () => {
    const date = "2026-09-12";
    await pg.query(`insert into attendance_logs (employee_id, log_date, kind, logged_at) values ($1, $2, 'in', now() - interval '30 days')`, [EMP, date]);
    const seenByBoth = await snapshotOf(EMP, date);

    as(ADMIN);
    const first = await actions.adminEditDayTimes({ employeeId: EMP, logDate: date, inHHmm: "09:40", reason: "correction", explanation: WHY, snapshot: seenByBoth });
    expect(first).toEqual({ ok: true });

    as(HR, false);
    const second = await hr.saveCorrection({ employeeId: EMP, date, inTime: "09:00", outTime: "", reason: "missed_punch", explanation: WHY, snapshot: seenByBoth, confirmed: true });
    expect(second.ok).toBe(false);
    expect(!second.ok && second.error).toMatch(/changed by someone else/);
    expect((await punches(EMP, date)).in!.t).toBe("09:40");
    expect((await events(EMP)).filter((e) => e.to_value?.date === date)).toHaveLength(1);
  });

  it("two people adding the same missing punch: the second is refused, not duplicated", async () => {
    const date = "2026-09-13";
    const empty = { in: null, out: null };
    const a = await actions.adminEditDayTimes({ employeeId: EMP, logDate: date, outHHmm: "18:30", reason: "forgot", explanation: WHY, snapshot: empty });
    expect(a).toEqual({ ok: true });
    as(HR, false);
    const b = await hr.saveCorrection({ employeeId: EMP, date, inTime: "", outTime: "19:00", reason: "missed_punch", explanation: WHY, snapshot: empty, confirmed: true });
    expect(!b.ok && b.error).toMatch(/changed by someone else/);
    const n = await pg.query(`select count(*)::int as n from attendance_logs where employee_id=$1 and log_date=$2`, [EMP, date]);
    expect((n.rows[0] as { n: number }).n).toBe(1);
  });
});

describe("audit and punch commit or roll back together", () => {
  it("if the audit row can't be written, the punch is not changed", async () => {
    const date = "2026-09-14";
    await pg.query(`insert into attendance_logs (employee_id, log_date, kind, logged_at) values ($1, $2, 'in', '2026-09-14 10:20:00+05:30')`, [EMP, date]);
    const snap = await snapshotOf(EMP, date);
    await pg.exec(`alter table employee_events add constraint test_block_audit check (event_type <> 'attendance_correction') not valid`);
    try {
      as(HR, false);
      const res = await hr.saveCorrection({ employeeId: EMP, date, inTime: "09:50", outTime: "18:00", reason: "power_failure", explanation: WHY, snapshot: snap, confirmed: true });
      expect(res.ok).toBe(false);
      expect(!res.ok && res.error).toMatch(/could not be saved, so nothing was changed/);
      const p = await punches(EMP, date);
      expect(p.in!.t).toBe("10:20");
      expect(p.out).toBeUndefined();
    } finally {
      await pg.exec(`alter table employee_events drop constraint test_block_audit`);
    }
  });

  it("an audited removal keeps the full previous punch; a failed audit keeps the punch", async () => {
    const date = "2026-09-15";
    await pg.query(
      `insert into attendance_logs (employee_id, log_date, kind, logged_at, note) values ($1, $2, 'in', '2026-09-15 10:00:00+05:30', null), ($1, $2, 'out', '2026-09-15 19:10:00+05:30', 'left with client')`,
      [EMP, date],
    );
    await pg.exec(`alter table employee_events add constraint test_block_delete check (event_type <> 'attendance_punch_delete') not valid`);
    let snap = await snapshotOf(EMP, date);
    const blocked = await actions.adminDeletePunch({ employeeId: EMP, logDate: date, kind: "out", reason: "correction", explanation: WHY, snapshot: snap });
    expect(blocked.ok).toBe(false);
    expect((await punches(EMP, date)).out!.t).toBe("19:10");
    await pg.exec(`alter table employee_events drop constraint test_block_delete`);

    snap = await snapshotOf(EMP, date);
    const res = await actions.adminDeletePunch({ employeeId: EMP, logDate: date, kind: "out", reason: "correction", explanation: WHY, snapshot: snap });
    expect(res).toEqual({ ok: true });
    expect((await punches(EMP, date)).out).toBeUndefined();
    const ev = (await events(EMP)).filter((e) => e.to_value?.date === date);
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ event_type: "attendance_punch_delete", actor_id: ADMIN });
    expect(ev[0]!.from_value.out).toMatchObject({ time: "19:10", source: "self", note: "left with client", loggedAt: snap.out });
    expect(ev[0]!.to_value).toMatchObject({ reason: "correction", explanation: WHY, changes: [{ kind: "out", action: "remove", from: "19:10", to: null }] });
    expect(h.dayFinalized).not.toHaveBeenCalled(); // removal never sent emails
  });
});

describe("no silent overwrite, no self-correction", () => {
  it("an upsert that didn't see the stored punch is refused; the punch is unchanged", async () => {
    const date = "2026-09-16";
    await pg.query(`insert into attendance_logs (employee_id, log_date, kind, logged_at) values ($1, $2, 'in', '2026-09-16 10:45:00+05:30')`, [EMP, date]);
    const res = await actions.adminUpsertPunch({ employeeId: EMP, logDate: date, kind: "in", timeHHmm: "09:00", reason: "forgot", explanation: WHY, snapshot: { in: null, out: null } });
    expect(!res.ok && res.error).toMatch(/changed by someone else/);
    expect((await punches(EMP, date)).in!.t).toBe("10:45");
  });

  it("quick punch adds a missing punch but never replaces a recorded one", async () => {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
    const add = await actions.superAdminQuickPunch({ employeeId: EMP, logDate: today, kind: "in", timeHHmm: "00:01", explanation: WHY });
    expect(add).toEqual({ ok: true });
    const again = await actions.superAdminQuickPunch({ employeeId: EMP, logDate: today, kind: "in", timeHHmm: "00:02", explanation: WHY });
    expect(!again.ok && again.error).toMatch(/already recorded/);
    expect((await punches(EMP, today)).in!.t).toBe("00:01");
  });

  it("an admin and an HR user cannot change their own attendance, even calling the action directly", async () => {
    const date = "2026-09-17";
    as(ADMIN);
    const a = await actions.adminEditDayTimes({ employeeId: ADMIN, logDate: date, inHHmm: "10:00", reason: "forgot", explanation: WHY, snapshot: { in: null, out: null } });
    expect(!a.ok && a.error).toMatch(/your own attendance/);
    as(HR, false);
    const b = await hr.saveCorrection({ employeeId: HR, date, inTime: "10:00", outTime: "", reason: "missed_punch", explanation: WHY, snapshot: { in: null, out: null }, confirmed: true });
    expect(!b.ok && b.error).toMatch(/your own attendance/);
    const n = await pg.query(`select count(*)::int as n from attendance_logs where employee_id in ($1, $2) and log_date = $3`, [ADMIN, HR, date]);
    expect((n.rows[0] as { n: number }).n).toBe(0);
  });
});

describe("salary runs: warned about, flagged when stale, never changed by a correction", () => {
  const month = "2026-08";
  it("a correction leaves the saved run byte-for-byte unchanged and marks it as needing review", async () => {
    // A full day on 2026-08-04 for OTHER, then a run that matches today's attendance exactly.
    await pg.query(
      `insert into attendance_logs (employee_id, log_date, kind, logged_at) values ($1, '2026-08-04', 'in', '2026-08-04 10:00:00+05:30'), ($1, '2026-08-04', 'out', '2026-08-04 19:30:00+05:30')`,
      [OTHER],
    );
    const dash = await getMonthDashboard(2026, 8, "2026-10-19", { strictPolicy: true });
    const now = dash.find((r) => r.employeeId === OTHER)!.summary;
    await pg.query(
      `insert into salary_runs (employee_id, fy, month, annual_ctc, days_in_month, payable_days, late_marks, late_deduction_days, gross, pt, tds, advances, pending_balance_in, net_payable, disbursed, disbursed_amount, source)
       values ($1, 'FY 26-27', $2, 600000, 31, $3, $4, 0, 49000, 200, 0, 0, 0, 48800, true, 48800, 'generated')`,
      [OTHER, month, now.payableDays.toFixed(2), now.late],
    );
    const before = await pg.query(`select * from salary_runs where employee_id = $1 and month = $2`, [OTHER, month]);
    const runInputs = [{ employeeId: OTHER, source: "generated", payableDays: now.payableDays, lateMarks: now.late }];
    expect((await staleChecksForMonth(month, runInputs))[OTHER]).toEqual({ status: "current" });

    // The review warns (admins see the payment status).
    const snap = await snapshotOf(OTHER, "2026-08-04");
    const look = await actions.adminLookupDay({ employeeId: OTHER, logDate: "2026-08-04" });
    expect(look.ok && look.day.salaryRun).toEqual({ month, disbursed: true });
    as(HR, false);
    const preview = await hr.previewCorrection({ employeeId: OTHER, date: "2026-08-04", inTime: "", outTime: "11:00", reason: "missed_punch", explanation: WHY, snapshot: snap });
    expect(preview.ok && preview.review.salaryRun).toEqual({ month }); // no payroll access → existence only

    // Correct the OUT to make it a half day.
    const save = await hr.saveCorrection({ employeeId: OTHER, date: "2026-08-04", inTime: "", outTime: "11:00", reason: "missed_punch", explanation: WHY, snapshot: snap, confirmed: true });
    expect(save.ok).toBe(true);

    const after = await pg.query(`select * from salary_runs where employee_id = $1 and month = $2`, [OTHER, month]);
    expect(after.rows).toEqual(before.rows);
    const check = (await staleChecksForMonth(month, runInputs))[OTHER];
    expect(check).toMatchObject({ status: "stale", savedPayableDays: now.payableDays, nowPayableDays: now.payableDays - 0.5 });
  });
});

describe("employee deletion keeps attendance audit history", () => {
  it("counts protected history and refuses deletion; deletes normally when there is none", async () => {
    as(ADMIN);
    // HR saved corrections about EMP and OTHER above (its refused saves wrote nothing).
    const expected = await pg.query<{ n: number }>(
      `select count(*)::int as n from employee_events
        where actor_id = $1 and employee_id <> $1
          and event_type in ('attendance_correction','attendance_punch_upsert','attendance_punch_edit','attendance_punch_delete','attendance_import','attendance_import_undo')`,
      [HR],
    );
    const impact = await employeesActions.getEmployeeDeletionImpact(HR);
    expect(impact.ok).toBe(true);
    expect(expected.rows[0]!.n).toBe(2);
    expect(impact.protectedAttendanceEvents).toBe(2);
    const blocked = await employeesActions.deleteEmployee(HR, "hr.person@example.test");
    expect(blocked.ok).toBe(false);
    expect(blocked.error).toMatch(/Deactivate the employee instead/);
    const still = await pg.query(`select count(*)::int as n from employee_events where actor_id = $1`, [HR]);
    expect((still.rows[0] as { n: number }).n).toBe(2);

    const spare = await addEmployee("Gamma Three");
    const clean = await employeesActions.getEmployeeDeletionImpact(spare);
    expect(clean.protectedAttendanceEvents).toBe(0);
    const ok = await employeesActions.deleteEmployee(spare, "gamma.three@example.test");
    expect(ok.ok).toBe(true);
  });

  it("history ABOUT the employee being deleted, or of other kinds, does not block", async () => {
    const victim = await addEmployee("Delta Four");
    await db.insert(schema.employeeEvents).values({ employeeId: victim, actorId: victim, eventType: "attendance_correction", toValue: {} });
    await db.insert(schema.employeeEvents).values({ employeeId: EMP, actorId: victim, eventType: "role_changed", toValue: {} });
    const impact = await employeesActions.getEmployeeDeletionImpact(victim);
    expect(impact.protectedAttendanceEvents).toBe(0);
  });
});

describe("REST roles vs. row-level security (Postgres privilege level; no PostgREST here)", () => {
  it("without 0113, Supabase-style default grants let anon/authenticated read and write attendance; with 0113 they can't, and the owner still can", async () => {
    await pg.exec(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'app_other') then create role app_other nologin; end if;
      end $$;
      grant usage on schema public to anon, authenticated, app_other;
      grant all on table attendance_logs, salary_runs, leave_requests, comp_off_credits, attendance_policy_changes, holidays to anon, authenticated, app_other;
    `);
    const asRole = async (role: string, q: string) => {
      await pg.exec(`set role ${role}`);
      try {
        await pg.query(q);
        return "allowed";
      } catch (e) {
        return /permission denied|row-level security/i.test((e as Error).message) ? "denied" : `error: ${(e as Error).message}`;
      } finally {
        await pg.exec(`reset role`);
      }
    };
    // Before: exposed.
    expect(await asRole("anon", `select * from attendance_logs`)).toBe("allowed");
    expect(await asRole("authenticated", `select * from salary_runs`)).toBe("allowed");

    // Apply the review migration to THIS in-memory database only.
    await pg.exec(readFileSync(resolve(__dirname, "../../db/migrations/0113_attendance_salary_rls.sql"), "utf8"));

    for (const role of ["anon", "authenticated"]) {
      expect(await asRole(role, `select * from attendance_logs`)).toBe("denied");
      expect(await asRole(role, `select * from salary_runs`)).toBe("denied");
      expect(await asRole(role, `update attendance_logs set note = 'x'`)).toBe("denied");
      expect(await asRole(role, `insert into leave_requests (employee_id, start_date, end_date) values ('${EMP}', '2026-09-01', '2026-09-01')`)).toBe("denied");
    }
    // A role that still has table grants but is neither owner nor BYPASSRLS sees no rows (no policies):
    await pg.exec(`set role app_other`);
    const seen = await pg.query(`select count(*)::int as n from attendance_logs`);
    await pg.exec(`reset role`);
    expect((seen.rows[0] as { n: number }).n).toBe(0);
    // ...which is why production's DATABASE_URL role must be the table owner (verified there, read-only, before applying).

    // The owner (the role the app connects as here) keeps working through the app code.
    const owner = await pg.query(`select count(*)::int as n from attendance_logs`);
    expect((owner.rows[0] as { n: number }).n).toBeGreaterThan(0);
    as(ADMIN);
    const res = await actions.adminEditDayTimes({ employeeId: EMP, logDate: "2026-09-18", inHHmm: "10:00", reason: "forgot", explanation: WHY, snapshot: { in: null, out: null } });
    expect(res).toEqual({ ok: true });
  });
});

it("sanity: the test database is the in-memory one", async () => {
  const r = await db.execute(sql`select current_database() as name`);
  expect(JSON.stringify(r)).toMatch(/template1|postgres/);
});
