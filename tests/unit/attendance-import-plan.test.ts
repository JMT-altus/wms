import { describe, it, expect } from "vitest";
import { buildPlan, punchKey, SKIP_EMPLOYEE, type PlanInput } from "@/lib/attendance/import/plan";
import { zonedWallClockToUtc } from "@/lib/attendance/zoned-time";
import type { SourceDay, SourceEmployee } from "@/lib/attendance/import/parse-report";

const EMP_A = "11111111-1111-4111-8111-111111111111";
const EMP_B = "22222222-2222-4222-8222-222222222222";

const day = (date: string | null, inTime: string | null, outTime: string | null, extra: Partial<SourceDay> = {}): SourceDay => ({
  rowNo: 1,
  date,
  dateRaw: date ?? "",
  inTime,
  outTime,
  shift: "GS",
  duration: null,
  status: "Present",
  problems: [],
  ...extra,
});
const emp = (code: string, days: SourceDay[]): SourceEmployee => ({ key: code, code, name: `Test ${code}`, department: null, days });

function input(over: Partial<PlanInput>): PlanInput {
  return {
    employees: [],
    mapping: {},
    employeeTz: new Map([
      [EMP_A, "Asia/Kolkata"],
      [EMP_B, "Asia/Kolkata"],
    ]),
    existing: new Map(),
    today: "2026-10-17",
    ...over,
  };
}

describe("attendance import: timestamp conversion", () => {
  it("reads in/out as the employee wall-clock time (IST = UTC+5:30)", () => {
    expect(zonedWallClockToUtc("2026-04-01", "10:10", "Asia/Kolkata").toISOString()).toBe("2026-04-01T04:40:00.000Z");
    expect(zonedWallClockToUtc("2026-04-01", "00:15", "Asia/Kolkata").toISOString()).toBe("2026-03-31T18:45:00.000Z");
    expect(zonedWallClockToUtc("2026-04-01", "10:10", "UTC").toISOString()).toBe("2026-04-01T10:10:00.000Z");
  });
});

describe("attendance import: plan", () => {
  it("plans an IN and an OUT punch for a full day, in the employee timezone", () => {
    const p = buildPlan(input({ employees: [emp("1", [day("2026-04-01", "10:10", "19:32")])], mapping: { "1": EMP_A } }));
    expect(p.blockers).toEqual([]);
    expect(p.punches.map((x) => [x.kind, x.time, x.loggedAt, x.status])).toEqual([
      ["in", "10:10", "2026-04-01T04:40:00.000Z", "ready"],
      ["out", "19:32", "2026-04-01T14:02:00.000Z", "ready"],
    ]);
    expect(p.summary.readyPunches).toBe(2);
  });

  it("requires a decision for every source employee, and skip is a decision", () => {
    const e = [emp("1", [day("2026-04-01", "10:00", "18:00")]), emp("2", [day("2026-04-01", "10:00", "18:00")])];
    const open = buildPlan(input({ employees: e, mapping: { "1": EMP_A } }));
    expect(open.summary.undecidedEmployees).toBe(1);
    expect(open.blockers[0]).toMatch(/has not been mapped/);
    const done = buildPlan(input({ employees: e, mapping: { "1": EMP_A, "2": SKIP_EMPLOYEE } }));
    expect(done.blockers).toEqual([]);
    expect(done.summary.skippedEmployees).toBe(1);
    expect(done.punches).toHaveLength(2);
  });

  it("blocks two source employees mapped to the same JMT employee", () => {
    const e = [emp("1", [day("2026-04-01", "10:00", "18:00")]), emp("2", [day("2026-04-01", "10:00", "18:00")])];
    expect(buildPlan(input({ employees: e, mapping: { "1": EMP_A, "2": EMP_A } })).blockers.join(" ")).toMatch(/same JMT employee/);
  });

  it("blocks a mapping to an employee that is not active or does not exist", () => {
    const p = buildPlan(
      input({ employees: [emp("1", [day("2026-04-01", "10:00", null)])], mapping: { "1": EMP_B }, employeeTz: new Map() }),
    );
    expect(p.blockers[0]).toMatch(/no longer exists or is not active/);
  });

  it("never makes up punches: absent and blank days import nothing", () => {
    const p = buildPlan(
      input({
        employees: [emp("1", [day("2026-04-03", null, null, { status: "Absent" }), day("2026-04-05", null, null, { status: "WeeklyOff" })])],
        mapping: { "1": EMP_A },
      }),
    );
    expect(p.punches).toEqual([]);
    expect(p.summary.noPunchDays).toBe(2);
  });

  it("imports a one-sided day as that single punch and warns", () => {
    const p = buildPlan(
      input({ employees: [emp("1", [day("2026-04-02", "09:05", null, { status: "Present (No OutPunch)" })])], mapping: { "1": EMP_A } }),
    );
    expect(p.punches.map((x) => x.kind)).toEqual(["in"]);
    expect(p.summary.singlePunchDays).toBe(1);
    expect(p.issues[0]).toMatchObject({ level: "warning" });
    expect(p.issues[0]!.message).toMatch(/OUT is not made up/);
  });

  it("marks punches that already exist as duplicates and skips them", () => {
    const p = buildPlan(
      input({
        employees: [emp("1", [day("2026-04-01", "10:10", "19:32")])],
        mapping: { "1": EMP_A },
        existing: new Map([[punchKey(EMP_A, "2026-04-01", "in"), new Date("2026-04-01T04:40:00.000Z")]]),
      }),
    );
    expect(p.punches.map((x) => [x.kind, x.status])).toEqual([
      ["in", "duplicate"],
      ["out", "ready"],
    ]);
    expect(p.summary).toMatchObject({ readyPunches: 1, duplicatePunches: 1 });
  });

  it("is idempotent: a second plan against what the first wrote has nothing left to add", () => {
    const e = [emp("1", [day("2026-04-01", "10:10", "19:32"), day("2026-04-02", "10:00", "18:00")])];
    const first = buildPlan(input({ employees: e, mapping: { "1": EMP_A } }));
    const existing = new Map(first.punches.filter((x) => x.status === "ready").map((x) => [punchKey(x.employeeId, x.date, x.kind), new Date(x.loggedAt)] as const));
    const second = buildPlan(input({ employees: e, mapping: { "1": EMP_A }, existing }));
    expect(second.summary.readyPunches).toBe(0);
    expect(second.summary.duplicatePunches).toBe(4);
  });

  it("rejects bad rows with a reason and still plans the good ones", () => {
    const p = buildPlan(
      input({
        employees: [
          emp("1", [
            day("2026-04-01", "10:10", "19:32"),
            day(null, "10:00", "11:00", { problems: ['Date "31-Feb-2026" is not a valid date.'] }),
            day("2026-04-04", "19:00", "09:00"), // out before in
            day("2026-12-25", "10:00", "18:00"), // future
            day("2026-04-01", "11:00", "12:00"), // second row for the same day
            day("2026-04-06", "9:5", "18:00"), // not HH:mm (server re-check)
          ]),
        ],
        mapping: { "1": EMP_A },
      }),
    );
    expect(p.summary.invalidRows).toBe(5);
    expect(p.punches).toHaveLength(2);
    const msgs = p.issues
      .filter((i) => i.level === "error")
      .map((i) => i.message)
      .join(" | ");
    expect(msgs).toMatch(/not a valid date/);
    expect(msgs).toMatch(/earlier than in time/);
    expect(msgs).toMatch(/in the future/);
    expect(msgs).toMatch(/More than one row/);
    expect(msgs).toMatch(/not HH:mm/);
  });
});
