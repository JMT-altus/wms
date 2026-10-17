import { describe, expect, it } from "vitest";
import { employeeEventCopy, groupByDay, type ActivityRow } from "@/lib/transforms/activity";
import { IMPORT_EVENT, IMPORT_UNDO_EVENT } from "@/lib/attendance/import/batch";

// Mock rows only — no database. The activity feed unions employee_events, so the
// import / undo audit rows show up there; they must render, not crash or vanish.
const row = (eventType: string, over: Partial<ActivityRow> = {}): ActivityRow =>
  ({
    source: "employee",
    id: "e1",
    taskId: null,
    taskTitle: null,
    taskNo: null,
    targetEmployeeId: "11111111-1111-4111-8111-111111111111",
    targetEmployeeName: "Alpha One",
    settingScope: null,
    settingTargetId: null,
    actorId: "99999999-9999-4999-8999-999999999999",
    actorName: "Admin User",
    actorAvatarUrl: null,
    eventType,
    fromValue: null,
    toValue: { batchId: "33333333-3333-4333-8333-333333333333", punches: new Array(400).fill({ id: "x" }) },
    note: "Attendance import: 400 punches added",
    createdAt: new Date("2026-10-17T08:00:00.000Z"),
    ...over,
  }) as unknown as ActivityRow;

describe("activity feed: attendance import events", () => {
  it("renders the import and undo audit rows with readable text naming the employee", () => {
    expect(employeeEventCopy(row(IMPORT_EVENT))).toBe("attendance import (Alpha One)");
    expect(employeeEventCopy(row(IMPORT_UNDO_EVENT))).toBe("attendance import undo (Alpha One)");
  });

  it("does not depend on the large inventory payload, and groups by day like any other event", () => {
    const groups = groupByDay([row(IMPORT_EVENT), row(IMPORT_UNDO_EVENT, { id: "e2" })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.events).toHaveLength(2);
  });
});
