import { beforeEach, describe, expect, it, vi } from "vitest";

// Mapping server actions with the database and auth mocked: nothing here touches
// a real database or real attendance data.
const h = vi.hoisted(() => ({
  selects: [] as unknown[][],
  failOn: null as null | "map-insert" | "events-insert" | "unique",
  committed: { map: [] as Record<string, unknown>[], events: [] as Record<string, unknown>[], deletes: [] as string[][], attendance: [] as Record<string, unknown>[] },
  transactions: 0,
  admin: true,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/auth/current", () => ({
  requireAdmin: async () => {
    if (!h.admin) throw new Error("FORBIDDEN");
    return { id: "99999999-9999-4999-8999-999999999999", isAdmin: true };
  },
}));
// Let the mocked db see the ids passed to inArray(), so deletes can be asserted.
vi.mock("drizzle-orm", async (orig) => {
  const m = await orig<typeof import("drizzle-orm")>();
  return { ...m, inArray: (_c: unknown, v: unknown[]) => ({ __in: v }), or: (...a: unknown[]) => ({ __or: a }) };
});

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
      const map: Record<string, unknown>[] = [];
      const events: Record<string, unknown>[] = [];
      const deletes: string[][] = [];
      const attendance: Record<string, unknown>[] = [];
      const tx = {
        select: () => selectChain(),
        delete: () => ({
          where: (cond: { __in?: string[] }) => {
            deletes.push(cond.__in ?? []);
            return Promise.resolve();
          },
        }),
        insert: (table: Record<string, unknown>) => ({
          values: (vals: Record<string, unknown> | Record<string, unknown>[]) => {
            const arr = Array.isArray(vals) ? vals : [vals];
            if ("biometricCode" in table) {
              if (h.failOn === "unique") throw Object.assign(new Error("duplicate key value violates unique constraint"), { code: "23505" });
              if (h.failOn === "map-insert") throw new Error("db exploded");
              map.push(...arr);
              return Promise.resolve();
            }
            if ("eventType" in table) {
              if (h.failOn === "events-insert") throw new Error("db exploded");
              events.push(...arr);
              return Promise.resolve();
            }
            return {
              onConflictDoNothing: () => ({
                returning: async () => {
                  attendance.push(...arr);
                  return arr.map((k, i) => ({ id: `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`, logDate: k.logDate, kind: k.kind, loggedAt: k.loggedAt }));
                },
              }),
            };
          },
        }),
      };
      const out = await fn(tx);
      // Only a transaction that finished is "committed"; a throw above rolls everything back.
      h.committed.map.push(...map);
      h.committed.events.push(...events);
      h.committed.deletes.push(...deletes);
      h.committed.attendance.push(...attendance);
      return out;
    },
  },
}));

import { lookupSavedMappings, saveConfirmedMappings } from "@/app/(app)/hr/attendance-import/mapping-actions";
import { previewAttendanceImport, runAttendanceImport } from "@/app/(app)/hr/attendance-import/actions";

const ME = "99999999-9999-4999-8999-999999999999";
const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const R1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const R2 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

beforeEach(() => {
  h.selects = [];
  h.failOn = null;
  h.committed = { map: [], events: [], deletes: [], attendance: [] };
  h.transactions = 0;
  h.admin = true;
});

const confirmedAt = new Date("2026-10-01T00:00:00.000Z");
const person = (id: string, name: string, isActive = true) => ({ id, name, email: `${name.toLowerCase()}@example.test`, isActive });

describe("lookupSavedMappings", () => {
  const src = [{ key: "12", code: "12", name: "Bhavisha" }];

  it("auto-selects a saved match when code, name and an active employee agree", async () => {
    h.selects = [[{ code: "12", employeeId: A, nameInFile: "Bhavisha", confirmedAt }], [person(A, "Alpha")]];
    const res = await lookupSavedMappings({ sources: src });
    expect(res.ok && res.suggestions["12"]).toMatchObject({ status: "matched", employeeId: A, name: "Alpha", email: "alpha@example.test" });
  });

  it("leaves an unknown code unresolved", async () => {
    h.selects = [[]];
    const res = await lookupSavedMappings({ sources: src });
    expect(res.ok && res.suggestions["12"]).toMatchObject({ status: "unresolved", reason: "unknown_code" });
  });

  it("leaves a changed name, an inactive employee and a deleted employee unresolved", async () => {
    h.selects = [[{ code: "12", employeeId: A, nameInFile: "Someone Else", confirmedAt }], [person(A, "Alpha")]];
    const renamed = await lookupSavedMappings({ sources: src });
    expect(renamed.ok && renamed.suggestions["12"]).toMatchObject({ reason: "name_changed" });
    h.selects = [[{ code: "12", employeeId: A, nameInFile: "Bhavisha", confirmedAt }], [person(A, "Alpha", false)]];
    const inactive = await lookupSavedMappings({ sources: src });
    expect(inactive.ok && inactive.suggestions["12"]).toMatchObject({ reason: "employee_inactive" });
    h.selects = [[{ code: "12", employeeId: A, nameInFile: "Bhavisha", confirmedAt }], []];
    const gone = await lookupSavedMappings({ sources: src });
    expect(gone.ok && gone.suggestions["12"]).toMatchObject({ reason: "employee_missing" });
  });

  it("does not even query for rows without a usable code", async () => {
    const res = await lookupSavedMappings({ sources: [{ key: "n", code: "—", name: "Bhavisha" }] });
    expect(res.ok && res.suggestions.n).toMatchObject({ reason: "no_code" });
    expect(h.selects).toEqual([]);
  });

  it("is admin-only", async () => {
    h.admin = false;
    await expect(lookupSavedMappings({ sources: src })).rejects.toThrow("FORBIDDEN");
  });
});

describe("saveConfirmedMappings", () => {
  const item = (over: Record<string, unknown> = {}) => ({ code: "12", name: "Bhavisha", employeeId: A, ...over });
  const save = (items: unknown[], extra: Record<string, unknown> = {}) => saveConfirmedMappings({ items, acknowledged: true, ...extra });

  it("is admin-only and needs the explicit review confirmation", async () => {
    h.admin = false;
    await expect(save([item()])).rejects.toThrow("FORBIDDEN");
    h.admin = true;
    expect((await saveConfirmedMappings({ items: [item()] })).ok).toBe(false);
    expect((await saveConfirmedMappings({ items: [item()], acknowledged: false })).ok).toBe(false);
    expect(h.transactions).toBe(0);
  });

  it("rejects placeholder codes and duplicates inside one request", async () => {
    expect((await save([item({ code: "—" })])).ok).toBe(false);
    expect((await save([item(), item({ employeeId: B })])).ok).toBe(false); // same code twice
    expect((await save([item(), item({ code: "13" })])).ok).toBe(false); // same employee twice
    expect(h.transactions).toBe(0);
  });

  it("creates a new match with the confirming admin, and audits it in the same transaction", async () => {
    h.selects = [[], [person(A, "Alpha")]];
    const res = await save([item()]);
    expect(res).toMatchObject({ ok: true, saved: { created: 1, changed: 0, confirmed: 0, unchanged: 0 } });
    expect(h.committed.map).toEqual([{ biometricCode: "12", employeeId: A, nameInFile: "Bhavisha", confirmedById: ME }]);
    expect(h.committed.events).toHaveLength(1);
    expect(h.committed.events[0]).toMatchObject({ employeeId: A, actorId: ME, eventType: "biometric_map_created", toValue: { code: "12", nameInFile: "Bhavisha" } });
  });

  it("writes nothing when the same match is saved again", async () => {
    h.selects = [[{ id: R1, code: "12", employeeId: A, nameInFile: "bhavisha" }], [person(A, "Alpha")]];
    const res = await save([item()]);
    expect(res).toMatchObject({ ok: true, saved: { unchanged: 1, created: 0 } });
    expect(h.committed.map).toEqual([]);
    expect(h.committed.events).toEqual([]);
    expect(h.committed.deletes).toEqual([]);
  });

  it("re-confirming the same person with a new name updates it and audits old and new names", async () => {
    h.selects = [[{ id: R1, code: "12", employeeId: A, nameInFile: "Bhavisha" }], [person(A, "Alpha")]];
    const res = await save([item({ name: "Bhavisha K" })]);
    expect(res).toMatchObject({ ok: true, saved: { confirmed: 1 } });
    expect(h.committed.deletes).toEqual([[R1]]);
    expect(h.committed.map[0]).toMatchObject({ nameInFile: "Bhavisha K" });
    expect(h.committed.events[0]).toMatchObject({ eventType: "biometric_map_confirmed", fromValue: { nameInFile: "Bhavisha" }, toValue: { nameInFile: "Bhavisha K" } });
  });

  it("refuses to move a code to a different person without an explicit replace, and writes nothing", async () => {
    h.selects = [[{ id: R1, code: "12", employeeId: A, nameInFile: "Bhavisha" }], [person(A, "Alpha"), person(B, "Beta")]];
    const res = await save([item({ employeeId: B })]);
    expect(res.ok).toBe(false);
    expect("conflicts" in res && res.conflicts[0]).toMatchObject({ code: "12", employeeId: B });
    expect("conflicts" in res && res.conflicts[0]!.messages[0]).toMatch(/already saved for Alpha/);
    expect(h.committed.map).toEqual([]);
    expect(h.committed.events).toEqual([]);
    expect(h.committed.deletes).toEqual([]);
  });

  it("moves the code only with explicit replace, and audits the change and the removal", async () => {
    h.selects = [[{ id: R1, code: "12", employeeId: A, nameInFile: "Bhavisha" }], [person(A, "Alpha"), person(B, "Beta")]];
    const res = await save([item({ employeeId: B, replace: true })]);
    expect(res).toMatchObject({ ok: true, saved: { changed: 1 } });
    expect(h.committed.deletes).toEqual([[R1]]);
    expect(h.committed.map).toEqual([{ biometricCode: "12", employeeId: B, nameInFile: "Bhavisha", confirmedById: ME }]);
    const types = h.committed.events.map((e) => e.eventType);
    expect(types).toEqual(["biometric_map_changed", "biometric_map_removed"]);
    expect(h.committed.events[0]).toMatchObject({ employeeId: B, actorId: ME, fromValue: { previousEmployeeId: A, previousEmployeeName: "Alpha" } });
    expect(h.committed.events[1]).toMatchObject({ employeeId: A, actorId: ME, fromValue: { code: "12" } });
  });

  it("refuses to give a person a second code without an explicit replace; replace drops the old code", async () => {
    const existing = [{ id: R2, code: "9", employeeId: A, nameInFile: "Old" }];
    h.selects = [existing, [person(A, "Alpha")]];
    const res = await save([item()]);
    expect("conflicts" in res && res.conflicts[0]!.messages[0]).toMatch(/already saved with code 9/);
    expect(h.committed.map).toEqual([]);

    h.selects = [existing, [person(A, "Alpha")]];
    const ok = await save([item({ replace: true })]);
    expect(ok).toMatchObject({ ok: true, saved: { changed: 1 } });
    expect(h.committed.deletes).toEqual([[R2]]);
    expect(h.committed.events[0]).toMatchObject({ eventType: "biometric_map_changed", fromValue: { previousCodeOfThisEmployee: "9" } });
  });

  it("rejects a match to an inactive or missing employee, and writes nothing", async () => {
    h.selects = [[], [person(A, "Alpha", false)]];
    const inactive = await save([item()]);
    expect(inactive).toMatchObject({ ok: false });
    expect(!inactive.ok && inactive.error).toMatch(/inactive/);
    h.selects = [[], []];
    const missing = await save([item()]);
    expect(!missing.ok && missing.error).toMatch(/no longer exists/);
    expect(h.committed.map).toEqual([]);
  });

  it("rolls everything back when the audit write fails, and does not leak the database error", async () => {
    h.selects = [[], [person(A, "Alpha")]];
    h.failOn = "events-insert";
    const res = await save([item()]);
    expect(res.ok).toBe(false);
    expect(JSON.stringify(res)).not.toMatch(/db exploded/);
    expect(h.committed.map).toEqual([]); // the map row was inserted in the tx but never committed
    expect(h.committed.events).toEqual([]);
  });

  it("rolls back when the mapping insert fails", async () => {
    h.selects = [[], [person(A, "Alpha")]];
    h.failOn = "map-insert";
    expect((await save([item()])).ok).toBe(false);
    expect(h.committed.map).toEqual([]);
    expect(h.committed.events).toEqual([]);
  });

  it("turns a unique-constraint race into a clear message", async () => {
    h.selects = [[], [person(A, "Alpha")]];
    h.failOn = "unique";
    const res = await save([item()]);
    expect(!res.ok && res.error).toMatch(/same moment/);
    expect(h.committed.map).toEqual([]);
  });
});

describe("the import still validates the FINAL mapping on the server", () => {
  const day = { rowNo: 1, date: "2026-04-01", inTime: "10:10", outTime: "19:32", status: "Present", problems: [] as string[] };
  const emp = (code: string) => ({ key: code, code, name: `Test ${code}`, department: null, days: [day], noPunchDays: 0 });
  const body = (mapping: Record<string, string>, employees = [emp("1"), emp("2")]) => ({
    fileName: "april.xlsx",
    employees,
    mapping,
    declaredPeriod: null,
    confirmedPeriod: { from: "2026-04-01", to: "2026-04-30" },
    acknowledged: { mappings: true, period: true },
  });
  const active = (id: string) => ({ id, timezone: "Asia/Kolkata", name: id === A ? "Alpha" : "Beta", email: `${id}@example.test` });

  it("blocks a suggested/selected employee who is inactive or missing", async () => {
    h.selects = [[active(A)], []]; // B is not returned: inactive or deleted
    const res = await runAttendanceImport(body({ "1": A, "2": B }));
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/no longer exists or is not active/);
    expect(h.committed.attendance).toEqual([]);
  });

  it("blocks two biometric codes mapped to the same JMT employee", async () => {
    h.selects = [[active(A)], []];
    const res = await runAttendanceImport(body({ "1": A, "2": A }));
    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toMatch(/mapped to the same JMT employee/);
    expect(h.committed.attendance).toEqual([]);
  });

  it("uses the corrected employee when HR changes an auto-selected match", async () => {
    h.selects = [[active(B)], []];
    const res = await runAttendanceImport(body({ "1": B, "2": "skip" }, [emp("1"), emp("2")]));
    expect(res.ok).toBe(true);
    expect(h.committed.attendance.every((p) => p.employeeId === B)).toBe(true);
    expect(h.committed.attendance).toHaveLength(2);
  });

  it("the preview also reports an undecided or missing person as a blocker", async () => {
    h.selects = [[active(A)], []];
    const res = await previewAttendanceImport({ ...body({ "1": A }), acknowledged: undefined });
    expect(res.ok && res.preview.blockers[0]).toMatch(/has not been mapped/);
  });
});
