import { beforeEach, describe, expect, it, vi } from "vitest";

// Server-action behaviour with the database, sign-in, access check, grading query
// and email module all mocked: nothing here touches a real database or real data.
const h = vi.hoisted(() => ({
  selects: [] as unknown[][],
  hr: true,
  gradeFails: false,
  failOn: null as null | "events" | "attendance-insert" | "unique",
  updateReturns: [{ id: "u1" }] as { id: string }[],
  committed: { inserts: [] as Record<string, unknown>[], updates: [] as Record<string, unknown>[], events: [] as Record<string, unknown>[] },
  transactions: 0,
  notify: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current", () => ({
  requireUser: async () => ({ id: "99999999-9999-4999-8999-999999999999", isAdmin: false, isActive: true, email: "hr@example.test" }),
}));
vi.mock("@/lib/auth/module-access", () => ({
  getModuleAccessFor: async () => ({ hr: { allowed: h.hr, source: h.hr ? "employee" : "default" } }),
}));
// The existing editor's emails live here. This workflow must never call them.
vi.mock("@/lib/attendance/punch-notify", () => ({
  notifyOnDayFinalized: h.notify,
  notifyAdminLateDeduction: h.notify,
  notifyOnInPunch: h.notify,
}));
vi.mock("@/lib/queries/attendance-status", () => ({
  getEmployeeMonthStatus: async () => {
    if (h.gradeFails) throw new Error("grading unavailable");
    return { days: [{ logDate: "2026-04-01", code: "P", late: false, lateWaived: false, leftEarly: false, workedMinutes: 540 }] };
  },
}));

function selectChain(): unknown {
  const chain: Record<string, unknown> = {};
  for (const k of ["from", "where", "orderBy", "limit", "for"]) chain[k] = () => chain;
  chain.then = (res: (v: unknown) => unknown) => Promise.resolve(h.selects.shift() ?? []).then(res);
  return chain;
}

vi.mock("@/lib/db", () => ({
  db: {
    select: () => selectChain(),
    transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      h.transactions++;
      const inserts: Record<string, unknown>[] = [];
      const updates: Record<string, unknown>[] = [];
      const events: Record<string, unknown>[] = [];
      const tx = {
        select: () => selectChain(),
        insert: (table: Record<string, unknown>) => ({
          values: (v: Record<string, unknown>) => {
            if ("eventType" in table) {
              if (h.failOn === "events") throw new Error("db exploded: audit");
              events.push(v);
            } else {
              if (h.failOn === "unique") throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
              if (h.failOn === "attendance-insert") throw new Error("db exploded: punch");
              inserts.push(v);
            }
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
      };
      const out = await fn(tx);
      // Only a transaction that finished is "committed"; a throw rolls everything back.
      h.committed.inserts.push(...inserts);
      h.committed.updates.push(...updates);
      h.committed.events.push(...events);
      return out;
    },
  },
}));

import { lookupDay, previewCorrection, saveCorrection } from "@/app/(app)/hr/attendance-correction/actions";

const ME = "99999999-9999-4999-8999-999999999999";
const EMP = "11111111-1111-4111-8111-111111111111";
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
// 10:10 IST on 2026-04-01 and 19:30 IST on 2026-04-01.
const IN_ISO = "2026-04-01T04:40:00.000Z";
const OUT_ISO = "2026-04-01T14:00:00.000Z";
const row = (kind: "in" | "out", iso: string, over: Record<string, unknown> = {}) => ({
  id: `row-${kind}`,
  kind,
  loggedAt: new Date(iso),
  note: null,
  source: "self",
  reason: null,
  ...over,
});

const body = (over: Record<string, unknown> = {}) => ({
  employeeId: EMP,
  date: "2026-04-01",
  inTime: "10:00",
  outTime: "18:00",
  reason: "power_failure",
  explanation: "Power cut from 9 to 11:30, machine was off.",
  snapshot: { in: null, out: null },
  ...over,
});
const save = (over: Record<string, unknown> = {}) => saveCorrection({ ...body(over), confirmed: true });

beforeEach(() => {
  h.selects = [];
  h.hr = true;
  h.gradeFails = false;
  h.failOn = null;
  h.updateReturns = [{ id: "u1" }];
  h.committed = { inserts: [], updates: [], events: [] };
  h.transactions = 0;
  h.notify.mockClear();
});

describe("access", () => {
  it("every action refuses a caller without HR access, before reading or writing anything", async () => {
    h.hr = false;
    await expect(lookupDay({ employeeId: EMP, date: "2026-04-01" })).rejects.toThrow("Forbidden");
    await expect(previewCorrection(body())).rejects.toThrow("Forbidden");
    await expect(save()).rejects.toThrow("Forbidden");
    expect(h.transactions).toBe(0);
    expect(h.selects).toEqual([]);
  });
});

describe("lookupDay", () => {
  it("shows the stored punches and the current day code", async () => {
    h.selects = [[employee()], [row("in", IN_ISO, { note: "bus" }), row("out", OUT_ISO)]];
    const res = await lookupDay({ employeeId: EMP, date: "2026-04-01" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.day.punches.in).toMatchObject({ time: "10:10", loggedAt: IN_ISO, source: "self", note: "bus" });
    expect(res.day.punches.out).toMatchObject({ time: "19:30" });
    expect(res.day.grade).toMatchObject({ code: "P", workedMinutes: 540 });
    expect(res.day.employee.joinDay).toBe("2026-01-05");
  });

  it("works for an empty day, and still loads if grading is unavailable", async () => {
    h.gradeFails = true;
    h.selects = [[employee()], []];
    const res = await lookupDay({ employeeId: EMP, date: "2026-04-01" });
    expect(res.ok && res.day.punches).toEqual({ in: null, out: null });
    expect(res.ok && res.day.grade).toBeNull();
  });

  it("refuses unknown or inactive employees and bad dates with friendly messages", async () => {
    h.selects = [[]];
    expect(await lookupDay({ employeeId: EMP, date: "2026-04-01" })).toEqual({ ok: false, error: "That employee was not found." });
    h.selects = [[employee({ isActive: false })]];
    const inactive = await lookupDay({ employeeId: EMP, date: "2026-04-01" });
    expect(!inactive.ok && inactive.error).toMatch(/inactive/);
    expect((await lookupDay({ employeeId: EMP, date: "2026-02-31" })).ok).toBe(false);
    expect((await lookupDay({ employeeId: "nope", date: "2026-04-01" })).ok).toBe(false);
  });
});

describe("previewCorrection", () => {
  it("shows existing vs proposed and writes nothing", async () => {
    h.selects = [[employee()], [row("in", IN_ISO)]];
    const res = await previewCorrection(body({ inTime: "", outTime: "18:30", snapshot: { in: IN_ISO, out: null } }));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.review.changes).toEqual([{ kind: "out", action: "add", from: null, to: "18:30" }]);
    expect(res.review).toMatchObject({ finalIn: "10:10", finalOut: "18:30", reason: { code: "power_failure", label: "Power failure" } });
    expect(h.transactions).toBe(0);
  });

  it("warns that an imported punch will stop being undoable, and says the note is kept", async () => {
    h.selects = [[employee()], [row("in", IN_ISO, { note: "Biometric import · 33333333-3333-4333-8333-333333333333", source: "admin" })]];
    const res = await previewCorrection(body({ inTime: "09:30", outTime: "", snapshot: { in: IN_ISO, out: null } }));
    expect(res.ok && res.review.warnings[0]).toMatch(/came from a bulk import/);
    expect(res.ok && res.review.keepsNotes).toEqual(["Biometric import · 33333333-3333-4333-8333-333333333333"]);
  });

  it("returns the rule failures as clear errors", async () => {
    h.selects = [[employee()], []];
    const future = await previewCorrection(body({ date: "2999-01-01" }));
    expect(!future.ok && future.error).toMatch(/future/);
    h.selects = [[employee()], []];
    expect((await previewCorrection(body({ explanation: "" }))).ok).toBe(false);
  });
});

describe("saveCorrection: adding punches", () => {
  it("enters attendance for a day with no punches: two admin punches with reason and note, plus the audit row", async () => {
    h.selects = [[employee()], []];
    const res = await save();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(h.committed.inserts).toHaveLength(2);
    expect(h.committed.inserts[0]).toMatchObject({
      employeeId: EMP,
      logDate: "2026-04-01",
      kind: "in",
      source: "admin",
      reason: "power_failure",
      note: "Power cut from 9 to 11:30, machine was off.",
      recordedById: ME,
      verifyMethod: "none",
    });
    expect((h.committed.inserts[0]!.loggedAt as Date).toISOString()).toBe("2026-04-01T04:30:00.000Z"); // 10:00 IST
    expect(h.committed.updates).toEqual([]);
    expect(res.saved).toMatchObject({ in: "10:00", out: "18:00", employeeName: "Alpha One", grade: { code: "P" } });
  });

  it("adds a missing OUT without touching the stored IN", async () => {
    h.selects = [[employee()], [row("in", IN_ISO)]];
    const res = await save({ inTime: "", outTime: "18:30", snapshot: { in: IN_ISO, out: null } });
    expect(res.ok).toBe(true);
    expect(h.committed.inserts.map((i) => i.kind)).toEqual(["out"]);
    expect(h.committed.updates).toEqual([]);
    expect(res.ok && res.saved.in).toBe("10:10");
  });
});

describe("saveCorrection: correcting an existing punch", () => {
  it("updates the time, keeps the existing note by appending, and audits previous and new values", async () => {
    h.selects = [[employee()], [row("in", IN_ISO, { note: "Reached late", reason: "forgot", source: "admin" })]];
    const res = await save({ inTime: "09:45", outTime: "", snapshot: { in: IN_ISO, out: null } });
    expect(res.ok).toBe(true);
    expect(h.committed.inserts).toEqual([]);
    expect(h.committed.updates).toHaveLength(1);
    expect(h.committed.updates[0]).toMatchObject({
      source: "admin",
      reason: "power_failure",
      recordedById: ME,
      note: "Reached late | HR correction: Power cut from 9 to 11:30, machine was off.",
    });
    expect((h.committed.updates[0]!.loggedAt as Date).toISOString()).toBe("2026-04-01T04:15:00.000Z");

    expect(h.committed.events).toHaveLength(1);
    const ev = h.committed.events[0] as { eventType: string; actorId: string; employeeId: string; note: string; fromValue: any; toValue: any };
    expect(ev).toMatchObject({ eventType: "attendance_correction", actorId: ME, employeeId: EMP });
    expect(ev.fromValue.in).toMatchObject({ time: "10:10", note: "Reached late", source: "admin", reason: "forgot" });
    expect(ev.fromValue.out).toBeNull();
    expect(ev.toValue).toMatchObject({
      date: "2026-04-01",
      reason: "power_failure",
      reasonLabel: "Power failure",
      explanation: "Power cut from 9 to 11:30, machine was off.",
      finalIn: "09:45",
      changes: [{ kind: "in", action: "change", from: "10:10", to: "09:45" }],
    });
    expect(ev.note).toMatch(/HR attendance correction for 2026-04-01 \(Power failure\)/);
  });
});

describe("saveCorrection: validation (nothing is written)", () => {
  const writes = () => h.committed.inserts.length + h.committed.updates.length + h.committed.events.length;

  it("needs the explicit confirmation", async () => {
    expect((await saveCorrection(body())).ok).toBe(false);
    expect((await saveCorrection({ ...body(), confirmed: false })).ok).toBe(false);
    expect(h.transactions).toBe(0);
  });

  it.each([
    ["a future date", { date: "2999-01-01" }, /future/],
    ["a date before joining", { date: "2025-12-31" }, /joined on 2026-01-05/],
    ["OUT earlier than IN", { inTime: "18:00", outTime: "09:00" }, /can't be earlier than IN/],
    ["a bad time format", { inTime: "9.30" }, /HH:mm/],
    ["no times at all", { inTime: "", outTime: "" }, /Enter an IN time/],
    ["a missing explanation", { explanation: "" }, /required/],
    ["a too-short explanation for Other", { reason: "other", explanation: "machine broke" }, /Other/],
    ["no reason", { reason: "" }, /reason/i],
  ])("rejects %s", async (_n, over, msg) => {
    h.selects = [[employee()], []];
    const res = await save(over as Record<string, unknown>);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(msg as RegExp);
    expect(writes()).toBe(0);
  });

  it("rejects an inactive employee", async () => {
    h.selects = [[employee({ isActive: false })]];
    const res = await save();
    expect(!res.ok && res.error).toMatch(/inactive/);
    expect(writes()).toBe(0);
  });

  it("rejects when the times are already recorded", async () => {
    h.selects = [[employee()], [row("in", IN_ISO), row("out", OUT_ISO)]];
    const res = await save({ inTime: "10:10", outTime: "19:30", snapshot: { in: IN_ISO, out: OUT_ISO } });
    expect(!res.ok && res.error).toMatch(/Nothing to change/);
    expect(writes()).toBe(0);
  });
});

describe("saveCorrection: concurrent changes and duplicates", () => {
  const writes = () => h.committed.inserts.length + h.committed.updates.length + h.committed.events.length;
  const CHANGED = /changed by someone else/;

  it("refuses when a punch was changed after the browser loaded the day", async () => {
    h.selects = [[employee()], [row("in", "2026-04-01T04:50:00.000Z")]]; // stored 10:20 now, browser saw 10:10
    const res = await save({ inTime: "09:45", outTime: "", snapshot: { in: IN_ISO, out: null } });
    expect(!res.ok && res.error).toMatch(CHANGED);
    expect(writes()).toBe(0);
  });

  it("refuses when someone added the punch meanwhile (the browser saw none)", async () => {
    h.selects = [[employee()], [row("in", IN_ISO)]];
    const res = await save({ snapshot: { in: null, out: null } });
    expect(!res.ok && res.error).toMatch(CHANGED);
    expect(writes()).toBe(0);
  });

  it("refuses when the punch was deleted meanwhile", async () => {
    h.selects = [[employee()], []];
    const res = await save({ inTime: "09:45", outTime: "", snapshot: { in: IN_ISO, out: null } });
    expect(!res.ok && res.error).toMatch(CHANGED);
    expect(writes()).toBe(0);
  });

  it("rolls back when the guarded update finds the punch already changed", async () => {
    h.selects = [[employee()], [row("in", IN_ISO)]];
    h.updateReturns = [];
    const res = await save({ inTime: "09:45", outTime: "", snapshot: { in: IN_ISO, out: null } });
    expect(!res.ok && res.error).toMatch(CHANGED);
    expect(writes()).toBe(0); // the audit row is not committed either
  });

  it("turns a duplicate-punch race on insert into a clear message and saves nothing", async () => {
    h.selects = [[employee()], []];
    h.failOn = "unique";
    const res = await save();
    expect(!res.ok && res.error).toMatch(CHANGED);
    expect(writes()).toBe(0);
  });
});

describe("saveCorrection: audit atomicity and emails", () => {
  const writes = () => h.committed.inserts.length + h.committed.updates.length + h.committed.events.length;

  it("does not report success, and leaves no unaudited punch, when the audit row can't be written", async () => {
    h.selects = [[employee()], []];
    h.failOn = "events";
    const res = await save();
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/nothing was changed/);
    expect(JSON.stringify(res)).not.toMatch(/db exploded/);
    expect(writes()).toBe(0); // the punches were inserted inside the transaction but never committed
  });

  it("does not leak a raw database error when the punch write fails", async () => {
    h.selects = [[employee()], []];
    h.failOn = "attendance-insert";
    const res = await save();
    expect(!res.ok && res.error).not.toMatch(/db exploded/);
    expect(writes()).toBe(0);
  });

  it("sends no day-finalised or late-deduction email on success, or on any failure", async () => {
    h.selects = [[employee()], []];
    expect((await save()).ok).toBe(true);
    h.selects = [[employee()], []];
    h.failOn = "events";
    expect((await save()).ok).toBe(false);
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("still reports the saved result when the grade can't be loaded afterwards", async () => {
    h.selects = [[employee()], []];
    h.gradeFails = true;
    const res = await save();
    expect(res.ok && res.saved.grade).toBeNull();
    expect(res.ok && res.saved.in).toBe("10:00");
  });
});
