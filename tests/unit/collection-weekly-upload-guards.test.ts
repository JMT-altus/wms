import { beforeEach, describe, expect, it, vi } from "vitest";

// The compulsory weekly Bulk Upload task can't be closed, binned, archived,
// deleted or reassigned by hand — by anyone, admins included, through the web
// actions or the shared status core the mobile API uses. Other tasks are
// untouched. The guard itself (which task is the week's) is MOCKED; the
// database is mocked as in the other task-action tests.
const h = vi.hoisted(() => ({
  protectedIds: new Set<string>(),
  me: { id: "me-id", isAdmin: true, isActive: true, name: "Me", email: "me@example.test" },
  current: null as null | Record<string, unknown>,
  updates: 0,
  inserts: 0,
  deletes: 0,
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/queries/status-display", () => ({ getStatusDisplayMap: vi.fn(async () => ({})) }));
vi.mock("@/lib/notifications/dispatch", () => ({ notify: vi.fn(async () => undefined), notifyManyForTask: vi.fn(async () => undefined), dedupeRecipients: () => [] }));
vi.mock("@/lib/google/sync", () => ({ reconcileTaskEvent: vi.fn(), removeTaskEvent: vi.fn() }));
vi.mock("@/lib/tasks/auto-archive", () => ({ archiveIfApproved: vi.fn() }));
vi.mock("@/lib/auth/current", () => ({
  requireUser: async () => h.me,
  requireAdmin: async () => h.me,
  getCurrentEmployee: async () => h.me,
}));
vi.mock("@/lib/collections/weekly-upload/server", () => ({
  isProtectedWeeklyTask: async (id: string) => h.protectedIds.has(id),
  protectedWeeklyTaskIds: async (ids: string[]) => new Set(ids.filter((id) => h.protectedIds.has(id))),
  PROTECTED_TASK_MESSAGE: "This is the compulsory weekly Collection Tracker Bulk Upload task (test message).",
}));
vi.mock("@/lib/db", () => {
  const rows = async () => (h.current ? [h.current] : []);
  const update = () => {
    h.updates++;
    const where = Object.assign(() => ({ returning: async () => [{ id: "t" }] }), {});
    return { set: () => ({ where, returning: async () => [{ id: "t" }] }) };
  };
  const insert = () => {
    h.inserts++;
    return { values: async () => [{ id: "e" }] };
  };
  const select = () => ({
    from: () => ({
      where: () => ({
        limit: rows,
        for: () => ({ limit: rows, then: (cb: (v: unknown) => unknown) => rows().then(cb) }),
        then: (cb: (v: unknown) => unknown) => rows().then(cb),
      }),
    }),
  });
  const del = () => {
    h.deletes++;
    return { where: () => ({ returning: async () => [{ id: "t" }] }) };
  };
  const tx = { update, insert, select, delete: del, query: { tasks: { findFirst: async () => h.current } } };
  return {
    db: { ...tx, transaction: async (fn: (t: typeof tx) => unknown) => fn(tx) },
    tasks: { id: "tasks.id", updatedAt: "tasks.updatedAt", doerId: "tasks.doerId", archived: "tasks.archived", abandonedAt: "tasks.abandonedAt" },
    taskEvents: {},
    employees: {},
  };
});

import { applyTaskStatusChange } from "@/lib/tasks/set-status";
import { archiveTask, bulkArchive, bulkDelete, bulkReassignDoer, bulkSetStatus, deleteTask, reassignTask } from "@/app/(app)/tasks/actions";
import { abandonTask } from "@/app/(app)/tasks/lifecycle-actions";

const WEEKLY = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ORDINARY = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OTHER_DOER = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const UPDATED = "2026-11-04T10:00:00.000Z";
const task = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  status: "not_started",
  doerId: "me-id",
  initiatorId: "me-id",
  createdById: "me-id",
  subject: null,
  title: "Complete Weekly Collection Tracker Bulk Upload",
  updatedAt: new Date(UPDATED),
  completedAt: null,
  archived: false,
  googleEventId: null,
  googleSyncedDoerId: null,
  ...over,
});

beforeEach(() => {
  h.protectedIds = new Set([WEEKLY]);
  h.me = { id: "me-id", isAdmin: true, isActive: true, name: "Me", email: "me@example.test" };
  h.current = task(WEEKLY);
  h.updates = 0;
  h.inserts = 0;
  h.deletes = 0;
});

describe("status changes (the core shared by the web action and the mobile API)", () => {
  it.each(["done", "abandoned", "cancelled", "transferred"] as const)("the weekly task can't be set to %s by an admin (who may otherwise do anything) — nothing is written", async (status) => {
    const r = await applyTaskStatusChange({ id: "me-id", name: "Me", isAdmin: true }, WEEKLY, status, UPDATED);
    expect(r).toEqual({ ok: false, error: "forbidden", message: expect.stringMatching(/compulsory weekly/) });
    expect(h.updates).toBe(0);
    expect(h.inserts).toBe(0);
  });

  it("nor by its doer: 'done' and 'abandoned' (the doer's own exits from the pending lane) are refused with the reason; the rest the matrix already refuses", async () => {
    for (const status of ["done", "abandoned"] as const) {
      expect(await applyTaskStatusChange({ id: "me-id", name: "Me", isAdmin: false }, WEEKLY, status, UPDATED)).toEqual({ ok: false, error: "forbidden", message: expect.stringMatching(/compulsory weekly/) });
    }
    for (const status of ["cancelled", "transferred"] as const) {
      expect((await applyTaskStatusChange({ id: "me-id", name: "Me", isAdmin: false }, WEEKLY, status, UPDATED)).ok).toBe(false);
    }
    expect(h.updates).toBe(0);
  });

  it("working statuses stay available on the weekly task (the doer can mark it in progress)", async () => {
    const r = await applyTaskStatusChange({ id: "me-id", name: "Me", isAdmin: false }, WEEKLY, "follow_up", UPDATED);
    expect(r.ok).toBe(true);
    expect(h.updates).toBe(1);
  });

  it("an ordinary task is unaffected: its doer can still mark it done", async () => {
    h.current = task(ORDINARY);
    const r = await applyTaskStatusChange({ id: "me-id", name: "Me", isAdmin: false }, ORDINARY, "done", UPDATED);
    expect(r.ok).toBe(true);
    expect(h.updates).toBe(1);
  });
});

describe("the task-level actions", () => {
  it("archive, delete and the Recycle Bin refuse the weekly task even for an admin, and write nothing", async () => {
    expect(await archiveTask(WEEKLY)).toEqual({ ok: false, error: expect.stringMatching(/compulsory weekly/) });
    expect(await deleteTask(WEEKLY)).toEqual({ ok: false, error: expect.stringMatching(/compulsory weekly/) });
    expect(await abandonTask(WEEKLY, "not needed")).toEqual({ ok: false, error: expect.stringMatching(/compulsory weekly/) });
    expect(h.updates + h.inserts + h.deletes).toBe(0);
  });

  it("the same actions still work on an ordinary task", async () => {
    h.current = task(ORDINARY);
    expect(await archiveTask(ORDINARY)).toEqual({ ok: true });
    expect(await abandonTask(ORDINARY)).toEqual({ ok: true });
    expect(await deleteTask(ORDINARY)).toEqual({ ok: true });
    expect(h.deletes).toBe(1);
  });

  it("reassigning the weekly task from the task itself is refused (the assignee is set in Admin & Master Setup)", async () => {
    const r = await reassignTask(WEEKLY, { newDoerId: OTHER_DOER }, UPDATED);
    expect(r).toEqual({ ok: false, error: "forbidden", message: expect.stringMatching(/compulsory weekly/) });
    expect(h.updates).toBe(0);
    h.current = task(ORDINARY);
    expect(await reassignTask(ORDINARY, { newDoerId: OTHER_DOER }, UPDATED)).toEqual({ ok: true });
  });
});

describe("the bulk actions skip the weekly task and report it as skipped", () => {
  it("bulk status to done / archive / delete / reassign", async () => {
    expect(await bulkSetStatus([WEEKLY], "done")).toEqual({ ok: true, updated: 0, skipped: 1 });
    expect(await bulkArchive([WEEKLY])).toEqual({ ok: true, updated: 0, skipped: 1 });
    expect(await bulkDelete([WEEKLY])).toEqual({ ok: true, updated: 0, skipped: 1 });
    h.current = task(WEEKLY, { doerId: "me-id" });
    // bulkReassignDoer first checks the target employee exists (the select returns the current fixture row).
    expect(await bulkReassignDoer([WEEKLY], OTHER_DOER)).toEqual({ ok: true, updated: 0, skipped: 1 });
    expect(h.updates + h.deletes).toBe(0);
  });

  it("a bulk 'in progress' is still allowed on the weekly task", async () => {
    const r = await bulkSetStatus([WEEKLY], "follow_up");
    expect(r).toEqual({ ok: true, updated: 1, skipped: 0 });
  });
});
