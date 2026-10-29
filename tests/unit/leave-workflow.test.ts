import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkCanDecide, inclusiveLeaveDays, isRealIsoDate, leaveKindOn, requestsToReroute, withoutCancelled } from "@/lib/leave/workflow";
import { resolvePolicy } from "@/lib/attendance/policy";
import { ApplyForLeave, DecideLeave } from "@/lib/validators/leave";

describe("inclusive leave days", () => {
  it("counts both ends: 15 to 21 September is 7", () => {
    expect(inclusiveLeaveDays("2026-09-15", "2026-09-21")).toBe(7);
  });
  it("a single day is 1, and Sundays/holidays are not subtracted", () => {
    expect(inclusiveLeaveDays("2026-09-15", "2026-09-15")).toBe(1);
    // 2026-09-20 is a Sunday; it still counts.
    expect(inclusiveLeaveDays("2026-09-19", "2026-09-21")).toBe(3);
  });
  it("crosses month and year ends", () => {
    expect(inclusiveLeaveDays("2026-12-30", "2027-01-02")).toBe(4);
  });
  it("is null for a reversed range or a date that does not exist", () => {
    expect(inclusiveLeaveDays("2026-09-21", "2026-09-15")).toBeNull();
    expect(inclusiveLeaveDays("2026-02-31", "2026-03-02")).toBeNull();
    expect(isRealIsoDate("2026-13-01")).toBe(false);
    expect(isRealIsoDate("2024-02-29")).toBe(true);
  });
});

describe("ApplyForLeave validation", () => {
  const ok = { startDate: "2026-09-15", endDate: "2026-09-21", leaveType: "planned", reason: "Family wedding" };
  it("accepts a complete request", () => {
    expect(ApplyForLeave.safeParse(ok).success).toBe(true);
  });
  it("requires a reason, trimmed", () => {
    const r = ApplyForLeave.safeParse({ ...ok, reason: "   " });
    expect(r.success).toBe(false);
    expect(r.success ? "" : r.error.issues[0]!.message).toMatch(/Reason for leave is required/);
  });
  it("requires Emergency or Planned", () => {
    expect(ApplyForLeave.safeParse({ ...ok, leaveType: "casual" }).success).toBe(false);
    expect(ApplyForLeave.safeParse({ ...ok, leaveType: undefined }).success).toBe(false);
  });
  it("rejects a To date before the From date", () => {
    const r = ApplyForLeave.safeParse({ ...ok, startDate: "2026-09-21", endDate: "2026-09-15" });
    expect(r.success).toBe(false);
  });
  it("rejects fields the client must not control: employee, approver, status", () => {
    for (const extra of [{ employeeId: "x" }, { approverId: "x" }, { status: "approved" }]) {
      expect(ApplyForLeave.safeParse({ ...ok, ...extra }).success).toBe(false);
    }
  });
});

describe("DecideLeave validation", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("requires remarks to reject, not to approve", () => {
    expect(DecideLeave.safeParse({ id, verdict: "rejected" }).success).toBe(false);
    expect(DecideLeave.safeParse({ id, verdict: "rejected", note: "  " }).success).toBe(false);
    expect(DecideLeave.safeParse({ id, verdict: "rejected", note: "Peak week" }).success).toBe(true);
    expect(DecideLeave.safeParse({ id, verdict: "approved" }).success).toBe(true);
  });
});

describe("who may decide", () => {
  // The decider holds "approve or reject" and the request is assigned to them.
  const base = {
    deciderId: "approver",
    canDecide: true,
    canOverride: false,
    requestEmployeeId: "emp",
    requestStatus: "pending",
    requestApproverId: "approver" as string | null,
  };
  it("lets the assigned approver who holds the decide permission decide a pending request", () => {
    expect(checkCanDecide(base).ok).toBe(true);
  });
  it("refuses anyone without the decide permission, whatever the request says", () => {
    expect(checkCanDecide({ ...base, canDecide: false }).ok).toBe(false);
    expect(checkCanDecide({ ...base, canDecide: false, canOverride: true }).ok).toBe(false);
  });
  it("refuses a request assigned to someone else or to nobody — unless they hold the override", () => {
    for (const requestApproverId of ["someone-else", null]) {
      expect(checkCanDecide({ ...base, requestApproverId }).ok).toBe(false);
      expect(checkCanDecide({ ...base, requestApproverId, canOverride: true }).ok).toBe(true);
    }
  });
  it("refuses deciding your own request, even with the override", () => {
    expect(checkCanDecide({ ...base, requestEmployeeId: "approver" }).ok).toBe(false);
    expect(checkCanDecide({ ...base, requestEmployeeId: "approver", canOverride: true }).ok).toBe(false);
  });
  it("refuses a second, conflicting decision, override or not", () => {
    for (const requestStatus of ["approved", "rejected", "cancelled"]) {
      for (const canOverride of [false, true]) {
        const r = checkCanDecide({ ...base, requestStatus, canOverride });
        expect(r.ok).toBe(false);
        expect(r.ok ? "" : r.error).toContain(requestStatus);
      }
    }
  });
  it("knows no identity: the verdict depends only on the flags and ids it is given", () => {
    const src = readFileSync(resolve(__dirname, "../../lib/leave/workflow.ts"), "utf8");
    expect(src).not.toMatch(/@[a-z0-9-]+\.[a-z]{2,}/i);
    expect(src).not.toMatch(/mihir/i);
    expect(src).not.toMatch(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i);
  });
});

describe("re-routing pending requests", () => {
  const rows = [
    { id: "a", employeeId: "e1", approverId: null },
    { id: "b", employeeId: "e2", approverId: "old" },
    { id: "c", employeeId: "e3", approverId: "default" },
    { id: "d", employeeId: "default", approverId: null },
  ];
  it("moves the unrouted and wrongly routed ones, not those already with the default or the default's own", () => {
    expect(requestsToReroute(rows, "default").map((r) => r.id)).toEqual(["a", "b"]);
  });
  it("is empty when nothing needs moving", () => {
    expect(requestsToReroute([], "default")).toEqual([]);
  });
});

describe("listing an employee's applications", () => {
  it("leaves out cancelled ones and keeps every other status, in order", () => {
    const rows = [
      { id: "a", status: "pending" },
      { id: "b", status: "cancelled" },
      { id: "c", status: "approved" },
      { id: "d", status: "rejected" },
    ];
    expect(withoutCancelled(rows).map((r) => r.id)).toEqual(["a", "c", "d"]);
    expect(rows).toHaveLength(4); // the input is not mutated
  });
});

describe("how approved leave is classified for attendance and pay", () => {
  const L = (kind: "paid" | "unpaid" | null, status = "approved", startDate = "2026-10-12", endDate = "2026-10-14") => ({
    kind,
    status,
    startDate,
    endDate,
  });
  it("keeps explicit legacy paid and unpaid exactly as they were, whatever the policy", () => {
    for (const nullKindAs of ["paid", "unpaid"] as const) {
      expect(leaveKindOn("2026-10-13", [L("paid")], nullKindAs)).toBe("paid");
      expect(leaveKindOn("2026-10-13", [L("unpaid")], nullKindAs)).toBe("unpaid");
    }
  });
  it("an approved request with no kind takes the policy's classification", () => {
    expect(leaveKindOn("2026-10-13", [L(null)], "paid")).toBe("paid");
    expect(leaveKindOn("2026-10-13", [L(null)], "unpaid")).toBe("unpaid");
  });
  it("pending, rejected and cancelled requests never cover a day", () => {
    for (const status of ["pending", "rejected", "cancelled"]) {
      expect(leaveKindOn("2026-10-13", [L(null, status), L("paid", status)], "paid")).toBeNull();
    }
  });
  it("only the leave's own dates are covered", () => {
    expect(leaveKindOn("2026-10-11", [L(null)], "paid")).toBeNull();
    expect(leaveKindOn("2026-10-14", [L(null)], "paid")).toBe("paid");
    expect(leaveKindOn("2026-10-15", [L(null)], "paid")).toBeNull();
  });
  it("Emergency and Planned play no part: the same no-kind row is classified the same", () => {
    const emergency = { ...L(null), leaveType: "emergency" };
    const planned = { ...L(null), leaveType: "planned" };
    expect(leaveKindOn("2026-10-13", [emergency], "paid")).toBe(leaveKindOn("2026-10-13", [planned], "paid"));
  });
  it("when an explicit paid and a no-kind unpaid-by-policy leave overlap, paid wins", () => {
    expect(leaveKindOn("2026-10-13", [L(null), L("paid")], "unpaid")).toBe("paid");
  });
  it("a policy change alters later months only (approved_leave_payment, by effective date)", () => {
    const changes = [
      { key: "approved_leave_payment", value: "unpaid" as const, effectiveFrom: "2026-11-01", createdAt: new Date("2026-10-20") },
    ];
    const octoberPolicy = resolvePolicy(changes, "2026-10-01").approved_leave_payment;
    const novemberPolicy = resolvePolicy(changes, "2026-11-01").approved_leave_payment;
    expect(octoberPolicy).toBe("paid");
    expect(novemberPolicy).toBe("unpaid");
    const row = L(null, "approved", "2026-10-30", "2026-11-02");
    expect(leaveKindOn("2026-10-30", [row], octoberPolicy as "paid")).toBe("paid");
    expect(leaveKindOn("2026-11-02", [row], novemberPolicy as "unpaid")).toBe("unpaid");
  });
  it("the attendance grid and the dashboard (which salary reads) both use this one classifier with the policy", () => {
    const src = readFileSync(resolve(__dirname, "../../lib/queries/attendance-status.ts"), "utf8");
    expect(src).toContain("import { leaveKindOn");
    expect(src).not.toContain("function leaveKindOn");
    expect(src.split("nullLeaveKindForMonth(year, month")).toHaveLength(3); // two call sites (grid: lenient, dashboard: strict-aware)
    expect(src).toContain("leaveKindOn(ymd, dayCtx.leaves, dayCtx.nullLeaveKindAs)");
  });
});
