import { describe, expect, it } from "vitest";
import { calculateCategoryA } from "@/lib/incentives/category-a/engine";
import type { CategoryAInput } from "@/lib/incentives/category-a/types";
import type { OtherCategoryAmount } from "@/lib/incentives/shared/all-categories";
import { aprilInput, EMP, invoiceId, L, orderId, receiptId, type Pay } from "../fixtures/category-a";

// Category A behaviour, test by test (the Category A audit's inventory numbers in each name). Explicit figures — not
// golden snapshots — so a wrong change fails here with the figure that moved. PURE engine; the settings are TEST values.

const ON_TIME: Pay[][] = Array(12).fill([[1, 5]]);
const set = (i: CategoryAInput, s: Record<string, unknown>): CategoryAInput => ({ ...i, config: { ...i.config!, settings: { ...i.config!.settings, ...(s as Record<string, string | number | string[]>) } } });
const run = (i: CategoryAInput) => {
  const r = calculateCategoryA(i);
  expect(r.status, r.problems.join("\n")).toBe("computed");
  return r;
};
const emp = (i: CategoryAInput) => run(i).employees.find((e) => e.employeeId === EMP);

describe("Test 2 · invoice basis: an invoice in another month, and a partly invoiced order", () => {
  const invoiceBasis = (i: CategoryAInput) => set(i, { "basis.document": "invoice", "basis.monthDate": "invoiceDate" });
  it("an order of April invoiced on 3 May counts in May on the invoice basis, not in April", () => {
    const i = invoiceBasis(aprilInput(ON_TIME));
    i.invoices = i.invoices.map((v, k) => (k === 0 ? { ...v, date: "2026-05-03", dueDate: "2026-05-03" } : v));
    i.receipts = i.receipts.map((x) => (x.id === receiptId(1, 1) ? { ...x, date: "2026-05-08" } : x));
    expect(emp(i)!.salesPaise).toBe(L(110));
    const may = run({ ...i, month: "2026-05-01" });
    expect(may.employees[0]!.salesPaise).toBe(L(10)); // below the threshold: counted, doesn't qualify
    expect(may.employees[0]!.qualified).toBe(false);
    expect(may.units.map((u) => u.unitId)).toEqual([invoiceId(1)]);
  });
  it("…while on the Sales Order basis (order date) it stays in April", () => {
    const i = set(aprilInput(ON_TIME), { "basis.document": "salesOrder", "basis.monthDate": "orderDate" });
    i.invoices = i.invoices.map((v, k) => (k === 0 ? { ...v, date: "2026-05-03", dueDate: "2026-05-03" } : v));
    expect(emp(i)!.salesPaise).toBe(L(120));
  });
  it("a ₹10 L order invoiced ₹6 L and paid ₹6 L: the invoice basis counts and pays ₹6 L; the order basis counts ₹10 L and waits", () => {
    const partly = (i: CategoryAInput) => {
      i.invoices = i.invoices.map((v, k) => (k === 0 ? { ...v, totalPaise: L(6), taxablePaise: L(6), itemsPaise: L(6) } : v));
      i.receipts = i.receipts.map((x) => (x.id === receiptId(1, 1) ? { ...x, amountPaise: L(6) } : x));
      return i;
    };
    const inv = run(partly(invoiceBasis(aprilInput(ON_TIME))));
    expect(inv.employees[0]!.salesPaise).toBe(L(116));
    const u1 = inv.units.find((u) => u.unitId === invoiceId(1))!;
    expect([u1.collectiblePaise, u1.collectedPaise, u1.fullyCollected]).toEqual([L(6), L(6), true]);
    const so = run(partly(set(aprilInput(ON_TIME), {})));
    expect(so.employees[0]!.salesPaise).toBe(L(120));
    const o1 = so.units.find((u) => u.unitId === orderId(1))!;
    // The order still asks for its full ₹10 L (no pre-closure): not fully collected, so it isn't payable yet.
    expect([o1.collectiblePaise, o1.collectedPaise, o1.fullyCollected, o1.payableExact]).toEqual([L(10), L(6), false, "0"]);
    expect(so.employees[0]!.pendingPaise).toBeGreaterThan(0);
  });
});

describe("Test 6 · \"Orders that earn Category B\" set explicitly", () => {
  const withB = (choice: string | undefined, ids: string[] | undefined) => {
    const i = aprilInput(ON_TIME);
    if (choice) i.config!.settings["basis.categoryBOrders"] = choice;
    return run({ ...i, ...(ids ? { categoryBOrderIds: ids } : {}) });
  };
  it("include: an order that earns Category B still counts in Category A", () => {
    expect(withB("include", [orderId(1)]).employees[0]!.salesPaise).toBe(L(120));
  });
  it("exclude: it is left out of Category A sales, with the reason, and takes no share", () => {
    const r = withB("exclude", [orderId(1), orderId(2)]);
    expect(r.employees[0]!.salesPaise).toBe(L(100));
    expect(r.excluded.filter((x) => /earns Category B/.test(x.message)).map((x) => x.documentId)).toEqual([orderId(1), orderId(2)]);
    expect(r.units.some((u) => u.unitId === orderId(1))).toBe(false);
  });
  it("not set: counts (as \"include\")", () => {
    expect(withB(undefined, undefined).employees[0]!.salesPaise).toBe(L(120));
  });
});

describe("Test 8 · flat above the threshold: the reached slab's rate on the sales above the threshold", () => {
  // One order of the given value; slab limits removed so every figure shows.
  const at = (paise: number, method: string) => {
    const i = set(aprilInput([[[1, 5]]]), { "slabs.method": method, "caps.perEmployeeCategoryMonth": "none", "caps.perEmployeeAllCategoriesMonth": "none" });
    i.config!.slabs = i.config!.slabs.map((s) => ({ ...s, capPaise: null }));
    i.orders = [{ ...i.orders[0]!, totalPaise: paise }];
    i.invoices = [{ ...i.invoices[0]!, totalPaise: paise }];
    i.receipts = [{ ...i.receipts[0]!, amountPaise: paise }];
    return run(i).employees[0]!;
  };
  it("₹1.3 Cr: 0.15% (slab A.2) of the ₹30 L above ₹1 Cr = ₹4,500 — not 0.15% of all ₹1.3 Cr (flat: ₹19,500), not marginal (₹3,500)", () => {
    const e = at(L(130), "flatAboveThreshold");
    expect(e.pool).toBe("450000");
    expect(e.slabLines.map((l) => l.lineCode)).toEqual(["A.2"]);
    expect(at(L(130), "flat").pool).toBe("1950000");
    expect(at(L(130), "marginal").pool).toBe("350000");
  });
  it("₹1.15 Cr: 0.10% (A.1) of ₹15 L = ₹1,500; exactly ₹1 Cr: qualifies and earns ₹0 (nothing above the threshold)", () => {
    expect(at(L(115), "flatAboveThreshold").pool).toBe("150000");
    const edge = at(L(100), "flatAboveThreshold");
    expect([edge.qualified, edge.pool, edge.earnedPaise]).toEqual([true, "0", 0]);
  });
  it("with the slab's own limit: ₹4,500 is limited to A.2's ₹3,000", () => {
    const i = set(aprilInput([[[1, 5]]]), { "slabs.method": "flatAboveThreshold" });
    i.orders = [{ ...i.orders[0]!, totalPaise: L(130) }];
    i.invoices = [{ ...i.invoices[0]!, totalPaise: L(130) }];
    i.receipts = [{ ...i.receipts[0]!, amountPaise: L(130) }];
    const e = run(i).employees[0]!;
    expect(e.pool).toBe("300000");
    expect(e.slabLines[0]!.note).toMatch(/limited to ₹3,000/);
  });
});

describe("Test 20 · whole order, weighted by its receipts", () => {
  // Order 1 paid half at 10 days (100%) and half at 60 days (50%); the other 11 paid on time. ₹2,000 / 12 per order.
  const PART: Pay[][] = [[[0.5, 10], [0.5, 60]], ...Array(11).fill([[1, 5]])];
  const order1 = (pays: Pay[][], basis: string, payable = "orderFullyCollected") => {
    const r = run(set(aprilInput(pays), { "collection.earningBasis": basis, "collection.payableWhen": payable }));
    return r.units.find((u) => u.unitId === orderId(1))!;
  };
  it("a fully collected order earns exactly what each receipt earns at its own delay (₹166.67 × 0.75 = ₹125)", () => {
    expect(order1(PART, "wholeOrderWeighted").earnedExact).toBe(order1(PART, "perReceipt").earnedExact);
    expect(order1(PART, "wholeOrderWeighted").earnedExact).toBe("12500");
  });
  it("a partly collected order earns NOTHING until it is complete (per receipt it earns its first half already)", () => {
    const HALF: Pay[][] = [[[0.5, 10]], ...Array(11).fill([[1, 5]])];
    expect(order1(HALF, "perReceipt", "asReceived").earnedExact).toBe("25000/3"); // ₹83.33…
    const w = order1(HALF, "wholeOrderWeighted", "asReceived");
    expect([w.earnedExact, w.payableExact]).toEqual(["0", "0"]);
    const r = run(set(aprilInput(HALF), { "collection.earningBasis": "wholeOrderWeighted", "collection.payableWhen": "asReceived" }));
    expect(r.pieces.find((p) => p.receiptId === receiptId(1, 1))!.note).toMatch(/Earned only once the order is fully collected/);
  });
  it("the latest payment's delay (\"whole order at its latest payment\") differs: everything at 50% = ₹83.33", () => {
    expect(order1(PART, "wholeOrderWorstReceipt").earnedExact).toBe("25000/3");
  });
});

describe("Test 46 · the all-categories limit shared with other categories: in proportion, or in order", () => {
  // Category A earns ₹2,000 this month; Category B (another category's adopted month) ₹17,000; the limit ₹18,250.
  const shared = (policy: "proportional" | "categoryOrder", order: string[], others: OtherCategoryAmount[], capPaise: number | null = 18_250_00) =>
    run({ ...aprilInput(ON_TIME), allCategories: { capPaise, policy, order, others: { [EMP]: others } } }).employees[0]!;
  const B = (fixed: boolean): OtherCategoryAmount => ({ category: "B", prePaise: 17_000_00, finalPaise: 17_000_00, fixed });
  it("under the limit: nothing changes", () => {
    const e = shared("proportional", [], [{ category: "B", prePaise: 1_000_00, finalPaise: 1_000_00, fixed: false }]);
    expect([e.beforeAllCategoriesPaise, e.earnedPaise, e.limits]).toEqual([2_000_00, 2_000_00, []]);
  });
  it("in proportion: A keeps ₹18,250 × 2,000 / 19,000 = ₹1,921.05 (rounded down to the paisa; the paisa left goes to B's larger remainder)", () => {
    const e = shared("proportional", [], [B(false)]);
    expect(e.earnedPaise).toBe(1_921_05);
    expect(e.payablePaise).toBe(1_921_05);
    expect(e.limits.join(" ")).toMatch(/shared in proportion to each category's amount — ₹1,921.05 for Category A/);
  });
  it("in order B then A: A gets what B leaves (₹1,250); A then B: A keeps its ₹2,000", () => {
    expect(shared("categoryOrder", ["B", "A"], [B(false)]).earnedPaise).toBe(1_250_00);
    expect(shared("categoryOrder", ["A", "B"], [B(false)]).earnedPaise).toBe(2_000_00);
  });
  it("a fixed (locked, approved or paid) category keeps its figure; A shares what is left (₹1,250), whatever the policy", () => {
    expect(shared("proportional", [], [B(true)]).earnedPaise).toBe(1_250_00);
    expect(shared("categoryOrder", ["A", "B"], [B(true)]).earnedPaise).toBe(1_250_00);
  });
  it("another programme's month and the old engine's categories count as fixed figures too", () => {
    const e = shared("proportional", [], [{ category: "A · P2", prePaise: 9_000_00, finalPaise: 9_000_00, fixed: true }, { category: "C (old engine)", prePaise: 8_500_00, finalPaise: 8_500_00, fixed: true }]);
    expect(e.earnedPaise).toBe(750_00);
  });
  it("\"No limit\": nothing is limited", () => {
    expect(shared("proportional", [], [B(false)], null).earnedPaise).toBe(2_000_00);
  });
});
