import { describe, it, expect } from "vitest";
import { buildPlan, punchKey, type PlanEmployee, type PlanInput } from "@/lib/attendance/import/plan";

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";

const day = (date: string | null, inTime: string | null, outTime: string | null) => ({
  rowNo: 1,
  date,
  inTime,
  outTime,
  status: "Present",
  problems: [] as string[],
});
const emp = (code: string, days: ReturnType<typeof day>[], extra: Partial<PlanEmployee> = {}): PlanEmployee => ({
  key: code,
  code,
  name: `Test ${code}`,
  department: null,
  days,
  ...extra,
});
const base = (over: Partial<PlanInput>): PlanInput => ({
  employees: [],
  mapping: {},
  employeeTz: new Map([
    [A, "Asia/Kolkata"],
    [B, "Asia/Kolkata"],
  ]),
  existing: new Map(),
  today: "2026-10-17",
  ...over,
});

describe("duplicate punches: same time vs different time", () => {
  const mk = (stored: string) =>
    buildPlan(
      base({
        employees: [emp("1", [day("2026-04-01", "10:10", "19:32")])],
        mapping: { "1": A },
        existing: new Map([[punchKey(A, "2026-04-01", "in"), new Date(stored)]]),
      }),
    );

  it("reports a matching stored punch as already existing (seconds are ignored)", () => {
    const p = mk("2026-04-01T04:40:37.000Z"); // 10:10:37 IST
    expect(p.punches[0]).toMatchObject({ kind: "in", status: "duplicate", existingTime: "10:10" });
    expect(p.summary).toMatchObject({ duplicatePunches: 1, mismatchPunches: 0, readyPunches: 1 });
    expect(p.issues.find((i) => i.level === "info")!.message).toMatch(/already exists/);
  });

  it("flags a stored punch with a different time, shows both times and keeps it", () => {
    const p = mk("2026-04-01T04:42:00.000Z"); // 10:12 IST stored, file says 10:10
    expect(p.punches[0]).toMatchObject({ kind: "in", status: "mismatch", existingTime: "10:12", time: "10:10" });
    expect(p.summary).toMatchObject({ mismatchPunches: 1, duplicatePunches: 0, readyPunches: 1 });
    const w = p.issues.find((i) => i.level === "warning")!;
    expect(w.message).toMatch(/10:12 is already stored, the file says 10:10/);
    expect(w.message).toMatch(/nothing is overwritten/);
  });
});

describe("per-employee stats and warnings", () => {
  it("reports first / last dates and counts per person, including a person whose punches are all stored", () => {
    const p = buildPlan(
      base({
        employees: [
          emp("1", [day("2026-04-03", "10:00", "18:00"), day("2026-04-01", "10:00", null)], { noPunchDays: 5 }),
          emp("2", [day("2026-04-02", "09:00", "17:00")]),
        ],
        mapping: { "1": A, "2": B },
        existing: new Map([
          [punchKey(B, "2026-04-02", "in"), new Date("2026-04-02T03:30:00.000Z")],
          [punchKey(B, "2026-04-02", "out"), new Date("2026-04-02T11:30:00.000Z")],
        ]),
      }),
    );
    const one = p.perEmployee.find((s) => s.sourceKey === "1")!;
    const two = p.perEmployee.find((s) => s.sourceKey === "2")!;
    expect(one).toMatchObject({ firstDate: "2026-04-01", lastDate: "2026-04-03", ready: 3, planned: 3 });
    expect(two).toMatchObject({ ready: 0, duplicate: 2, planned: 2 });
    expect(p.summary.noPunchDays).toBe(5);
    expect(p.punchDates).toMatchObject({ first: "2026-04-01", last: "2026-04-03", distinct: 3 });
  });

  it("warns, but still imports, when IN and OUT are the same time", () => {
    const p = buildPlan(base({ employees: [emp("1", [day("2026-04-01", "10:00", "10:00")])], mapping: { "1": A } }));
    expect(p.summary.readyPunches).toBe(2);
    expect(p.issues[0]).toMatchObject({ level: "warning" });
    expect(p.issues[0]!.message).toMatch(/both 10:00/);
  });

  it("blocks an employee code listed more than once, with a clear message", () => {
    const p = buildPlan(
      base({
        employees: [emp("7", [day("2026-04-01", "10:00", "18:00")]), emp("7", [day("2026-04-02", "10:00", "18:00")])],
        mapping: { "7": A },
      }),
    );
    expect(p.blockers.join(" ")).toMatch(/Employee code 7 appears 2 times in the file/);
    expect(p.punches).toEqual([]);
  });
});

describe("reporting period", () => {
  const e = [emp("1", [day("2026-04-01", "10:00", "18:00"), day("2026-05-02", "10:00", "18:00")])];

  it("rejects punches outside the period the admin confirmed", () => {
    const p = buildPlan(base({ employees: e, mapping: { "1": A }, confirmedPeriod: { from: "2026-04-01", to: "2026-04-30" } }));
    expect(p.summary).toMatchObject({ invalidRows: 1, readyPunches: 2 });
    expect(p.issues.find((i) => i.level === "error")!.message).toMatch(/outside the period you confirmed/);
  });

  it("only warns about rows outside the file's own declared period", () => {
    const p = buildPlan(base({ employees: e, mapping: { "1": A }, declaredPeriod: { from: "2026-04-01", to: "2026-04-30" } }));
    expect(p.summary).toMatchObject({ outsideDeclaredRows: 1, invalidRows: 0, readyPunches: 4 });
  });
});
