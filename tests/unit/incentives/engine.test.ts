import { describe, it, expect } from "vitest";
import {
  evaluate,
  decayMultiplier,
  SALES_BH_SCHEME as S,
  P,
  L,
  CR,
  type EvaluationInput,
} from "@/lib/incentives";

const base = (over: Partial<EvaluationInput> = {}): EvaluationInput => ({
  employeeId: "emp-1",
  period: "2026-07",
  ...over,
});

describe("A · marginal sales slabs", () => {
  const totalA = (salesPaise: number, decayMultiplier?: number) =>
    evaluate(base({ sales: { monthlySalesPaise: salesPaise, decayMultiplier } }), S).categoryTotals.A;

  it("pays nothing below the ₹1 Cr entry threshold", () => {
    expect(totalA(CR(0.99))).toBe(0);
    expect(totalA(CR(1.0))).toBe(0); // exactly at threshold → first band portion is 0
  });

  it("bands are marginal, not absolute", () => {
    expect(totalA(CR(1.2))).toBe(P(2000)); // only A.1 fully
    expect(totalA(CR(1.5))).toBe(P(7000)); // 2000 + 3000 + (0.20% × 10 L = 2000)
    expect(totalA(CR(1.6))).toBe(P(9000)); // 2000 + 3000 + 4000 = category cap
  });

  it("caps at ₹9,000 above ₹1.6 Cr (Q1 default)", () => {
    expect(totalA(CR(2.0))).toBe(P(9000));
    expect(totalA(CR(5.0))).toBe(P(9000));
  });

  it("per-band split is correct at ₹1.5 Cr", () => {
    const r = evaluate(base({ sales: { monthlySalesPaise: CR(1.5) } }), S);
    const byLine = Object.fromEntries(r.lines.map((l) => [l.lineCode, l.finalPaise]));
    expect(byLine["A.1"]).toBe(P(2000));
    expect(byLine["A.2"]).toBe(P(3000));
    expect(byLine["A.3"]).toBe(P(2000));
  });

  it("applies collection decay to the slab", () => {
    expect(totalA(CR(1.5), 0.5)).toBe(P(3500)); // 7000 × 0.50
    expect(totalA(CR(1.5), 0)).toBe(0);
  });

  it("writes a human explanation", () => {
    const r = evaluate(base({ sales: { monthlySalesPaise: CR(1.34) } }), S);
    const a2 = r.lines.find((l) => l.lineCode === "A.2");
    expect(a2?.explanation).toContain("SALES SLAB");
    expect(a2?.explanation).toContain("0.15%");
  });
});

describe("collection decay steps", () => {
  it("steps at 45/46, 75/76, 100/101", () => {
    expect(decayMultiplier(undefined, S.decaySteps)).toBe(1);
    expect(decayMultiplier(0, S.decaySteps)).toBe(1);
    expect(decayMultiplier(45, S.decaySteps)).toBe(1);
    expect(decayMultiplier(46, S.decaySteps)).toBe(0.5);
    expect(decayMultiplier(75, S.decaySteps)).toBe(0.5);
    expect(decayMultiplier(76, S.decaySteps)).toBe(0.25);
    expect(decayMultiplier(100, S.decaySteps)).toBe(0.25);
    expect(decayMultiplier(101, S.decaySteps)).toBe(0);
  });
});

describe("B · cross-sell", () => {
  it("1% of a first invoice above ₹1 L, capped at ₹1,500", () => {
    const r = evaluate(base({ crossSellInvoices: [{ id: "i1", invoiceValuePaise: L(2) }] }), S);
    expect(r.categoryTotals.B).toBe(P(1500)); // 1% of 2L = 2000 → capped 1500
  });
  it("ignores invoices at/below ₹1 L threshold", () => {
    const r = evaluate(base({ crossSellInvoices: [{ id: "i1", invoiceValuePaise: L(0.9) }] }), S);
    expect(r.categoryTotals.B).toBe(0);
  });
  it("decays with days past terms", () => {
    const r = evaluate(base({ crossSellInvoices: [{ id: "i1", invoiceValuePaise: L(2), daysPastTerms: 46 }] }), S);
    expect(r.categoryTotals.B).toBe(P(750)); // 1500 × 0.5
  });
});

describe("C · new customer acquisition", () => {
  const cohort = (over = {}) => ({
    id: "c1",
    first3TotalPaise: L(3),
    fyTurnoverPaise: L(3),
    transactionsDone: 3,
    fullyPaid: true,
    ...over,
  });
  it("pays 1% of first 3 transactions when eligible", () => {
    const r = evaluate(base({ newCustomerCohorts: [cohort()] }), S);
    expect(r.categoryTotals.C).toBe(P(3000));
  });
  it("caps at ₹5,000", () => {
    const r = evaluate(base({ newCustomerCohorts: [cohort({ first3TotalPaise: L(10), fyTurnoverPaise: L(10) })] }), S);
    expect(r.categoryTotals.C).toBe(P(5000));
  });
  it("requires turnover ≥ ₹2.5 L, 3 txns and full payment", () => {
    expect(evaluate(base({ newCustomerCohorts: [cohort({ fyTurnoverPaise: L(2.4) })] }), S).categoryTotals.C).toBe(0);
    expect(evaluate(base({ newCustomerCohorts: [cohort({ transactionsDone: 2 })] }), S).categoryTotals.C).toBe(0);
    expect(evaluate(base({ newCustomerCohorts: [cohort({ fullyPaid: false })] }), S).categoryTotals.C).toBe(0);
  });
});

describe("D · leads & conversions with shared category cap", () => {
  it("D.1 ₹250 per 10 profiled leads", () => {
    const r = evaluate(base({ leadBatches: [{ id: "b1", leadCount: 25, profiled: true, approved: true }] }), S);
    expect(r.categoryTotals.D).toBe(P(500)); // floor(25/10)=2 × 250
  });
  it("requires profiling and approval", () => {
    expect(evaluate(base({ leadBatches: [{ id: "b1", leadCount: 25, profiled: false, approved: true }] }), S).categoryTotals.D).toBe(0);
    expect(evaluate(base({ leadBatches: [{ id: "b1", leadCount: 25, profiled: true, approved: false }] }), S).categoryTotals.D).toBe(0);
  });
  it("D.2 ₹250 per 5 conversions", () => {
    const r = evaluate(base({ leadConversions: [{ id: "v1", convertedCount: 12, approved: true }] }), S);
    expect(r.categoryTotals.D).toBe(P(500)); // floor(12/5)=2 × 250
  });
  it("D.1 + D.2 share the ₹1,000 category cap (truncation keeps D.1 first)", () => {
    const r = evaluate(
      base({
        leadBatches: [{ id: "b1", leadCount: 30, profiled: true, approved: true }], // 750
        leadConversions: [{ id: "v1", convertedCount: 10, approved: true }], // 500 → 1250 total
      }),
      S,
    );
    expect(r.categoryTotals.D).toBe(P(1000));
    const byLine = Object.fromEntries(r.lines.map((l) => [l.lineCode, l.finalPaise]));
    expect(byLine["D.1"]).toBe(P(750));
    expect(byLine["D.2"]).toBe(P(250)); // truncated from 500 by the category cap
    expect(r.lines.find((l) => l.lineCode === "D.2")?.capNote).toContain("Category D cap");
  });
});

describe("E · discretionary meetings", () => {
  it("clamps the admin award to ₹250–₹1,000", () => {
    expect(evaluate(base({ meetings: [{ id: "m1", awardedPaise: P(1500), approved: true }] }), S).categoryTotals.E).toBe(P(1000));
    expect(evaluate(base({ meetings: [{ id: "m1", awardedPaise: P(100), approved: true }] }), S).categoryTotals.E).toBe(P(250));
  });
  it("category cap ₹1,000 across meetings", () => {
    const r = evaluate(base({ meetings: [
      { id: "m1", awardedPaise: P(1000), approved: true },
      { id: "m2", awardedPaise: P(1000), approved: true },
    ] }), S);
    expect(r.categoryTotals.E).toBe(P(1000));
  });
});

describe("F · testimonials + appreciation doubling", () => {
  const g = (over = {}) => ({ id: "t1", kind: "google_review" as const, wordCount: 60, starRating: 5, hasScreenshot: true, namesTeamMember: false, approved: true, ...over });
  it("Google review ₹100 (5★, ≥50 words, screenshot)", () => {
    expect(evaluate(base({ testimonials: [g()] }), S).categoryTotals.F).toBe(P(100));
  });
  it("rejects non-5★, short, or screenshot-less reviews", () => {
    expect(evaluate(base({ testimonials: [g({ starRating: 4 })] }), S).categoryTotals.F).toBe(0);
    expect(evaluate(base({ testimonials: [g({ wordCount: 40 })] }), S).categoryTotals.F).toBe(0);
    expect(evaluate(base({ testimonials: [g({ hasScreenshot: false })] }), S).categoryTotals.F).toBe(0);
  });
  it("email ₹100, letterhead ₹150", () => {
    expect(evaluate(base({ testimonials: [{ id: "t", kind: "email", wordCount: 10, namesTeamMember: false, approved: true }] }), S).categoryTotals.F).toBe(P(100));
    expect(evaluate(base({ testimonials: [{ id: "t", kind: "letterhead", wordCount: 10, namesTeamMember: false, approved: true }] }), S).categoryTotals.F).toBe(P(150));
  });
  it("F.4 doubles when the text names a team member", () => {
    expect(evaluate(base({ testimonials: [{ id: "t", kind: "letterhead", wordCount: 10, namesTeamMember: true, approved: true }] }), S).categoryTotals.F).toBe(P(300));
  });
  it("category cap ₹750", () => {
    const many = Array.from({ length: 6 }, (_, i) => g({ id: `t${i}`, namesTeamMember: true })); // 6 × 200 = 1200
    expect(evaluate(base({ testimonials: many }), S).categoryTotals.F).toBe(P(750));
  });
});

describe("idempotency & golden month", () => {
  const goldenInput = base({
    sales: { monthlySalesPaise: CR(1.6) },                                              // A → 9000
    crossSellInvoices: [{ id: "i1", invoiceValuePaise: L(2) }],                          // B → 1500
    newCustomerCohorts: [{ id: "c1", first3TotalPaise: L(10), fyTurnoverPaise: L(10), transactionsDone: 3, fullyPaid: true }], // C → 5000
    leadBatches: [{ id: "b1", leadCount: 30, profiled: true, approved: true }],          // D.1 750
    leadConversions: [{ id: "v1", convertedCount: 10, approved: true }],                 // D.2 500 → D cap 1000
    meetings: [{ id: "m1", awardedPaise: P(1000), approved: true }],                     // E → 1000
    testimonials: [
      { id: "t1", kind: "letterhead", wordCount: 10, namesTeamMember: true, approved: true }, // 300
      { id: "t2", kind: "email", wordCount: 10, namesTeamMember: true, approved: true },       // 200
      { id: "t3", kind: "google_review", wordCount: 60, starRating: 5, hasScreenshot: true, namesTeamMember: true, approved: true }, // 200
    ], // F raw 700 ≤ 750
  });

  it("reproduces the full scheme total (all category caps → ₹18,250)", () => {
    const r = evaluate(goldenInput, S);
    expect(r.categoryTotals).toMatchObject({
      A: P(9000), B: P(1500), C: P(5000), D: P(1000), E: P(1000), F: P(700),
    });
    expect(r.totalFinalPaise).toBe(P(18200));
  });

  it("is idempotent — running twice yields identical results", () => {
    expect(evaluate(goldenInput, S)).toEqual(evaluate(goldenInput, S));
  });
});
