import { describe, it, expect } from "vitest";
import {
  AdminUpsertPunch,
  AdminQuickPunch,
  AdminEditDayTimes,
  AdminDeletePunch,
  AdminLookupDay,
} from "@/lib/validators/attendance";

const EMP = "11111111-1111-4111-8111-111111111111";
const WHY = "Machine was down all morning.";
const SNAP = { in: "2026-06-14T04:40:00.000Z", out: null };

describe("AdminUpsertPunch", () => {
  const ok = { employeeId: EMP, logDate: "2026-06-14", kind: "in", timeHHmm: "10:30", reason: "forgot", explanation: WHY, snapshot: SNAP };

  it("accepts a valid punch with reason, explanation and snapshot", () => {
    expect(AdminUpsertPunch.safeParse(ok).success).toBe(true);
  });

  it("rejects a bad time format", () => {
    expect(AdminUpsertPunch.safeParse({ ...ok, timeHHmm: "9:5" }).success).toBe(false);
  });

  it("rejects an unknown reason", () => {
    expect(AdminUpsertPunch.safeParse({ ...ok, reason: "vacation" }).success).toBe(false);
  });

  it("rejects a bad date format", () => {
    expect(AdminUpsertPunch.safeParse({ ...ok, logDate: "14-06-2026" }).success).toBe(false);
  });

  it("rejects a non-uuid employee id", () => {
    expect(AdminUpsertPunch.safeParse({ ...ok, employeeId: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects an unknown kind", () => {
    expect(AdminUpsertPunch.safeParse({ ...ok, kind: "lunch" }).success).toBe(false);
  });

  it("rejects extra keys (strict)", () => {
    expect(AdminUpsertPunch.safeParse({ ...ok, extra: true }).success).toBe(false);
  });

  it("needs an explanation and the snapshot of what the admin saw", () => {
    const { explanation: _e, ...noWhy } = ok;
    const { snapshot: _s, ...noSnap } = ok;
    expect(AdminUpsertPunch.safeParse(noWhy).success).toBe(false);
    expect(AdminUpsertPunch.safeParse(noSnap).success).toBe(false);
    expect(AdminUpsertPunch.safeParse({ ...ok, snapshot: { in: "not a date", out: null } }).success).toBe(false);
  });
});

describe("AdminQuickPunch", () => {
  const ok = { employeeId: EMP, logDate: "2026-06-14", kind: "out", timeHHmm: "19:10", explanation: WHY };
  it("accepts a quick punch with an explanation", () => {
    expect(AdminQuickPunch.safeParse(ok).success).toBe(true);
  });
  it("needs an explanation, and the reason can't be chosen by the caller", () => {
    const { explanation: _e, ...noWhy } = ok;
    expect(AdminQuickPunch.safeParse(noWhy).success).toBe(false);
    expect(AdminQuickPunch.safeParse({ ...ok, reason: "wfh" }).success).toBe(false);
  });
});

describe("AdminEditDayTimes", () => {
  const base = { employeeId: EMP, logDate: "2026-06-14", reason: "correction", explanation: WHY, snapshot: SNAP };

  it("accepts in only", () => {
    expect(AdminEditDayTimes.safeParse({ ...base, inHHmm: "10:30" }).success).toBe(true);
  });

  it("accepts both", () => {
    expect(AdminEditDayTimes.safeParse({ ...base, inHHmm: "10:30", outHHmm: "19:30" }).success).toBe(true);
  });

  it("rejects when neither time is supplied", () => {
    expect(AdminEditDayTimes.safeParse(base).success).toBe(false);
  });

  it("rejects a bad time format", () => {
    expect(AdminEditDayTimes.safeParse({ ...base, outHHmm: "7pm" }).success).toBe(false);
  });

  it("needs a reason, an explanation and the snapshot", () => {
    const { reason: _r, ...noReason } = base;
    const { explanation: _e, ...noWhy } = base;
    const { snapshot: _s, ...noSnap } = base;
    for (const v of [noReason, noWhy, noSnap]) {
      expect(AdminEditDayTimes.safeParse({ ...v, inHHmm: "10:30" }).success).toBe(false);
    }
  });
});

describe("AdminDeletePunch", () => {
  const ok = { employeeId: EMP, logDate: "2026-06-14", kind: "out", reason: "correction", explanation: WHY, snapshot: SNAP };

  it("accepts a valid, reasoned delete", () => {
    expect(AdminDeletePunch.safeParse(ok).success).toBe(true);
  });

  it("rejects a bad date", () => {
    expect(AdminDeletePunch.safeParse({ ...ok, logDate: "2026/06/14" }).success).toBe(false);
  });

  it("can't delete silently: reason, explanation and snapshot are required", () => {
    const { reason: _r, ...noReason } = ok;
    const { explanation: _e, ...noWhy } = ok;
    const { snapshot: _s, ...noSnap } = ok;
    for (const v of [noReason, noWhy, noSnap]) expect(AdminDeletePunch.safeParse(v).success).toBe(false);
  });
});

describe("AdminLookupDay", () => {
  it("takes an employee and a date only", () => {
    expect(AdminLookupDay.safeParse({ employeeId: EMP, logDate: "2026-06-14" }).success).toBe(true);
    expect(AdminLookupDay.safeParse({ employeeId: EMP, logDate: "2026-06-14", extra: 1 }).success).toBe(false);
  });
});
