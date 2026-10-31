import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSIGNEE_PROBLEM_TEXT,
  completeWeeklyUploadForSnapshot,
  ensureWeeklyTask,
  isCompulsoryWeeklyTask,
  reconcileWeeklyCompletions,
  runWeeklyUploadSweep,
  sendWeeklyReminders,
  syncOpenWeeksToAssignee,
  type CreateWeekTaskInput,
  type EmployeeFacts,
  type ReminderKind,
  type SnapshotRef,
  type WeekRow,
  type WeeklyUploadDeps,
  type WeeklyUploadSettings,
  type WeeklyUploadStore,
} from "@/lib/collections/weekly-upload/service";
import { WEEKLY_TASK_TITLE, dueAtFor } from "@/lib/collections/weekly-upload/week";
import type { NotifyOpts } from "@/lib/notifications/dispatch";

// The weekly Bulk Upload rules against an in-memory store that behaves like
// the database (one row per week, conditional claims). No database, no I/O.
// 2026-11-02 is a Monday; its task is due Friday 2026-11-06.

const MIHIR = "11111111-1111-4111-8111-111111111111"; // the configured person (an id — never a name in the logic)
const OTHER = "22222222-2222-4222-8222-222222222222";
const ADMIN = "33333333-3333-4333-8333-333333333333";
const WED = new Date("2026-11-04T10:00:00Z");
const FRI = new Date("2026-11-06T04:00:00Z");
const SAT = new Date("2026-11-07T04:00:00Z");
const NEXT_MON = new Date("2026-11-09T04:00:00Z");

interface Fake extends WeeklyUploadStore {
  settings: WeeklyUploadSettings;
  employees: Map<string, EmployeeFacts>;
  holders: Set<string>;
  weeks: Map<string, WeekRow>;
  snapshots: SnapshotRef[];
  tasks: Map<string, { status: string; doerId: string | null; events: string[] }>;
  calls: string[];
}

function fakeStore(): Fake {
  const store: Fake = {
    settings: { storageReady: true, assigneeId: MIHIR, dueDow: 5, setById: ADMIN, updatedAt: new Date() },
    employees: new Map([
      [MIHIR, { id: MIHIR, name: "Person A", email: "a@example.test", isActive: true, isAdmin: true }],
      [OTHER, { id: OTHER, name: "Person B", email: "b@example.test", isActive: true, isAdmin: true }],
    ]),
    holders: new Set([MIHIR, OTHER]),
    weeks: new Map(),
    snapshots: [],
    tasks: new Map(),
    calls: [],
    async readSettings() {
      return store.settings;
    },
    async employee(id) {
      return store.employees.get(id) ?? null;
    },
    async holdsBulkUpload(id) {
      return store.holders.has(id);
    },
    async getWeek(weekStart) {
      return store.weeks.get(weekStart) ?? null;
    },
    async weekByTaskId(taskId) {
      return [...store.weeks.values()].find((w) => w.taskId === taskId) ?? null;
    },
    async listOpenWeeks() {
      return [...store.weeks.values()].filter((w) => !w.completedAt).sort((a, b) => a.weekStart.localeCompare(b.weekStart));
    },
    async createWeekTask(input: CreateWeekTaskInput) {
      store.calls.push(`create:${input.weekStart}`);
      const existing = store.weeks.get(input.weekStart);
      if (existing) return { created: false, row: existing };
      const taskId = `task-${input.weekStart}`;
      store.tasks.set(taskId, { status: "not_started", doerId: input.assigneeId, events: ["created"] });
      const row: WeekRow = {
        weekStart: input.weekStart,
        taskId,
        assigneeId: input.assigneeId,
        doerId: input.assigneeId,
        taskStatus: "not_started",
        dueAt: input.dueAt,
        createdAt: new Date(),
        completedAt: null,
        completedSnapshotId: null,
        completedById: null,
        notifiedAssignedAt: null,
        notifiedDueTodayAt: null,
        notifiedOverdueAt: null,
        notifiedCompletedAt: null,
      };
      store.weeks.set(input.weekStart, row);
      return { created: true, row };
    },
    async completeWeek(weekStart, by) {
      const row = store.weeks.get(weekStart);
      if (!row) return { claimed: false, row: null };
      if (row.completedAt) return { claimed: false, row };
      row.completedAt = by.at;
      row.completedSnapshotId = by.snapshotId;
      row.completedById = by.actorId;
      const task = store.tasks.get(row.taskId)!;
      if (task.status !== "done" && task.status !== "approved") task.status = "done";
      task.events.push(`status_changed:done:${by.snapshotId}`);
      row.taskStatus = task.status;
      return { claimed: true, row };
    },
    async claimNotification(weekStart, kind: ReminderKind, at) {
      const row = store.weeks.get(weekStart);
      if (!row) return false;
      const key = { assigned: "notifiedAssignedAt", due_today: "notifiedDueTodayAt", overdue: "notifiedOverdueAt", completed: "notifiedCompletedAt" }[kind] as "notifiedAssignedAt";
      if (row[key]) return false;
      row[key] = at;
      return true;
    },
    async reassignOpenWeeks(assigneeId, actorId, at) {
      const changed: WeekRow[] = [];
      for (const row of store.weeks.values()) {
        if (row.completedAt || row.doerId === assigneeId) continue;
        row.doerId = assigneeId;
        row.assigneeId = assigneeId;
        row.notifiedAssignedAt = at;
        store.tasks.get(row.taskId)!.doerId = assigneeId;
        store.tasks.get(row.taskId)!.events.push(`reassigned:${actorId}`);
        changed.push(row);
      }
      return changed;
    },
    async snapshotsSince(from) {
      return store.snapshots.filter((s) => s.uploadedAt >= from);
    },
  };
  return store;
}

let store: Fake;
let sent: NotifyOpts[];
let deps: WeeklyUploadDeps;

beforeEach(() => {
  store = fakeStore();
  sent = [];
  deps = {
    store,
    notify: vi.fn(async (o: NotifyOpts) => {
      sent.push(o);
    }),
    siteUrl: () => "https://wms.example.test",
  };
});

describe("ensureWeeklyTask — one task per reporting week", () => {
  it("creates this week's task for the configured employee, due Friday noon IST, and tells them once", async () => {
    const r = await ensureWeeklyTask(WED, deps);
    expect(r.status).toBe("created");
    if (r.status !== "created") return;
    expect(r.weekStart).toBe("2026-11-02");
    expect(r.row.doerId).toBe(MIHIR);
    expect(r.row.dueAt.toISOString()).toBe(dueAtFor("2026-11-02", 5).toISOString());
    expect(store.tasks.get(r.row.taskId)).toMatchObject({ status: "not_started", doerId: MIHIR });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ userId: MIHIR, kind: "task_assigned", taskId: r.row.taskId });
    expect(sent[0]!.title).toContain(WEEKLY_TASK_TITLE);
    expect(sent[0]!.title).toContain("Fri, 6 Nov 2026");
    expect(sent[0]!.body).toContain("https://wms.example.test/collection/tracker");
  });

  it("running again — the same day, a later day, or many times — creates nothing and notifies nobody", async () => {
    await ensureWeeklyTask(WED, deps);
    for (const when of [WED, FRI, new Date("2026-11-08T12:00:00Z"), WED]) {
      const r = await ensureWeeklyTask(when, deps);
      expect(r.status).toBe("exists");
    }
    expect(store.weeks.size).toBe(1);
    expect(store.calls.filter((c) => c.startsWith("create:"))).toHaveLength(1);
    expect(sent).toHaveLength(1);
  });

  it("a concurrent duplicate (the store reports 'already there') sends no second assignment", async () => {
    // Simulate two scheduler runs racing: the second create returns the first's row.
    await ensureWeeklyTask(WED, deps);
    store.weeks.get("2026-11-02")!.notifiedAssignedAt = null; // even if the stamp were lost…
    const r = await ensureWeeklyTask(WED, deps);
    expect(r.status).toBe("exists");
    expect(sent).toHaveLength(1); // …an "exists" result never notifies
  });

  it("the next week gets its own task, assigned to the same configured person", async () => {
    await ensureWeeklyTask(WED, deps);
    const r = await ensureWeeklyTask(NEXT_MON, deps);
    expect(r.status).toBe("created");
    expect(r.status === "created" && r.weekStart).toBe("2026-11-09");
    expect(store.weeks.size).toBe(2);
    expect([...store.weeks.values()].every((w) => w.doerId === MIHIR)).toBe(true);
  });

  it("the due weekday follows the setting", async () => {
    store.settings.dueDow = 3;
    const r = await ensureWeeklyTask(WED, deps);
    expect(r.status === "created" && r.row.dueAt.toISOString()).toBe("2026-11-04T06:30:00.000Z");
  });

  it("with nobody configured: no task, no notification, and the reason is reported — never an arbitrary person", async () => {
    store.settings.assigneeId = null;
    expect(await ensureWeeklyTask(WED, deps)).toEqual({ status: "no-assignee", weekStart: "2026-11-02" });
    expect(store.weeks.size).toBe(0);
    expect(sent).toHaveLength(0);
  });

  const ineligible: [string, () => void, "inactive" | "not-admin" | "no-permission" | "missing"][] = [
    ["deactivated", () => void (store.employees.get(MIHIR)!.isActive = false), "inactive"],
    ["not an admin", () => void (store.employees.get(MIHIR)!.isAdmin = false), "not-admin"],
    ["without the Bulk Upload permission", () => void store.holders.delete(MIHIR), "no-permission"],
    ["deleted", () => void store.employees.delete(MIHIR), "missing"],
  ];
  it.each(ineligible)("an assignee who is %s gets no task; the reason is reported", async (_n, setup, reason) => {
    setup();
    const r = await ensureWeeklyTask(WED, deps);
    expect(r).toEqual({ status: "assignee-ineligible", weekStart: "2026-11-02", reason });
    expect(ASSIGNEE_PROBLEM_TEXT[reason]).toBeTruthy();
    expect(store.weeks.size).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it("while migration 0121 isn't applied nothing runs", async () => {
    store.settings.storageReady = false;
    expect(await ensureWeeklyTask(WED, deps)).toEqual({ status: "not-installed" });
    expect(await runWeeklyUploadSweep(WED, deps)).toMatchObject({ ensure: "not-installed", weekStart: null });
  });
});

describe("completion — only a confirmed, written upload", () => {
  const snap = (over: Partial<SnapshotRef> = {}): SnapshotRef => ({ id: "snap-1", periodTo: "2026-11-04", uploadedAt: WED, uploadedById: MIHIR, ...over });

  it("completes this week's task, records the upload reference, and tells the assignee once", async () => {
    await ensureWeeklyTask(WED, deps);
    const r = await completeWeeklyUploadForSnapshot(snap(), deps);
    expect(r.status).toBe("completed");
    const row = store.weeks.get("2026-11-02")!;
    expect(row).toMatchObject({ completedAt: WED, completedSnapshotId: "snap-1", completedById: MIHIR });
    expect(store.tasks.get(row.taskId)).toMatchObject({ status: "done" });
    expect(store.tasks.get(row.taskId)!.events).toContain("status_changed:done:snap-1");
    const done = sent.filter((n) => n.kind === "status_changed");
    expect(done).toHaveLength(1);
    expect(done[0]).toMatchObject({ userId: MIHIR, taskId: row.taskId, actorId: MIHIR });
    expect(done[0]!.body).toContain('"toStatus":"done"');
    expect(done[0]!.body).toContain("snap-1");
  });

  it("a repeated confirmation, or the same snapshot reported twice, completes nothing a second time", async () => {
    await ensureWeeklyTask(WED, deps);
    await completeWeeklyUploadForSnapshot(snap(), deps);
    expect(await completeWeeklyUploadForSnapshot(snap(), deps)).toEqual({ status: "already-completed", weekStart: "2026-11-02" });
    expect(await completeWeeklyUploadForSnapshot(snap({ id: "snap-2", uploadedAt: FRI }), deps)).toEqual({ status: "already-completed", weekStart: "2026-11-02" });
    expect(store.weeks.get("2026-11-02")!.completedSnapshotId).toBe("snap-1");
    expect(sent.filter((n) => n.kind === "status_changed")).toHaveLength(1);
  });

  it("an upload whose period ended in an earlier week completes THAT week only; the current week stays open", async () => {
    await ensureWeeklyTask(new Date("2026-10-28T10:00:00Z"), deps); // last week's task (2026-10-26)
    await ensureWeeklyTask(WED, deps); // this week's
    const r = await completeWeeklyUploadForSnapshot(snap({ id: "late", periodTo: "2026-10-30" }), deps);
    expect(r).toMatchObject({ status: "completed", weekStart: "2026-10-26" });
    expect(store.weeks.get("2026-10-26")!.completedSnapshotId).toBe("late");
    expect(store.weeks.get("2026-11-02")!.completedAt).toBeNull();
    expect(store.tasks.get(store.weeks.get("2026-11-02")!.taskId)!.status).toBe("not_started");
  });

  it("a week with no task yet gets one, already completed, without an 'assigned' notification — only if someone is configured", async () => {
    const r = await completeWeeklyUploadForSnapshot(snap(), deps);
    expect(r).toMatchObject({ status: "completed", weekStart: "2026-11-02" });
    expect(sent.map((n) => n.kind)).toEqual(["status_changed"]);
    store.settings.assigneeId = null;
    expect(await completeWeeklyUploadForSnapshot(snap({ id: "s9", periodTo: "2026-10-14", uploadedAt: WED }), deps)).toEqual({ status: "no-task", weekStart: "2026-10-12" });
    expect(store.weeks.has("2026-10-12")).toBe(false);
  });

  it("the task is never marked done by anything but a snapshot: ensure + reminders + sweep leave it open", async () => {
    await ensureWeeklyTask(WED, deps);
    await sendWeeklyReminders(FRI, deps);
    await runWeeklyUploadSweep(SAT, deps);
    const row = store.weeks.get("2026-11-02")!;
    expect(row.completedAt).toBeNull();
    expect(store.tasks.get(row.taskId)!.status).toBe("not_started");
  });
});

describe("reconcile — the safety net for a completion step that failed", () => {
  it("an open week whose upload is in the snapshots table is completed on the next sweep; nothing else changes", async () => {
    await ensureWeeklyTask(WED, deps);
    store.snapshots.push({ id: "snap-x", periodTo: "2026-11-05", uploadedAt: new Date("2026-11-05T09:00:00Z"), uploadedById: OTHER });
    const r = await reconcileWeeklyCompletions(FRI, deps);
    expect(r).toEqual({ open: 1, completed: 1 });
    expect(store.weeks.get("2026-11-02")).toMatchObject({ completedSnapshotId: "snap-x", completedById: OTHER });
    expect(await reconcileWeeklyCompletions(FRI, deps)).toEqual({ open: 0, completed: 0 });
  });

  it("an old snapshot (from before the week) does not complete the week", async () => {
    await ensureWeeklyTask(WED, deps);
    store.snapshots.push({ id: "old", periodTo: "2026-10-23", uploadedAt: new Date("2026-10-23T09:00:00Z"), uploadedById: MIHIR });
    store.snapshots.push({ id: "older-data", periodTo: "2026-10-28", uploadedAt: new Date("2026-11-03T09:00:00Z"), uploadedById: MIHIR }); // confirmed this week, data from last week
    expect(await reconcileWeeklyCompletions(FRI, deps)).toEqual({ open: 1, completed: 0 });
    expect(store.weeks.get("2026-11-02")!.completedAt).toBeNull();
  });
});

describe("reminders — each once, only while open", () => {
  it("on the due day: one 'due today' nudge, not repeated; the day after: one 'overdue' nudge, not repeated", async () => {
    await ensureWeeklyTask(WED, deps);
    const taskId = store.weeks.get("2026-11-02")!.taskId;
    expect(await sendWeeklyReminders(WED, deps)).toEqual({ dueToday: 0, overdue: 0 });
    expect(await sendWeeklyReminders(FRI, deps)).toEqual({ dueToday: 1, overdue: 0 });
    expect(await sendWeeklyReminders(new Date("2026-11-06T13:00:00Z"), deps)).toEqual({ dueToday: 0, overdue: 0 }); // later the same day
    expect(await sendWeeklyReminders(SAT, deps)).toEqual({ dueToday: 0, overdue: 1 });
    expect(await sendWeeklyReminders(NEXT_MON, deps)).toEqual({ dueToday: 0, overdue: 0 });
    const nudges = sent.filter((n) => n.kind === "nudge");
    expect(nudges).toHaveLength(2);
    expect(nudges[0]).toMatchObject({ userId: MIHIR, taskId, title: `Due today: '${WEEKLY_TASK_TITLE}'` });
    expect(nudges[1]!.title).toMatch(/^Overdue: /);
    expect(nudges[1]!.body).toContain("Status: Overdue");
    for (const n of nudges) expect(n.body).toContain("/collection/tracker");
  });

  it("a completed week is never reminded", async () => {
    await ensureWeeklyTask(WED, deps);
    await completeWeeklyUploadForSnapshot({ id: "s", periodTo: null, uploadedAt: WED, uploadedById: MIHIR }, deps);
    expect(await sendWeeklyReminders(FRI, deps)).toEqual({ dueToday: 0, overdue: 0 });
    expect(await sendWeeklyReminders(SAT, deps)).toEqual({ dueToday: 0, overdue: 0 });
    expect(sent.filter((n) => n.kind === "nudge")).toHaveLength(0);
  });

  it("the daily sweep does all three steps and is safe to run twice", async () => {
    const first = await runWeeklyUploadSweep(FRI, deps);
    expect(first).toMatchObject({ ensure: "created", weekStart: "2026-11-02", reminders: { dueToday: 1, overdue: 0 } });
    const second = await runWeeklyUploadSweep(FRI, deps);
    expect(second).toMatchObject({ ensure: "exists", reminders: { dueToday: 0, overdue: 0 }, reconciled: { open: 1, completed: 0 } });
    expect(sent).toHaveLength(2); // assigned + due today
  });
});

describe("changing the responsible employee", () => {
  it("open weeks move to the new person with an audit row and a notification; completed weeks keep their history", async () => {
    await ensureWeeklyTask(new Date("2026-10-28T10:00:00Z"), deps);
    await completeWeeklyUploadForSnapshot({ id: "s", periodTo: "2026-10-30", uploadedAt: new Date("2026-10-30T10:00:00Z"), uploadedById: MIHIR }, deps);
    await ensureWeeklyTask(WED, deps);
    sent.length = 0;
    const r = await syncOpenWeeksToAssignee(OTHER, ADMIN, WED, deps);
    expect(r).toEqual({ reassigned: 1 });
    expect(store.weeks.get("2026-11-02")!.doerId).toBe(OTHER);
    expect(store.tasks.get(store.weeks.get("2026-11-02")!.taskId)!.events).toContain(`reassigned:${ADMIN}`);
    expect(store.weeks.get("2026-10-26")!.doerId).toBe(MIHIR);
    expect(sent).toEqual([expect.objectContaining({ userId: OTHER, kind: "task_assigned", actorId: ADMIN })]);
    // Idempotent: the same person again changes nothing.
    expect(await syncOpenWeeksToAssignee(OTHER, ADMIN, WED, deps)).toEqual({ reassigned: 0 });
  });
});

describe("the task is recognised as compulsory", () => {
  it("by its id, and only it", async () => {
    await ensureWeeklyTask(WED, deps);
    expect(await isCompulsoryWeeklyTask(store.weeks.get("2026-11-02")!.taskId, store)).toBe(true);
    expect(await isCompulsoryWeeklyTask("some-other-task", store)).toBe(false);
  });
});
