import { describe, it, expect } from "vitest";
import { computeEmployeeStatusTable } from "@/lib/transforms/employee-status-table";
import { TASK_STATUSES } from "@/db/enums";
import { fixtureTasks, fixtureEmployees, task as makeTask } from "../fixtures/tasks";

describe("computeEmployeeStatusTable (by doer)", () => {
  it("aggregates Ankit's tasks correctly", () => {
    const rows = computeEmployeeStatusTable(
      fixtureTasks,
      fixtureEmployees,
      "doer",
    );
    const ankit = rows.find((r) => r.employeeName === "Ankit Sharma");
    expect(ankit).toMatchObject({
      done: 5,
      approved: 2,
      initiated: 1,
      total: 8,
      pendingTotal: 1,
    });
  });

  it("aggregates Priya's tasks correctly", () => {
    const rows = computeEmployeeStatusTable(
      fixtureTasks,
      fixtureEmployees,
      "doer",
    );
    const priya = rows.find((r) => r.employeeName === "Priya Iyer");
    expect(priya).toMatchObject({
      done: 3,
      cancelled: 1,
      needHelp: 1,
      followUp: 1,
      total: 6,
      pendingTotal: 2,
    });
  });

  it("row totals sum to fixture length", () => {
    const rows = computeEmployeeStatusTable(
      fixtureTasks,
      fixtureEmployees,
      "doer",
    );
    const total = rows.reduce((s, r) => s + r.total, 0);
    expect(total).toBe(fixtureTasks.length);
  });

  it("projects each employee's department through to their row", () => {
    const rows = computeEmployeeStatusTable(
      fixtureTasks,
      fixtureEmployees,
      "doer",
    );
    const ankit = rows.find((r) => r.employeeName === "Ankit Sharma");
    const priya = rows.find((r) => r.employeeName === "Priya Iyer");
    expect(ankit?.department).toBe("Operations");
    expect(priya?.department).toBe("Underwriting");
  });
});

describe("computeEmployeeStatusTable — every task lands in a column", () => {
  const doerId = fixtureEmployees[0]!.id;

  // The regression: Total incremented unconditionally but the status switch
  // had no case for dont_know / on_hold / need_help, so those tasks showed as
  // "Total 1" with every column reading 0 — a row pointing at work the viewer
  // could not account for. Assert the invariant for EVERY status in the enum
  // so a newly added one can't reopen the hole.
  it.each(TASK_STATUSES)("buckets %s so the columns account for Total", (status) => {
    const rows = computeEmployeeStatusTable(
      [makeTask({ status, doerId, archived: false, approvalStatus: null })],
      fixtureEmployees,
      "doer",
    );
    const row = rows.find((r) => r.employeeId === doerId);
    expect(row?.total).toBe(1);
    const bucketed =
      (row?.approved ?? 0) +
      (row?.notApproved ?? 0) +
      (row?.done ?? 0) +
      (row?.transferred ?? 0) +
      (row?.cancelled ?? 0) +
      (row?.pendingTotal ?? 0);
    expect(bucketed).toBe(1);
  });

  it("counts a brand-new task (Not Seen) as Pending, not as an unexplained Total", () => {
    const rows = computeEmployeeStatusTable(
      [makeTask({ status: "dont_know", doerId, archived: false, approvalStatus: null })],
      fixtureEmployees,
      "doer",
    );
    const row = rows.find((r) => r.employeeId === doerId);
    expect(row?.pendingTotal).toBe(1);
    expect(row?.total).toBe(1);
  });
});

describe("computeEmployeeStatusTable — archived", () => {
  const doerId = fixtureEmployees[0]!.id;

  it("excludes archived tasks entirely", () => {
    const rows = computeEmployeeStatusTable(
      [makeTask({ status: "dont_know", doerId, archived: true, approvalStatus: null })],
      fixtureEmployees,
      "doer",
    );
    // Not merely uncounted in the columns — the person gets no row at all,
    // so an archived task can't leave a phantom "Total 1" behind.
    expect(rows.find((r) => r.employeeId === doerId)).toBeUndefined();
  });

  it("does not let an archived critical task inflate the Critical count", () => {
    const rows = computeEmployeeStatusTable(
      [
        makeTask({ status: "done", doerId, archived: false, approvalStatus: null }),
        makeTask({
          status: "not_started",
          priority: "imp_urgent",
          doerId,
          archived: true,
          approvalStatus: null,
        }),
      ],
      fixtureEmployees,
      "doer",
    );
    const row = rows.find((r) => r.employeeId === doerId);
    expect(row?.total).toBe(1);
    expect(row?.criticalCount).toBe(0);
  });
});
