import { beforeEach, describe, expect, it, vi } from "vitest";

// The admin day editor's actions and the HR correction actions with the
// database, session and email modules MOCKED: these prove the server-side
// rules (access, self-correction, validation, no silent overwrite, audit in the
// same transaction, email counts). Real Postgres behaviour is covered separately
// in tests/integration/attendance-correction.db.test.ts.
const h = vi.hoisted(() => ({
  me: { id: "99999999-9999-4999-8999-999999999999", isAdmin: true, isActive: true, email: "admin@example.test", timezone: "Asia/Kolkata" },
  admin: true,
  hr: true,
  superAdmin: true,
  selects: [] as unknown[][],
  updateReturns: [{ id: "u1" }] as { id: string }[],
  deleteReturns: [{ id: "d1" }] as { id: string }[],
  failAudit: false,
  dbExplodes: false,
  committed: { inserts: [] as Record<string, unknown>[], updates: [] as Record<string, unknown>[], deletes: 0, events: [] as Record<string, unknown>[] },
  transactions: 0,
  /** The quick-punch target's timezone row (db.query.employees.findFirst); null = no such employee. */
  quickPunchTarget: { timezone: "Asia/Kolkata" } as { timezone: string } | null,
  quickPunchLookupFails: false,
  dayFinalized: vi.fn(),
  lateDeduction: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current", () => ({
  requireUser: async () => h.me,
  requireAdmin: async () => {
    if (!h.admin) throw new Error("Forbidden");
    return h.me;
  },
}));
vi.mock("@/lib/auth/super-admin", () => ({ isSuperAdmin: () => h.superAdmin }));
vi.mock("@/lib/auth/module-access", () => ({
  getModuleAccessFor: async () => ({ hr: { allowed: h.hr, source: "employee" } }),
}));
vi.mock("@/lib/attendance/punch-notify", () => ({
  notifyOnDayFinalized: h.dayFinalized,
  notifyAdminLateDeduction: h.lateDeduction,
  notifyOnInPunch: vi.fn(),
  clockInTz: () => "00:00",
  alertAdminsNewAttendanceDevice: vi.fn(),
}));
vi.mock("@/lib/queries/attendance-status", () => ({
  getEmployeeMonthStatus: async () => ({ days: [] }),
}));

function selectChain(): unknown {
  const chain: Record<string, unknown> = {};
  for (const k of ["from", "where", "orderBy", "limit", "for", "innerJoin", "leftJoin"]) chain[k] = () => chain;
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve(h.selects.shift() ?? []).then(res);
  return chain;
}

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      employees: {
        findFirst: async () => {
          if (h.quickPunchLookupFails) throw new Error("connection to server at 10.0.0.1 failed: password authentication failed");
          return h.quickPunchTarget;
        },
      },
    },
    select: () => selectChain(),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      h.transactions++;
      if (h.dbExplodes) throw new Error("connection to server at 10.0.0.1 failed: password authentication failed");
      const inserts: Record<string, unknown>[] = [];
      const updates: Record<string, unknown>[] = [];
      const events: Record<string, unknown>[] = [];
      let deletes = 0;
      const tx = {
        select: () => selectChain(),
        insert: (table: Record<string, unknown>) => ({
          values: (v: Record<string, unknown>) => {
            if ("eventType" in table) {
              if (h.failAudit) throw new Error("audit insert failed");
              events.push(v);
            } else inserts.push(v);
            return Promise.resolve();
          },
        }),
        update: () => ({
          set: (v: Record<string, unknown>) => ({
            where: () => ({
              returning: async () => {
                updates.push(v);
                return h.updateReturns;
              },
            }),
          }),
        }),
        delete: () => ({
          where: () => ({
            returning: async () => {
              deletes += h.deleteReturns.length;
              return h.deleteReturns;
            },
          }),
        }),
      };
      const out = await fn(tx);
      // Only a transaction that finished is "committed".
      h.committed.inserts.push(...inserts);
      h.committed.updates.push(...updates);
      h.committed.events.push(...events);
      h.committed.deletes += deletes;
      return out;
    },
  },
}));

import {
  adminDeletePunch,
  adminEditDayTimes,
  adminLookupDay,
  adminUpsertPunch,
  superAdminQuickPunch,
} from "@/app/(app)/attendance/actions";
import { lookupDay, previewCorrection, saveCorrection } from "@/app/(app)/hr/attendance-correction/actions";

const ME = h.me.id;
const EMP = "11111111-1111-4111-8111-111111111111";
const WHY = "Biometric was down; supervisor confirmed the time.";
const IN_ISO = "2026-04-01T04:40:00.000Z"; // 10:10 IST
const OUT_ISO = "2026-04-01T14:00:00.000Z"; // 19:30 IST
const employee = (over: Record<string, unknown> = {}) => ({
  id: EMP,
  name: "Alpha One",
  email: "alpha@example.test",
  timezone: "Asia/Kolkata",
  isActive: true,
  joinedAt: new Date("2026-01-05T00:00:00+05:30"),
  createdAt: new Date("2026-01-01T00:00:00Z"),
  ...over,
});
const row = (kind: "in" | "out", iso: string, over: Record<string, unknown> = {}) => ({
  id: `row-${kind}`,
  kind,
  loggedAt: new Date(iso),
  note: null,
  source: "self",
  reason: null,
  ...over,
});
const target = { id: EMP, timezone: "Asia/Kolkata", attLateAfter: null, attEarlyBefore: null };
const edit = (over: Record<string, unknown> = {}) =>
  adminEditDayTimes({
    employeeId: EMP,
    logDate: "2026-04-01",
    inHHmm: "09:45",
    reason: "correction",
    explanation: WHY,
    snapshot: { in: IN_ISO, out: null },
    ...over,
  });
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());

beforeEach(() => {
  h.me = { ...h.me, id: ME, isAdmin: true };
  h.admin = true;
  h.hr = true;
  h.superAdmin = true;
  h.selects = [];
  h.updateReturns = [{ id: "u1" }];
  h.deleteReturns = [{ id: "d1" }];
  h.failAudit = false;
  h.dbExplodes = false;
  h.committed = { inserts: [], updates: [], deletes: 0, events: [] };
  h.transactions = 0;
  h.quickPunchTarget = { timezone: "Asia/Kolkata" };
  h.quickPunchLookupFails = false;
  h.dayFinalized.mockClear();
  h.lateDeduction.mockClear();
});

describe("quick punch: 'today' is the employee's today, in the employee's timezone", () => {
  // UTC+14 and UTC−10 are exactly a day apart: their dates differ at every moment.
  const dayIn = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  const call = (logDate: string) => superAdminQuickPunch({ employeeId: EMP, logDate, kind: "in", timeHHmm: "10:00", explanation: WHY });

  it("accepts the employee's today even when it is not the acting super-admin's today", async () => {
    h.me = { ...h.me, timezone: "Pacific/Honolulu" }; // the actor's own timezone must not decide
    h.quickPunchTarget = { timezone: "Pacific/Kiritimati" };
    h.selects = [[employee({ timezone: "Pacific/Kiritimati" })], [], []];
    const r = await call(dayIn("Pacific/Kiritimati"));
    expect(r).not.toEqual({ ok: false, error: "Quick punch is for today only." });
  });

  it("refuses the acting super-admin's today when it is not the employee's today", async () => {
    h.me = { ...h.me, timezone: "Pacific/Honolulu" };
    h.quickPunchTarget = { timezone: "Pacific/Kiritimati" };
    expect(await call(dayIn("Pacific/Honolulu"))).toEqual({ ok: false, error: "Quick punch is for today only." });
    expect(h.transactions).toBe(0);
  });

  it("an employee with no timezone is reckoned in IST (the business default)", async () => {
    h.quickPunchTarget = { timezone: "" };
    h.selects = [[employee()], [], []];
    expect(await call(dayIn("Asia/Kolkata"))).not.toEqual({ ok: false, error: "Quick punch is for today only." });
    // Kiritimati and Honolulu are a day apart, so at least one of them is not IST's date right now.
    const notIst = [dayIn("Pacific/Kiritimati"), dayIn("Pacific/Honolulu")].find((d) => d !== dayIn("Asia/Kolkata"))!;
    expect(await call(notIst)).toEqual({ ok: false, error: "Quick punch is for today only." });
  });

  it("an unknown employee is refused before anything is written", async () => {
    h.quickPunchTarget = null;
    expect(await call(today())).toEqual({ ok: false, error: "Employee not found." });
    expect(h.transactions).toBe(0);
  });

  it("a failed lookup returns a plain message — no database details reach the browser", async () => {
    h.quickPunchLookupFails = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await call(today());
    expect(r).toEqual({ ok: false, error: "The attendance change could not be saved, so nothing was changed. Please try again." });
    expect(JSON.stringify(r)).not.toMatch(/10\.0\.0\.1|password/);
    expect(h.transactions).toBe(0);
    err.mockRestore();
  });
});

describe("authorisation (direct calls, no UI)", () => {
  it("every admin action refuses a non-admin before reading or writing", async () => {
    h.admin = false;
    await expect(edit()).rejects.toThrow("Forbidden");
    await expect(adminUpsertPunch({})).rejects.toThrow("Forbidden");
    await expect(adminDeletePunch({})).rejects.toThrow("Forbidden");
    await expect(superAdminQuickPunch({})).rejects.toThrow("Forbidden");
    await expect(adminLookupDay({})).rejects.toThrow("Forbidden");
    expect(h.transactions).toBe(0);
  });

  it("quick punch stays super-admin only and today only", async () => {
    h.superAdmin = false;
    const r1 = await superAdminQuickPunch({ employeeId: EMP, logDate: today(), kind: "in", timeHHmm: "10:00", explanation: WHY });
    expect(r1).toEqual({ ok: false, error: "Only super-admins can mark attendance here." });
    h.superAdmin = true;
    const r2 = await superAdminQuickPunch({ employeeId: EMP, logDate: "2026-04-01", kind: "in", timeHHmm: "10:00", explanation: WHY });
    expect(r2).toEqual({ ok: false, error: "Quick punch is for today only." });
    expect(h.transactions).toBe(0);
  });
});

describe("no one corrects their own attendance", () => {
  const own = { employeeId: ME };
  it("admin editor: edit, add, remove and lookup all refuse the admin's own record", async () => {
    for (const res of [
      await edit(own),
      await adminUpsertPunch({ employeeId: ME, logDate: "2026-04-01", kind: "in", timeHHmm: "10:00", reason: "forgot", explanation: WHY, snapshot: { in: null, out: null } }),
      await adminDeletePunch({ employeeId: ME, logDate: "2026-04-01", kind: "in", reason: "correction", explanation: WHY, snapshot: { in: IN_ISO, out: null } }),
      await adminLookupDay({ employeeId: ME, logDate: "2026-04-01" }),
    ]) {
      expect(res.ok).toBe(false);
      expect(!res.ok && res.error).toMatch(/can't change your own attendance/);
    }
    expect(h.transactions).toBe(0);
    expect(h.committed.events).toEqual([]);
  });

  it("super-admin quick punch refuses the super-admin's own record", async () => {
    const res = await superAdminQuickPunch({ employeeId: ME, logDate: today(), kind: "in", timeHHmm: "10:00", explanation: WHY });
    expect(!res.ok && res.error).toMatch(/can't change your own attendance/);
    expect(h.transactions).toBe(0);
  });

  it("HR correction: lookup, preview and save refuse the HR user's own record", async () => {
    h.admin = false;
    h.me = { ...h.me, isAdmin: false };
    const body = { employeeId: ME, date: "2026-04-01", inTime: "10:00", outTime: "", reason: "power_failure", explanation: WHY, snapshot: { in: null, out: null } };
    for (const res of [await lookupDay({ employeeId: ME, date: "2026-04-01" }), await previewCorrection(body), await saveCorrection({ ...body, confirmed: true })]) {
      expect(!res.ok && res.error).toMatch(/can't change your own attendance/);
    }
    expect(h.transactions).toBe(0);
  });

  it("the same people can still correct someone else", async () => {
    h.selects = [[employee()], [row("in", IN_ISO)], [target]];
    expect((await edit()).ok).toBe(true);
    h.selects = [[employee()], []];
    const hr = await saveCorrection({ employeeId: EMP, date: "2026-04-01", inTime: "10:00", outTime: "", reason: "power_failure", explanation: WHY, snapshot: { in: null, out: null }, confirmed: true });
    expect(hr.ok).toBe(true);
  });
});

describe("admin edit (adminEditDayTimes)", () => {
  it("needs a reason, an explanation and the snapshot", async () => {
    expect((await edit({ explanation: "" })).ok).toBe(false);
    expect((await edit({ reason: undefined })).ok).toBe(false);
    expect((await edit({ snapshot: undefined })).ok).toBe(false);
    h.selects = [[employee()], [row("in", IN_ISO)]];
    const short = await edit({ explanation: "late" });
    expect(!short.ok && short.error).toMatch(/meaningful explanation/);
    expect(h.committed.updates).toEqual([]);
  });

  it("changes the stored time and adds the missing side in ONE transaction with one audit row", async () => {
    h.selects = [[employee()], [row("in", IN_ISO)], [target]];
    const res = await edit({ inHHmm: "09:45", outHHmm: "18:30" });
    expect(res).toEqual({ ok: true });
    expect(h.transactions).toBe(1);
    expect(h.committed.updates).toHaveLength(1);
    expect(h.committed.inserts.map((i) => i.kind)).toEqual(["out"]);
    expect(h.committed.events).toHaveLength(1);
    expect(h.committed.events[0]).toMatchObject({
      eventType: "attendance_punch_edit",
      actorId: ME,
      employeeId: EMP,
      fromValue: { date: "2026-04-01", in: { time: "10:10", loggedAt: IN_ISO, source: "self" }, out: null },
      toValue: { via: "admin_day_editor", reason: "correction", explanation: WHY, finalIn: "09:45", finalOut: "18:30" },
    });
  });

  it("refuses when the stored punch differs from what the admin saw (no overwrite)", async () => {
    h.selects = [[employee()], [row("in", "2026-04-01T04:55:00.000Z")]];
    const res = await edit();
    expect(!res.ok && res.error).toMatch(/changed by someone else/);
    expect(h.committed.updates).toEqual([]);
    expect(h.committed.events).toEqual([]);
  });

  it("applies the same date rules as HR: no future dates, nothing before joining, no inactive employees", async () => {
    h.selects = [[employee()], []];
    const future = await edit({ logDate: "2999-01-01", snapshot: { in: null, out: null } });
    expect(!future.ok && future.error).toMatch(/future/);
    h.selects = [[employee()], []];
    const early = await edit({ logDate: "2025-12-01", snapshot: { in: null, out: null } });
    expect(!early.ok && early.error).toMatch(/joined on/);
    h.selects = [[employee({ isActive: false })]];
    const inactive = await edit();
    expect(!inactive.ok && inactive.error).toMatch(/inactive/);
  });

  it("rolls back the punch change when the audit row can't be written", async () => {
    h.failAudit = true;
    h.selects = [[employee()], [row("in", IN_ISO)]];
    const res = await edit();
    expect(res.ok).toBe(false);
    expect(h.committed.updates).toEqual([]);
    expect(h.committed.events).toEqual([]);
  });

  it("never leaks database internals", async () => {
    h.dbExplodes = true;
    const res = await edit();
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).not.toMatch(/10\.0\.0\.1|password|DB:/);
  });
});

describe("admin upsert: never a silent overwrite", () => {
  const upsert = (over: Record<string, unknown> = {}) =>
    adminUpsertPunch({ employeeId: EMP, logDate: "2026-04-01", kind: "in", timeHHmm: "09:50", reason: "forgot", explanation: WHY, snapshot: { in: null, out: null }, ...over });

  it("adds a missing punch", async () => {
    h.selects = [[employee()], [], [target]];
    expect(await upsert()).toEqual({ ok: true });
    expect(h.committed.inserts).toHaveLength(1);
    expect(h.committed.events[0]).toMatchObject({ eventType: "attendance_punch_upsert" });
  });

  it("refuses to replace a punch the admin did not see", async () => {
    h.selects = [[employee()], [row("in", IN_ISO)]];
    const res = await upsert({ snapshot: { in: null, out: null } });
    expect(!res.ok && res.error).toMatch(/changed by someone else/);
    expect(h.committed.updates).toEqual([]);
  });

  it("replaces it only when the snapshot shows it, keeping the old value in the audit", async () => {
    h.selects = [[employee()], [row("in", IN_ISO)], [target]];
    expect(await upsert({ snapshot: { in: IN_ISO, out: null } })).toEqual({ ok: true });
    expect(h.committed.events[0]).toMatchObject({ fromValue: { in: { time: "10:10" } }, toValue: { changes: [{ kind: "in", action: "change", from: "10:10", to: "09:50" }] } });
  });
});

describe("super-admin quick punch", () => {
  const quick = (over: Record<string, unknown> = {}) =>
    superAdminQuickPunch({ employeeId: EMP, logDate: today(), kind: "in", timeHHmm: "09:58", explanation: WHY, ...over });

  it("adds a missing punch with the fixed reason, an explanation and an audit row", async () => {
    h.selects = [[employee()], [], [target]];
    expect(await quick()).toEqual({ ok: true });
    expect(h.committed.inserts[0]).toMatchObject({ kind: "in", reason: "correction", note: WHY, source: "admin", recordedById: ME });
    expect(h.committed.events[0]).toMatchObject({ eventType: "attendance_punch_upsert", toValue: { via: "super_admin_quick_punch" } });
  });

  it("never replaces a punch that is already recorded", async () => {
    h.selects = [[employee()], [row("in", new Date().toISOString())]];
    const res = await quick();
    expect(!res.ok && res.error).toMatch(/already recorded/);
    expect(h.committed.updates).toEqual([]);
  });

  it("needs an explanation", async () => {
    expect((await quick({ explanation: undefined })).ok).toBe(false);
  });
});

describe("audited removal (adminDeletePunch)", () => {
  const del = (over: Record<string, unknown> = {}) =>
    adminDeletePunch({ employeeId: EMP, logDate: "2026-04-01", kind: "out", reason: "correction", explanation: WHY, snapshot: { in: IN_ISO, out: OUT_ISO }, ...over });

  it("can't remove without a reason and an explanation", async () => {
    expect((await del({ reason: undefined })).ok).toBe(false);
    expect((await del({ explanation: undefined })).ok).toBe(false);
    expect(h.transactions).toBe(0);
  });

  it("removes the punch and keeps its full previous details in the same transaction", async () => {
    h.selects = [[employee()], [row("in", IN_ISO), row("out", OUT_ISO, { note: "left for client", source: "self" })]];
    expect(await del()).toEqual({ ok: true });
    expect(h.committed.deletes).toBe(1);
    expect(h.committed.events).toHaveLength(1);
    expect(h.committed.events[0]).toMatchObject({
      eventType: "attendance_punch_delete",
      fromValue: { out: { id: "row-out", time: "19:30", loggedAt: OUT_ISO, source: "self", note: "left for client" } },
      toValue: { reason: "correction", explanation: WHY, changes: [{ kind: "out", action: "remove", from: "19:30", to: null }], finalOut: null, finalIn: "10:10" },
    });
  });

  it("refuses a stale snapshot, and rolls back when the audit fails", async () => {
    h.selects = [[employee()], [row("in", IN_ISO)]];
    expect((await del()).ok).toBe(false); // OUT already gone
    h.failAudit = true;
    h.selects = [[employee()], [row("in", IN_ISO), row("out", OUT_ISO)]];
    expect((await del()).ok).toBe(false);
    expect(h.committed.deletes).toBe(0);
  });

  it("refuses when the punch was changed between the lock and the delete", async () => {
    h.deleteReturns = [];
    h.selects = [[employee()], [row("in", IN_ISO), row("out", OUT_ISO)]];
    const res = await del();
    expect(!res.ok && res.error).toMatch(/changed by someone else/);
    expect(h.committed.events).toEqual([]);
  });
});

describe("emails: preserved, never duplicated", () => {
  it("an admin add/edit sends the day-finalised and late-deduction checks exactly once, after commit", async () => {
    h.selects = [[employee()], [row("in", IN_ISO)], [target]];
    await edit({ outHHmm: "18:30" });
    expect(h.dayFinalized).toHaveBeenCalledTimes(1);
    expect(h.lateDeduction).toHaveBeenCalledTimes(1);
    expect(h.dayFinalized).toHaveBeenCalledWith(target, "2026-04-01");
  });

  it("a failed or refused change sends nothing", async () => {
    h.failAudit = true;
    h.selects = [[employee()], [row("in", IN_ISO)]];
    await edit();
    h.failAudit = false;
    await edit({ employeeId: ME });
    expect(h.dayFinalized).not.toHaveBeenCalled();
    expect(h.lateDeduction).not.toHaveBeenCalled();
  });

  it("removal and HR corrections send none, as before", async () => {
    h.selects = [[employee()], [row("in", IN_ISO), row("out", OUT_ISO)]];
    await adminDeletePunch({ employeeId: EMP, logDate: "2026-04-01", kind: "out", reason: "correction", explanation: WHY, snapshot: { in: IN_ISO, out: OUT_ISO } });
    h.selects = [[employee()], []];
    await saveCorrection({ employeeId: EMP, date: "2026-04-01", inTime: "10:00", outTime: "18:00", reason: "power_failure", explanation: WHY, snapshot: { in: null, out: null }, confirmed: true });
    expect(h.dayFinalized).not.toHaveBeenCalled();
    expect(h.lateDeduction).not.toHaveBeenCalled();
  });
});

describe("salary-run notice", () => {
  it("admin lookup reports an existing run and whether it was disbursed, without amounts", async () => {
    h.selects = [[employee()], [row("in", IN_ISO)], [{ disbursed: true, gross: "50000.00" }]];
    const res = await adminLookupDay({ employeeId: EMP, logDate: "2026-04-01" });
    expect(res.ok && res.day.salaryRun).toEqual({ month: "2026-04", disbursed: true });
    expect(res.ok && res.day.punches.in).toEqual({ time: "10:10", loggedAt: IN_ISO });
  });

  it("an HR user without payroll access sees only that a run exists", async () => {
    h.admin = false;
    h.me = { ...h.me, isAdmin: false };
    h.selects = [[employee()], [], [{ disbursed: true }]];
    const res = await previewCorrection({ employeeId: EMP, date: "2026-04-01", inTime: "10:00", outTime: "", reason: "power_failure", explanation: WHY, snapshot: { in: null, out: null } });
    expect(res.ok && res.review.salaryRun).toEqual({ month: "2026-04" });
  });

  it("an admin's HR review also shows the payment status; no run means no notice", async () => {
    h.selects = [[employee()], [], [{ disbursed: false }]];
    const body = { employeeId: EMP, date: "2026-04-01", inTime: "10:00", outTime: "", reason: "power_failure", explanation: WHY, snapshot: { in: null, out: null } };
    const res = await previewCorrection(body);
    expect(res.ok && res.review.salaryRun).toEqual({ month: "2026-04", disbursed: false });
    h.selects = [[employee()], [], []];
    const none = await previewCorrection(body);
    expect(none.ok && none.review.salaryRun).toBeNull();
  });
});
