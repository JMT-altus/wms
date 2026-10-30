import { beforeEach, describe, expect, it, vi } from "vitest";

// Admin & Master Setup → Weekly Bulk Upload: the server action that records who
// is responsible. Session, store and database MOCKED. It must validate the
// person from the database, audit every change in the same transaction, and
// follow through (move open weeks, create this week's task) without ever
// granting a permission.
const h = vi.hoisted(() => ({
  me: { id: "admin-1", isAdmin: true, isActive: true, name: "Admin", email: "admin@example.test" },
  settings: { storageReady: true, assigneeId: null as string | null, dueDow: 5, setById: null as string | null, updatedAt: null as Date | null },
  employees: new Map<string, { id: string; name: string; email: string; isActive: boolean; isAdmin: boolean }>(),
  holders: new Set<string>(),
  writes: [] as { table: string; values: Record<string, unknown> }[],
  reassign: vi.fn(async () => ({ reassigned: 1 })),
  ensure: vi.fn(async () => ({ status: "created" })),
  txFails: false,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/auth/current", () => ({
  requireAdmin: async () => {
    if (!h.me.isAdmin) throw new Error("Forbidden");
    return h.me;
  },
}));
vi.mock("@/lib/queries/collection-master", () => ({ isMissingTable: (e: unknown) => (e as { code?: string })?.code === "42P01" }));
vi.mock("@/lib/queries/collection-weekly-upload", () => ({
  readWeeklyUploadSettings: async () => h.settings,
  weeklyUploadStore: {
    employee: async (id: string) => h.employees.get(id) ?? null,
    holdsBulkUpload: async (id: string) => h.holders.has(id),
  },
}));
vi.mock("@/lib/collections/weekly-upload/server", () => ({
  reassignOpenWeeklyTasks: (...a: unknown[]) => h.reassign(...(a as [])),
  ensureCurrentWeeklyTask: (...a: unknown[]) => h.ensure(...(a as [])),
}));
vi.mock("@/lib/db", () => {
  const tx = {
    insert: (table: { name: string }) => ({
      values: (values: Record<string, unknown>) => {
        if (h.txFails) throw Object.assign(new Error("boom"), { code: "XX000" });
        h.writes.push({ table: table.name, values });
        return { onConflictDoUpdate: async () => undefined, then: (cb: (v: unknown) => unknown) => Promise.resolve(undefined).then(cb) };
      },
    }),
  };
  return { db: { transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) } };
});
vi.mock("@/db/schema", () => ({
  collectionWeeklyUploadSettings: { name: "collection_weekly_upload_settings", id: "id" },
  settingsEvents: { name: "settings_events" },
}));

import { saveWeeklyUploadSettings } from "@/app/(masters)/master-setup/collection-weekly-upload/actions";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  h.me = { id: "admin-1", isAdmin: true, isActive: true, name: "Admin", email: "admin@example.test" };
  h.settings = { storageReady: true, assigneeId: null, dueDow: 5, setById: null, updatedAt: null };
  h.employees = new Map([
    [A, { id: A, name: "Person A", email: "a@example.test", isActive: true, isAdmin: true }],
    [B, { id: B, name: "Person B", email: "b@example.test", isActive: true, isAdmin: true }],
  ]);
  h.holders = new Set([A, B]);
  h.writes = [];
  h.reassign.mockClear();
  h.ensure.mockClear();
  h.txFails = false;
});

describe("saving the responsible employee", () => {
  it("records the person and due day, audits the change with the actor, then moves open weeks and creates this week's task", async () => {
    const r = await saveWeeklyUploadSettings({ assigneeId: A, dueDow: 4 });
    expect(r).toEqual({ ok: true, changed: true, taskCreated: true, reassigned: 1 });
    expect(h.writes.map((w) => w.table)).toEqual(["collection_weekly_upload_settings", "settings_events"]);
    expect(h.writes[0]!.values).toMatchObject({ id: 1, assigneeId: A, dueDow: 4, setById: "admin-1" });
    expect(h.writes[1]!.values).toMatchObject({
      scope: "collection_weekly_upload",
      targetId: A,
      actorId: "admin-1",
      eventType: "updated",
      fromValue: { assigneeId: null, dueDow: 5 },
      toValue: { assigneeId: A, dueDow: 4 },
    });
    expect(h.reassign).toHaveBeenCalledWith(A, "admin-1");
    expect(h.ensure).toHaveBeenCalledTimes(1);
  });

  it("changing only the due day does not move anyone", async () => {
    h.settings.assigneeId = A;
    const r = await saveWeeklyUploadSettings({ assigneeId: A, dueDow: 3 });
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(h.reassign).not.toHaveBeenCalled();
    expect(h.ensure).toHaveBeenCalledTimes(1);
  });

  it("clearing the person is recorded (and audited) — no task is created for anyone", async () => {
    h.settings.assigneeId = A;
    const r = await saveWeeklyUploadSettings({ assigneeId: null, dueDow: 5 });
    expect(r).toEqual({ ok: true, changed: true, taskCreated: false, reassigned: 0 });
    expect(h.writes[1]!.values).toMatchObject({ targetId: null, toValue: { assigneeId: null, dueDow: 5 } });
    expect(h.reassign).not.toHaveBeenCalled();
    expect(h.ensure).not.toHaveBeenCalled();
  });

  it("no change → nothing written, nothing audited", async () => {
    h.settings.assigneeId = A;
    expect(await saveWeeklyUploadSettings({ assigneeId: A, dueDow: 5 })).toEqual({ ok: true, changed: false, taskCreated: false, reassigned: 0 });
    expect(h.writes).toEqual([]);
  });
});

describe("who may be chosen", () => {
  const refused: [string, () => void, RegExp][] = [
    ["deactivated", () => void (h.employees.get(A)!.isActive = false), /deactivated/],
    ["not an admin", () => void (h.employees.get(A)!.isAdmin = false), /not an admin/],
    ["without the Bulk Upload permission", () => void h.holders.delete(A), /Collection Tracker — Bulk Upload/],
    ["unknown", () => void h.employees.delete(A), /no longer exists/],
  ];
  it.each(refused)("an employee who is %s is refused, with the reason, and nothing is written", async (_n, setup, msg) => {
    setup();
    const r = await saveWeeklyUploadSettings({ assigneeId: A, dueDow: 5 });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(msg) });
    expect(h.writes).toEqual([]);
    expect(h.reassign).not.toHaveBeenCalled();
  });

  it("the permission is never granted here: refusing is the only response to a missing grant", async () => {
    h.holders.delete(B);
    await saveWeeklyUploadSettings({ assigneeId: B, dueDow: 5 });
    expect(h.holders.has(B)).toBe(false);
    expect(h.writes).toEqual([]);
  });
});

describe("guards", () => {
  it("a non-admin is refused before anything is read", async () => {
    h.me.isAdmin = false;
    await expect(saveWeeklyUploadSettings({ assigneeId: A, dueDow: 5 })).rejects.toThrow("Forbidden");
    expect(h.writes).toEqual([]);
  });

  it("malformed input is refused", async () => {
    expect((await saveWeeklyUploadSettings({ assigneeId: "not-a-uuid", dueDow: 5 })).ok).toBe(false);
    expect((await saveWeeklyUploadSettings({ assigneeId: A, dueDow: 8 })).ok).toBe(false);
    expect((await saveWeeklyUploadSettings({ assigneeId: A, dueDow: 5, email: "x@y" })).ok).toBe(false);
    expect(h.writes).toEqual([]);
  });

  it("while migration 0121 isn't applied it says so and saves nothing", async () => {
    h.settings.storageReady = false;
    expect(await saveWeeklyUploadSettings({ assigneeId: A, dueDow: 5 })).toEqual({ ok: false, error: expect.stringMatching(/database update 0121/) });
  });

  it("a failed transaction saves nothing and does not follow through", async () => {
    h.txFails = true;
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await saveWeeklyUploadSettings({ assigneeId: A, dueDow: 5 });
    expect(r).toEqual({ ok: false, error: expect.stringMatching(/nothing was changed/) });
    expect(h.reassign).not.toHaveBeenCalled();
    expect(h.ensure).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it("a follow-through failure never undoes the saved setting (the daily sweep catches up)", async () => {
    h.ensure.mockRejectedValueOnce(new Error("network"));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await saveWeeklyUploadSettings({ assigneeId: A, dueDow: 5 });
    expect(r).toEqual({ ok: true, changed: true, taskCreated: false, reassigned: 1 });
    expect(h.writes).toHaveLength(2);
    err.mockRestore();
  });
});
