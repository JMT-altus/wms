import { describe, expect, it } from "vitest";
import { computeDashboardInsights, type InsightTask } from "@/lib/transforms/dashboard-insights";

const NOW = new Date("2026-10-15T12:00:00Z");
const D = (iso: string) => new Date(iso + "T00:00:00Z");
const emps = [
  { id: "a", name: "Asha" },
  { id: "b", name: "Bala" },
  { id: "m", name: "Mihir" },
];
function t(p: Partial<InsightTask>): InsightTask {
  return {
    doerId: "a", initiatorId: "m", status: "not_started", approvalStatus: null,
    dueAt: D("2026-10-20"), revisedTargetDate: null, completedAt: null, archived: false, ...p,
  };
}

describe("computeDashboardInsights", () => {
  it("counts overdue = open and past the effective due date, ignoring archived", () => {
    const r = computeDashboardInsights(
      [
        t({ dueAt: D("2026-10-10") }),                       // 5 days overdue
        t({ dueAt: D("2026-10-01") }),                       // 14 days overdue
        t({ dueAt: D("2026-10-01"), revisedTargetDate: D("2026-10-30") }), // revised: not overdue
        t({ dueAt: D("2026-10-01"), archived: true }),       // archived
        t({ dueAt: D("2026-10-01"), status: "done", completedAt: D("2026-10-01") }), // not open
      ],
      emps,
      NOW,
    );
    expect(r.overdueByPerson).toHaveLength(1);
    expect(r.overdueByPerson[0]).toMatchObject({ name: "Asha", overdue: 2, oldestDays: 14 });
  });

  it("buckets delivery against the due date and computes on-time rates", () => {
    const r = computeDashboardInsights(
      [
        t({ status: "done", dueAt: D("2026-10-10"), completedAt: D("2026-10-08") }), // early
        t({ status: "done", dueAt: D("2026-10-10"), completedAt: D("2026-10-10") }), // on the day
        t({ status: "approved", dueAt: D("2026-10-10"), completedAt: D("2026-10-12") }), // 2 late
        t({ status: "done", dueAt: D("2026-10-01"), completedAt: D("2026-10-09") }), // 8 late
      ],
      emps,
      NOW,
    );
    const by = Object.fromEntries(
      [...r.delivery.lateBuckets, ...r.delivery.onTimeBuckets].map((b) => [b.key, b.count]),
    );
    // early 2d (b1), on the day (today), 2d late (o1), 8d late (o8)
    expect(by).toMatchObject({ b1: 1, today: 1, o1: 1, o8: 1, o22: 0, o4: 0, b4: 0, b8: 0 });
    expect(r.delivery).toMatchObject({ lateTotal: 2, onBeforeTotal: 2, onTimePct: 50, noComparableDate: 0 });
    expect(r.deliveredOnTime[0]).toMatchObject({ name: "Asha", delivered: 4, onTime: 2, onTimePct: 50 });
  });

  it("separates delegated work from self-assigned work per initiator", () => {
    const r = computeDashboardInsights(
      [
        t({ initiatorId: "m", doerId: "a" }),
        t({ initiatorId: "m", doerId: "b", status: "done", completedAt: D("2026-10-09") }),
        t({ initiatorId: "m", doerId: "m" }),
        t({ initiatorId: "a", doerId: "a" }),
      ],
      emps,
      NOW,
    );
    expect(r.whoCreatesWork[0]).toMatchObject({ name: "Mihir", forOthers: 2, forSelf: 1, total: 3 });
    expect(r.delegationScorecard).toHaveLength(1);
    expect(r.delegationScorecard[0]).toMatchObject({ name: "Mihir", delegated: 2, completedPct: 50 });
  });

  it("counts sent-back work from either the status or the approval verdict", () => {
    const r = computeDashboardInsights(
      [t({ status: "not_approved" }), t({ approvalStatus: "not_approved" }), t({})],
      emps,
      NOW,
    );
    expect(r.sentBack[0]).toMatchObject({ name: "Asha", sentBack: 2, total: 3, pct: 67 });
  });

  it("ranks people to pull up by overdue, late and sent-back work", () => {
    const r = computeDashboardInsights(
      [
        t({ doerId: "a", dueAt: D("2026-10-01") }),
        t({ doerId: "b", status: "not_approved" }),
        t({ doerId: "b", status: "done", dueAt: D("2026-10-01"), completedAt: D("2026-10-09") }),
      ],
      emps,
      NOW,
    );
    expect(r.pullUp.map((p) => p.name)).toEqual(["Bala", "Asha"]); // Bala: 1 sent back (2) + 1 late = 3; Asha: 1 overdue (2)
    expect(r.pullUp[0]).toMatchObject({ late: 1, sentBack: 1, onTimePct: 0 });
  });
});

import { computeSummaryPillCounts } from "@/lib/transforms/dashboard-insights";

describe("computeSummaryPillCounts", () => {
  it("counts the extra pills with the same buckets as the KPI totals", () => {
    const base = { approvalStatus: null, firstReadAt: new Date() } as const;
    const r = computeSummaryPillCounts([
      { ...base, status: "initiated" },
      { ...base, status: "initiated", approvalStatus: "approved" }, // done bucket, not Initiated
      { ...base, status: "follow_up" },
      { ...base, status: "follow_up_2" },
      { ...base, status: "abandoned" },
      { ...base, status: "not_started", firstReadAt: null }, // unread
      { ...base, status: "done", firstReadAt: null }, // terminal: not "not read"
    ]);
    expect(r).toEqual({ notRead: 1, initiated: 1, followUp: 2, abandoned: 1 });
  });
});
