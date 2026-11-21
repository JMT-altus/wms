import { describe, expect, it } from "vitest";
import { calculationDateProblem, carryCandidate, decide, firstOpenMonth } from "@/lib/incentives/category-a/settle";
import { allCategoriesAllowance, sharedShareOf } from "@/lib/incentives/shared/all-categories";
import { calculateCategoryX } from "@/lib/incentives/categories/engine";
import { inputsHashX, resultHashX } from "@/lib/incentives/categories/hash";
import type { CategoryXInput } from "@/lib/incentives/categories/types";
import { completeConfig } from "../fixtures/incentive-config";

// Shared incentive infrastructure (Phase 1), PURE — no database, server or port: the shared all-categories limit's
// accounting, recalculation differences carried into the first open month (never dropped, never twice), the
// calculation date, and the stored inputs that make a calculation reproducible whatever later drafts say. Synthetic
// values only; none of them is a business decision.
const RS = (r: number) => Math.round(r * 100);

describe("the shared all-categories limit: what a category's result uses of it", () => {
  it("a held month uses none; a released one uses what it released of its own amount and its carried balances; an older result counts as before", () => {
    expect(sharedShareOf({ earnedPaise: RS(4_000), beforeAllCategoriesPaise: RS(4_000), capConsumedPaise: 0, sharedPrePaise: 0 })).toEqual({ prePaise: 0, finalPaise: 0 });
    // category-c/4: ₹3,000 own + ₹2,500 released balances.
    expect(sharedShareOf({ earnedPaise: RS(5_500), beforeAllCategoriesPaise: RS(3_000), capConsumedPaise: RS(5_500), sharedPrePaise: RS(5_500) })).toEqual({ prePaise: RS(5_500), finalPaise: RS(5_500) });
    // A result from before category-c/4 (no sharedPrePaise): its amount before the limit and its final figure, as before.
    expect(sharedShareOf({ earnedPaise: RS(5_500), beforeAllCategoriesPaise: RS(3_000), capConsumedPaise: RS(3_000) })).toEqual({ prePaise: RS(3_000), finalPaise: RS(3_000) });
    // Categories A, B, D–G (no carry): their earned amount.
    expect(sharedShareOf({ earnedPaise: RS(9_000) })).toEqual({ prePaise: RS(9_000), finalPaise: RS(9_000) });
    expect(sharedShareOf({ earnedPaise: -RS(100) })).toEqual({ prePaise: 0, finalPaise: 0 });
  });
  it("no double counting: Category A sees Category C's released balances once, in the month they are released", () => {
    // C released ₹5,500 (₹3,000 own + ₹2,500 held earlier) and is locked; A earns ₹14,000 against ₹18,250.
    const c = { category: "C", ...sharedShareOf({ earnedPaise: RS(5_500), capConsumedPaise: RS(5_500), sharedPrePaise: RS(5_500) }), fixed: true };
    const a = allCategoriesAllowance({ capPaise: RS(18_250), policy: "proportional", order: [], own: "A", ownPrePaise: RS(14_000), others: [c] });
    expect(a.allowedPaise).toBe(RS(12_750)); // 18,250 − 5,500 — not 18,250 − 3,000
    // The month the balances were HELD, C used nothing: A had the whole limit then.
    const held = { category: "C", ...sharedShareOf({ earnedPaise: RS(2_500), capConsumedPaise: 0, sharedPrePaise: 0 }), fixed: true };
    expect(allCategoriesAllowance({ capPaise: RS(18_250), policy: "proportional", order: [], own: "A", ownPrePaise: RS(14_000), others: [held] }).allowedPaise).toBe(RS(14_000));
    // Open categories share what is left in proportion: never above the limit in total.
    const open = [{ category: "C", prePaise: RS(5_500), finalPaise: RS(5_500), fixed: false }];
    const forA = allCategoriesAllowance({ capPaise: RS(18_250), policy: "proportional", order: [], own: "A", ownPrePaise: RS(14_000), others: open }).allowedPaise;
    const forC = allCategoriesAllowance({ capPaise: RS(18_250), policy: "proportional", order: [], own: "C", ownPrePaise: RS(5_500), others: [{ category: "A", prePaise: RS(14_000), finalPaise: RS(14_000), fixed: false }] }).allowedPaise;
    expect(forA + forC).toBe(RS(18_250));
  });
});

describe("recalculation differences: carried into the first open month — never dropped, never twice", () => {
  const S = { "period.lockMode": "manual", "period.recalcUntil": "untilLocked", "adjust.openMonths": "recalculate", "adjust.lockedOrPaidMonths": "adjustInCurrentMonth", "period.lateReceipts": "adjustInCurrentOpenMonth", "adjust.windowDays": 60 };
  const P = (status: "locked" | "approved" | "paid", month = "2026-04-01") => ({ month, status, hasCurrentRun: true, currentRunSettled: false, paidAt: status === "paid" ? "2026-05-10T00:00:00Z" : null });
  const pay = { adopted: { e: RS(1_000) }, fresh: { e: RS(1_500) }, carried: {} };

  it("the candidate month: the calculation date's month, but never the recalculated month itself", () => {
    expect(carryCandidate("2026-04-01", "2026-05-20")).toBe("2026-05-01");
    expect(carryCandidate("2026-04-01", "2026-04-29")).toBe("2026-05-01"); // locked April recalculated in April → May
    expect(carryCandidate("2026-04-01", "2026-07-03")).toBe("2026-07-01");
    expect(carryCandidate("2026-12-01", "2026-12-31")).toBe("2027-01-01");
  });
  it("a locked month recalculated in its own month: the difference now goes to the next month (before: 'no later month yet', nothing carried)", () => {
    const d = decide(S, P("locked"), "2026-04-29", true, pay);
    expect(d.adopt).toBe(false);
    expect(d.carries).toEqual([{ employeeId: "e", amountPaise: RS(500), toMonth: "2026-05-01" }]);
  });
  it("the first OPEN month from the candidate (a locked, submitted, approved, paid or voided month is passed over); none within a year → not carried yet", () => {
    const status: Record<string, boolean> = { "2026-05-01": false, "2026-06-01": false };
    expect(firstOpenMonth("2026-05-01", (m) => status[m] ?? true)).toBe("2026-07-01");
    expect(firstOpenMonth("2026-05-01", () => true)).toBe("2026-05-01");
    expect(firstOpenMonth("2026-05-01", () => false)).toBeNull();
    expect(firstOpenMonth("2026-11-01", (m) => m === "2027-02-01")).toBe("2027-02-01");
    expect(firstOpenMonth("2026-05-01", (m) => m === "2027-05-01")).toBeNull(); // more than 12 months ahead
  });
  it("a difference not carried earlier is carried by the next calculation, exactly once: what was already carried is subtracted", () => {
    // Found on 20 May while May was locked: nothing carried then (old behaviour, or no open month). Next calculation: carried.
    expect(decide(S, P("paid"), "2026-05-20", true, pay).carries).toEqual([{ employeeId: "e", amountPaise: RS(500), toMonth: "2026-05-01" }]);
    // Once carried, calculating again carries nothing more …
    expect(decide(S, P("paid"), "2026-05-22", true, { ...pay, carried: { e: RS(500) } }).carries).toEqual([]);
    // … and a later change carries only its own part; a change back reverses what was carried.
    expect(decide(S, P("paid"), "2026-05-23", true, { ...pay, fresh: { e: RS(1_800) }, carried: { e: RS(500) } }).carries).toEqual([{ employeeId: "e", amountPaise: RS(300), toMonth: "2026-05-01" }]);
    expect(decide(S, P("paid"), "2026-05-24", true, { ...pay, fresh: { e: RS(1_000) }, carried: { e: RS(500) } }).carries).toEqual([{ employeeId: "e", amountPaise: -RS(500), toMonth: "2026-05-01" }]);
  });
  it("paid and locked months are never adopted into; the configured refusals still carry nothing", () => {
    for (const st of ["locked", "approved", "paid"] as const) expect(decide(S, P(st), "2026-05-20", true, pay).adopt).toBe(false);
    expect(decide({ ...S, "adjust.lockedOrPaidMonths": "noAdjustment" }, P("paid"), "2026-05-20", true, pay).carries).toEqual([]);
    expect(decide({ ...S, "period.lateReceipts": "reopenRequired" }, P("locked"), "2026-04-29", true, pay).carries).toEqual([]);
    expect(decide({ ...S, "adjust.windowDays": 5 }, P("paid"), "2026-05-20", true, pay).outcome).toMatch(/payout became final/);
  });
});

describe("the calculation date", () => {
  it("is on or after the month's first day and never in the future", () => {
    expect(calculationDateProblem("2026-10-01", "2026-11-19", "2026-11-21")).toBeNull();
    expect(calculationDateProblem("2026-10-01", "2026-11-21", "2026-11-21")).toBeNull(); // today
    expect(calculationDateProblem("2026-10-01", "2026-09-30", "2026-11-21")).toMatch(/on or after the month's first day/);
    expect(calculationDateProblem("2026-10-01", "2026-11-22", "2026-11-21")).toMatch(/can't be in the future: a month is calculated as of today \(2026-11-21\)/);
    expect(calculationDateProblem("2026-10-01", "2026-13-40", "2026-11-21")).toMatch(/on or after/);
    expect(calculationDateProblem("2026-10-01", "not a day", "2026-11-21")).toMatch(/on or after/);
  });
  it("is a real calendar day, strictly — never rolled over to another one", () => {
    const T = "2030-12-31"; // "today" for these cases
    expect(calculationDateProblem("2028-02-01", "2028-02-29", T)).toBeNull(); // a valid leap day
    expect(calculationDateProblem("2026-04-01", "2026-04-30", T)).toBeNull(); // a valid month end
    expect(calculationDateProblem("2026-12-01", "2026-12-31", T)).toBeNull();
    for (const bad of ["2026-02-29", "2027-02-29", "2026-02-30", "2026-04-31", "2026-13-01", "2026-00-10", "2026-06-00", "2026-6-5", "2026-06-5", "20260605", "2026/06/05", " 2026-06-05", ""])
      expect(calculationDateProblem("2026-01-01", bad, T), bad).toMatch(/on or after the month's first day/);
    // The future stays refused, exactly as before.
    expect(calculationDateProblem("2026-01-01", "2031-01-01", T)).toMatch(/can't be in the future/);
  });
});

describe("a stored calculation: its date and configuration are part of its inputs", () => {
  const EMP = "00000000-0000-4000-8000-0000000c0e01";
  const make = (asOf: string, award = RS(600)): CategoryXInput => {
    const c = completeConfig({}, [{ subjectType: "employee", subjectId: EMP, role: null, subjectLabel: "Rep", mode: "include", effectiveFrom: "2025-01-01", effectiveTo: null }], "E");
    return {
      category: "E",
      month: "2026-10-01",
      asOf,
      configVersion: { id: "00000000-0000-4000-8000-00000000a001", programId: "00000000-0000-4000-8000-00000000b001", versionNo: 1, status: "published", effectiveFrom: "2026-10-01", effectiveTo: null },
      config: { ...c, settings: { ...c.settings, "e.minAward": RS(250), "e.maxAward": RS(1_000), "caps.perEmployeeCategoryMonth": "none", "caps.perEmployeeAllCategoriesMonth": "none" } },
      roles: ["doer", "initiator", "both"],
      employees: [{ id: EMP, name: "Rep", role: "doer", departmentId: null, isActive: true }],
      meetings: [{ id: "00000000-0000-4000-8000-00000000e001", employeeId: EMP, periodMonth: "2026-10", awardedPaise: award, approved: true, label: "Meeting (high potential)" }],
    };
  };
  it("the as-of date is stored in the inputs and changes the inputs hash, never the result hash (the same result is recognised as unchanged)", () => {
    const a = make("2026-11-19");
    const b = make("2026-11-20");
    expect(inputsHashX(a)).not.toBe(inputsHashX(b));
    const ra = calculateCategoryX(a);
    const rb = calculateCategoryX(b);
    expect(ra.asOf).toBe("2026-11-19");
    expect(resultHashX(ra)).toBe(resultHashX(rb));
    // Deterministic: the same stored inputs always give the same result.
    expect(resultHashX(calculateCategoryX(structuredClone(a)))).toBe(resultHashX(ra));
  });
  it("a later draft of the configuration can't change a stored calculation: the run keeps the configuration it was calculated with", () => {
    const stored = make("2026-11-19");
    const storedHash = inputsHashX(stored);
    const storedResult = resultHashX(calculateCategoryX(stored));
    // A draft (a copy edited later) with a different award range …
    const draft = structuredClone(stored);
    draft.config!.settings["e.maxAward"] = RS(500);
    expect(calculateCategoryX(draft).employees[0]!.payablePaise).toBe(RS(500));
    // … leaves the stored inputs, their hash and their result exactly as they were.
    expect(stored.config!.settings["e.maxAward"]).toBe(RS(1_000));
    expect(inputsHashX(stored)).toBe(storedHash);
    expect(resultHashX(calculateCategoryX(stored))).toBe(storedResult);
    expect(calculateCategoryX(stored).employees[0]!.payablePaise).toBe(RS(600));
  });
});
