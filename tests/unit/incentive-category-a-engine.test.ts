import { describe, expect, it } from "vitest";
import { calculateCategoryA } from "@/lib/incentives/category-a/engine";
import { inputsHash, normalizeInput, resultHash } from "@/lib/incentives/category-a/hash";
import { decide, negativeBalance } from "@/lib/incentives/category-a/settle";
import * as R from "@/lib/incentives/category-a/rational";
import type { CategoryAInput } from "@/lib/incentives/category-a/types";
import { aprilInput, CUST, EMP, EMP2, EXAMPLE_1, EXAMPLE_2, invoiceId, L, orderId, receiptId, type Pay } from "../fixtures/category-a";

// The Category A engine is PURE: these tests feed it plain data shaped like Forms' documents and a published
// configuration, and check every figure. The settings are test values, not business decisions.

const run = (payments: Pay[][], settings: Record<string, unknown> = {}, over: Partial<CategoryAInput> = {}) => calculateCategoryA(aprilInput(payments, over, settings as never));
const only = (r: ReturnType<typeof run>) => {
  expect(r.status, r.problems.join("\n")).toBe("computed");
  expect(r.employees).toHaveLength(1);
  return r.employees[0]!;
};

describe("April regression references", () => {
  it("example 1 — whole payments at four delays: ₹1,083.33", () => {
    const e = only(run(EXAMPLE_1));
    expect(e.salesPaise).toBe(L(120));
    expect(e.qualified).toBe(true);
    expect(e.pool).toBe("200000"); // 0.10% of ₹20 L above ₹1 Cr
    expect(e.earnedPaise).toBe(1_083_33);
    expect(e.payablePaise).toBe(1_083_33);
  });
  it("example 2 — partial receipts, each at its own delay: ₹925.00", () => {
    const e = only(run(EXAMPLE_2));
    expect(e.earnedPaise).toBe(925_00);
    expect(e.earnedExact).toBe("92500");
  });
  it("other settings give the figures the specification predicted (and none of them are the defaults)", () => {
    expect(only(run(EXAMPLE_2, { "collection.earningBasis": "wholeOrderWorstReceipt" })).earnedPaise).toBe(708_33);
    expect(only(run(EXAMPLE_2, { "rounding.level": "perReceipt" })).earnedPaise).toBe(924_99);
    expect(only(run(EXAMPLE_1, { "rounding.level": "perOrder" })).earnedPaise).toBe(1_083_34);
  });
  it("equal and proportional sharing agree when every order is the same value", () => {
    expect(only(run(EXAMPLE_2, { "allocation.method": "proportionalToValue" })).earnedPaise).toBe(925_00);
  });
});

describe("receipts", () => {
  it("each partial receipt is credited at its own date, delay and step", () => {
    const r = run(EXAMPLE_2);
    const so2 = r.pieces.filter((p) => p.unitId === orderId(2) && p.status === "credited");
    expect(so2.map((p) => [p.amountPaise, p.delayDays, p.multiplierPpm])).toEqual([
      [L(2.5), 10, 1_000_000],
      [L(2.5), 60, 500_000],
      [L(5), 90, 250_000],
    ]);
    expect(so2.map((p) => p.earnedExact)).toEqual(["50000/12", "25000/12", "25000/12"].map((x) => R.text(R.fromText(x))));
  });
  it("a single full payment on time earns the order's whole share", () => {
    const r = run([[[1, 5]], ...Array(11).fill([[1, 5]])]);
    expect(only(r).earnedPaise).toBe(2_000_00);
    expect(r.units.every((u) => u.fullyCollected)).toBe(true);
  });
  it("payable only once the order is fully collected; the rest is pending, and what is unpaid is shown apart", () => {
    const pays: Pay[][] = [[[0.5, 10]], ...Array(11).fill([[1, 10]])];
    const e = only(run(pays));
    expect(e.earnedPaise).toBe(Math.round((11.5 / 12) * 2_000_00));
    expect(e.payablePaise).toBe(Math.round((11 / 12) * 2_000_00));
    expect(e.pendingPaise).toBe(e.earnedPaise - e.payablePaise);
    expect(e.projectedPaise).toBe(Math.round((0.5 / 12) * 2_000_00)); // pending until received, at full rate
    const asReceived = only(run(pays, { "collection.payableWhen": "asReceived" }));
    expect(asReceived.payablePaise).toBe(asReceived.earnedPaise);
  });
  it("the step boundary setting decides a payment exactly on a step's last day", () => {
    const pays: Pay[][] = Array(12).fill([[1, 45]]);
    expect(only(run(pays, { "collection.stepBoundary": "upperInclusive" })).earnedPaise).toBe(2_000_00);
    expect(only(run(pays, { "collection.stepBoundary": "upperExclusive" })).earnedPaise).toBe(1_000_00);
  });
  it("a receipt beyond what the order owes is never credited twice", () => {
    const r = run([[[1, 5], [0.5, 6]], ...Array(11).fill([[1, 5]])]);
    expect(only(r).earnedPaise).toBe(2_000_00);
    const so1 = r.pieces.filter((p) => p.unitId === orderId(1));
    expect(so1.find((p) => p.status === "over-collected")?.amountPaise).toBe(L(5));
    const credited = r.pieces.filter((p) => p.status === "credited").map((p) => `${p.receiptId}|${p.invoiceId}|${p.employeeId}`);
    expect(new Set(credited).size).toBe(credited.length);
  });
  it("no recovery after nil keeps later payments at nil", () => {
    // SO 3 of example 2 paid 0.8 on time and 0.2 after 120 days: reversing the order of delays shows the rule.
    const pays: Pay[][] = [[[0.2, 120], [0.8, 130]], ...Array(11).fill([[1, 5]])];
    expect(only(run(pays, { "collection.recoveryAfterNil": "noRecovery" })).earnedPaise).toBe(Math.round((11 / 12) * 2_000_00));
  });
  it("an on-account receipt is ignored, held, or applied to the oldest open invoice, as configured", () => {
    const base = aprilInput(Array(12).fill([[1, 5]]));
    const input = { ...base, receipts: base.receipts.map((r) => (r.id === receiptId(1, 1) ? { ...r, invoiceId: null } : r)) };
    const ignored = calculateCategoryA(input);
    expect(only(ignored).payablePaise).toBe(Math.round((11 / 12) * 2_000_00));
    expect(ignored.pieces.find((p) => p.receiptId === receiptId(1, 1))?.status).toBe("excluded");
    const held = calculateCategoryA({ ...input, config: { ...input.config!, settings: { ...input.config!.settings, "collection.onAccountReceipts": "manualAllocationRequired" } } });
    expect(held.held.map((h) => h.documentId)).toContain(receiptId(1, 1));
    const fifo = calculateCategoryA({ ...input, config: { ...input.config!, settings: { ...input.config!.settings, "collection.onAccountReceipts": "allocateOldestInvoiceFirst" } } });
    expect(only(fifo).payablePaise).toBe(2_000_00);
  });
  it("missing due dates follow the configured fallback, then the configured treatment", () => {
    const base = aprilInput(Array(12).fill([[1, 50]]));
    const noDue = { ...base, invoices: base.invoices.map((i) => ({ ...i, dueDate: null })) };
    const set = (s: Record<string, unknown>) => ({ ...noDue, config: { ...noDue.config!, settings: { ...noDue.config!.settings, ...s } } }) as CategoryAInput;
    expect(only(calculateCategoryA(set({ "collection.missingDueDate": "treatAsOnTime" }))).earnedPaise).toBe(2_000_00);
    expect(only(calculateCategoryA(set({ "collection.missingDueDate": "excludeReceipt" }))).earnedPaise).toBe(0);
    // Customer terms of 30 days: paid 50 days after the invoice = 20 days late = full rate.
    expect(only(calculateCategoryA(set({ "collection.dueDateFallback": ["invoiceDueDate", "customerTerms"] }))).earnedPaise).toBe(2_000_00);
  });
});

describe("sharing, thresholds and slabs", () => {
  const twoSizes = (): CategoryAInput => {
    const i = aprilInput(Array(12).fill([[1, 5]]));
    // Order 1 is ₹20 L and paid after 110 days (nil); the rest ₹10 L and on time; sales ₹1.3 Cr.
    i.orders[0] = { ...i.orders[0]!, totalPaise: L(20), taxablePaise: L(20), itemsPaise: L(20) };
    i.invoices[0] = { ...i.invoices[0]!, totalPaise: L(20), taxablePaise: L(20), itemsPaise: L(20) };
    i.receipts[0] = { ...i.receipts[0]!, amountPaise: L(20), date: "2026-07-24" };
    return i;
  };
  it("equal and proportional sharing differ when orders differ in value", () => {
    const i = twoSizes();
    // Pool at ₹1.3 Cr: ₹2,000 (A.1) + 0.15% × ₹10 L (A.2) = ₹3,500.
    const eq = only(calculateCategoryA(i));
    expect(eq.pool).toBe("350000");
    expect(eq.earnedPaise).toBe(Math.round((11 / 12) * 3_500_00));
    const prop = only(calculateCategoryA({ ...i, config: { ...i.config!, settings: { ...i.config!.settings, "allocation.method": "proportionalToValue" } } }));
    expect(prop.earnedPaise).toBe(Math.round((11 / 13) * 3_500_00));
  });
  it("orders below the minimum take no share", () => {
    const i = twoSizes();
    const e = only(calculateCategoryA({ ...i, config: { ...i.config!, settings: { ...i.config!.settings, "allocation.eligibleOrders": "onlyOrdersAboveMin", "allocation.minOrderAmount": L(15) } } }));
    expect(e.ordersSharing).toBe(1);
    expect(e.earnedPaise).toBe(0); // the only sharing order earned nil
  });
  it("sales exactly at the threshold qualify or not, as configured", () => {
    const pays: Pay[][] = Array(10).fill([[1, 5]]);
    const flat = { "slabs.method": "flat", "slabs.aboveTop": "continueTopRate" };
    expect(only(run(pays, { ...flat, "eligibility.thresholdComparison": "atLeast", "eligibility.threshold": L(100) })).qualified).toBe(true);
    expect(only(run(pays, { ...flat, "eligibility.thresholdComparison": "above", "eligibility.threshold": L(100) })).qualified).toBe(false);
  });
  it("sales exactly on a slab edge belong to the slab the configuration says (flat slabs)", () => {
    const pays: Pay[][] = Array(12).fill([[1, 5]]);
    // ₹1.2 Cr exactly: starting slab A.2 (0.15% of all sales = ₹18,000, limited to ₹3,000) or ending slab A.1 (0.10% = ₹12,000, limited to ₹2,000).
    expect(only(run(pays, { "slabs.method": "flat", "slabs.boundaries": "lowerInclusive" })).pool).toBe("300000");
    expect(only(run(pays, { "slabs.method": "flat", "slabs.boundaries": "upperInclusive" })).pool).toBe("200000");
  });
  it("the category's monthly limit applies after rounding", () => {
    const e = only(run(EXAMPLE_2, { "caps.perEmployeeCategoryMonth": 500_00 }));
    expect(e.earnedPaise).toBe(500_00);
    expect(e.limits.join(" ")).toMatch(/Category A/);
  });
});

describe("refunds and adjustments", () => {
  it("a refund reverses what the refunded part earned", () => {
    const i = aprilInput(Array(12).fill([[1, 5]]));
    i.events = [{ id: "ev1", kind: "refund", documentId: receiptId(1, 1), invoiceId: null, amountPaise: L(5), date: "2026-04-20" }];
    expect(only(calculateCategoryA(i)).earnedPaise).toBe(Math.round((11.5 / 12) * 2_000_00));
  });
  it("a bounced cheque earns nothing", () => {
    const i = aprilInput(Array(12).fill([[1, 5]]));
    i.events = [{ id: "ev1", kind: "bounced", documentId: receiptId(2, 1), invoiceId: null, amountPaise: null, date: "2026-04-20" }];
    const r = calculateCategoryA(i);
    expect(only(r).earnedPaise).toBe(Math.round((11 / 12) * 2_000_00));
    expect(r.pieces.find((p) => p.receiptId === receiptId(2, 1))?.status).toBe("reversed");
  });
  it("a credit note can take the month below the threshold, or only reduce what must be collected", () => {
    const i = aprilInput(Array(12).fill([[1, 5]]));
    i.creditNotes = [{ id: "cn1", no: "CN 1", date: "2026-05-02", customerId: CUST, invoiceId: invoiceId(1), totalPaise: L(25), taxablePaise: L(25), itemsPaise: L(25) }];
    i.orders[0] = { ...i.orders[0]!, totalPaise: L(10) };
    const set = (v: string) => ({ ...i, config: { ...i.config!, settings: { ...i.config!.settings, "adjust.creditNote": v } } });
    // ₹1.2 Cr − ₹25 L... capped at the order: sales ₹1.1 Cr, still above ₹1 Cr: pool 0.10% × ₹10 L = ₹1,000.
    const original = only(calculateCategoryA(set("reduceOriginalMonthSales")));
    expect(original.salesPaise).toBe(L(110));
    expect(original.pool).toBe("100000");
    const collectionOnly = only(calculateCategoryA(set("reduceOrderCollectionOnly")));
    expect(collectionOnly.salesPaise).toBe(L(120));
  });
  it("a credit note issued in a later month reduces that month's sales when configured so", () => {
    const i = aprilInput(Array(12).fill([[1, 5]]), { month: "2026-05-01" }, { "adjust.creditNote": "reduceInIssueMonth" });
    i.creditNotes = [{ id: "cn1", no: "CN 1", date: "2026-05-02", customerId: CUST, invoiceId: invoiceId(1), totalPaise: L(1), taxablePaise: L(1), itemsPaise: L(1) }];
    const r = calculateCategoryA(i);
    expect(r.status).toBe("computed");
    expect(r.employees[0]!.salesPaise).toBe(-L(1));
    expect(r.employees[0]!.qualified).toBe(false);
  });
});

describe("configuration gates", () => {
  it("no configuration, or one that isn't published, blocks with the reason", () => {
    expect(run(EXAMPLE_1, {}, { config: null, configVersion: null }).problems.join(" ")).toMatch(/No published Category A/);
    const draft = run(EXAMPLE_1, {}, { configVersion: { id: "v", programId: "p", versionNo: 3, status: "approved", effectiveFrom: "2026-04-01", effectiveTo: null } });
    expect(draft.status).toBe("blocked");
    expect(draft.problems.join(" ")).toMatch(/version 3 is approved, not published/);
  });
  it("a missing or invalid setting blocks and names it", () => {
    const i = aprilInput(EXAMPLE_1);
    const { ["allocation.method"]: _gone, ...rest } = i.config!.settings;
    const r = calculateCategoryA({ ...i, config: { ...i.config!, settings: rest } });
    expect(r.status).toBe("blocked");
    expect(r.problems.join(" ")).toMatch(/How the month's incentive is shared between orders/);
    expect(r.employees).toEqual([]);
    const bad = calculateCategoryA({ ...i, config: { ...i.config!, settings: { ...i.config!.settings, "rounding.method": "banker" } } });
    expect(bad.problems.join(" ")).toMatch(/Rounding method/);
  });
  it("a version that ends before the month does is not used (effective dates)", () => {
    const r = run(EXAMPLE_1, {}, { configVersion: { id: "v", programId: "p", versionNo: 1, status: "published", effectiveFrom: "2026-01-01", effectiveTo: "2026-03-31" } });
    expect(r.status).toBe("blocked");
  });
});

describe("salespeople", () => {
  it("someone not included in Salesperson Eligibility earns nothing, with the reason", () => {
    const r = run(EXAMPLE_1, {}, { customers: [{ id: CUST, name: "Customer One", salesRepId: EMP2, creditPeriodDays: null }] });
    expect(r.employees).toEqual([]);
    expect(r.excluded[0]!.message).toMatch(/isn't included/);
  });
  it("shared credit splits sales and each share earns its part", () => {
    const i = aprilInput(EXAMPLE_1, {}, { "attribution.source": "attributionRecord", "attribution.split": "splitByShares" });
    i.config!.eligibility.push({ subjectType: "employee", subjectId: EMP2, role: null, subjectLabel: "Second", mode: "include", effectiveFrom: "2026-01-01", effectiveTo: null });
    i.attributions = i.orders.flatMap((o) => [{ documentId: o.id, employeeId: EMP, sharePpm: 600_000 }, { documentId: o.id, employeeId: EMP2, sharePpm: 400_000 }]);
    const r = calculateCategoryA(i);
    expect(r.employees.map((e) => e.salesPaise).sort((a, b) => a - b)).toEqual([L(48), L(72)]);
    expect(r.employees.every((e) => !e.qualified)).toBe(true);
  });
});

describe("reproducible and auditable", () => {
  it("the same data in any order gives the same result and the same hashes", () => {
    const a = aprilInput(EXAMPLE_2);
    const b: CategoryAInput = { ...a, orders: [...a.orders].reverse(), invoices: [...a.invoices].reverse(), receipts: [...a.receipts].reverse() };
    expect(inputsHash(a)).toBe(inputsHash(b));
    const ra = calculateCategoryA(a), rb = calculateCategoryA(b);
    expect(rb).toEqual(ra);
    expect(resultHash(ra)).toBe(resultHash(rb));
    expect(calculateCategoryA(normalizeInput(a))).toEqual(ra);
  });
  it("the result names the configuration version and every setting it read", () => {
    const r = run(EXAMPLE_1);
    expect(r.configVersionId).toBe(aprilInput(EXAMPLE_1).configVersion!.id);
    expect(r.engineVersion).toBe("category-a/2");
    expect(r.settingsUsed["rounding.level"]).toBe("employeeMonthTotal");
    expect(r.employees[0]!.explanation.join(" ")).toMatch(/threshold/);
  });
  it("receipts after the calculation day are not seen", () => {
    expect(only(run(EXAMPLE_2, {}, { asOf: "2026-04-30" })).earnedPaise).toBe(Math.round(((0.5 + 0.25 + 0.8) / 12) * 2_000_00));
  });
});

describe("rounding", () => {
  it("rounds exactly at the configured method and precision", () => {
    expect(R.round(R.q(250, 1), "halfUp", "rupee")).toBe(300);
    expect(R.round(R.q(250, 1), "halfEven", "rupee")).toBe(200);
    expect(R.round(R.q(350, 1), "halfEven", "rupee")).toBe(400);
    expect(R.round(R.q(1, 3), "up", "paise")).toBe(1);
    expect(R.round(R.q(2, 3), "down", "paise")).toBe(0);
    expect(R.round(R.q(1499, 1), "halfUp", "tenRupees")).toBe(1000);
  });
});

describe("months: adoption, protection and carrying", () => {
  const S = { "period.lockMode": "manual", "period.recalcUntil": "untilLocked", "adjust.openMonths": "recalculate", "adjust.lockedOrPaidMonths": "adjustInCurrentMonth", "period.lateReceipts": "adjustInCurrentOpenMonth", "adjust.windowDays": 30 };
  const P = (status: "open" | "locked" | "approved" | "paid", over = {}) => ({ month: "2026-04-01", status, hasCurrentRun: true, currentRunSettled: false, paidAt: status === "paid" ? "2026-05-10T00:00:00Z" : null, ...over });
  const pay = { adopted: { e: 1000 }, fresh: { e: 1500 }, carried: {} };
  it("an open month adopts; a frozen one keeps its last calculation", () => {
    expect(decide(S, P("open"), "2026-05-05", true, pay).adopt).toBe(true);
    expect(decide({ ...S, "adjust.openMonths": "freezeAtLastCompute" }, P("open"), "2026-05-05", true, pay).adopt).toBe(false);
    expect(decide({ ...S, "adjust.openMonths": "freezeAtLastCompute" }, P("open", { hasCurrentRun: false }), "2026-05-05", true, pay).adopt).toBe(true);
    expect(decide({ ...S, "period.recalcUntil": "fixedDaysAfterMonthEnd", "period.recalcDays": 10 }, P("open"), "2026-05-11", true, pay).adopt).toBe(false);
  });
  it("a paid month is never adopted into; the difference is carried once into the open month", () => {
    const d = decide(S, P("paid"), "2026-05-20", true, pay);
    expect(d.adopt).toBe(false);
    expect(d.carries).toEqual([{ employeeId: "e", amountPaise: 500, toMonth: "2026-05-01" }]);
    // Already carried: nothing more.
    expect(decide(S, P("paid"), "2026-05-21", true, { ...pay, carried: { e: 500 } }).carries).toEqual([]);
  });
  it("no adjustment, a payout past its window, or a locked month that must be reopened carry nothing", () => {
    expect(decide({ ...S, "adjust.lockedOrPaidMonths": "noAdjustment" }, P("paid"), "2026-05-20", true, pay).carries).toEqual([]);
    expect(decide(S, P("paid"), "2026-06-20", true, pay).outcome).toMatch(/final/);
    expect(decide({ ...S, "period.lateReceipts": "reopenRequired" }, P("locked"), "2026-05-20", true, pay).outcome).toMatch(/reopen/);
  });
  it("a month past its automatic lock date locks first", () => {
    const d = decide({ ...S, "period.lockMode": "autoAfterDays", "period.autoLockDays": 5 }, P("open"), "2026-05-06", true, pay);
    expect(d.lockFirst).toBe(true);
    expect(d.adopt).toBe(false);
  });
  it("a blocked calculation is never adopted", () => {
    expect(decide(S, P("open", { hasCurrentRun: false }), "2026-05-05", false, pay).adopt).toBe(false);
  });
  it("negative balances: recovered next month, carried for N months then written off, written off, or recovered from salary", () => {
    expect(negativeBalance({ "adjust.negativeBalance": "recoverFromNextPayout" }, "2026-04-01", -100, null)).toMatchObject({ kind: "negative-carry", amountPaise: -100, toMonth: "2026-05-01" });
    expect(negativeBalance({ "adjust.negativeBalance": "carryForwardMonths", "adjust.carryForwardMonths": 2 }, "2026-04-01", -100, null)).toMatchObject({ kind: "negative-carry", monthsLeft: 1 });
    expect(negativeBalance({ "adjust.negativeBalance": "carryForwardMonths", "adjust.carryForwardMonths": 2 }, "2026-06-01", -100, 0)).toMatchObject({ kind: "write-off", amountPaise: 100 });
    expect(negativeBalance({ "adjust.negativeBalance": "writeOff" }, "2026-04-01", -100, null)).toMatchObject({ kind: "write-off" });
    expect(negativeBalance({ "adjust.negativeBalance": "recoverFromSalary" }, "2026-04-01", -100, null)).toMatchObject({ kind: "salary-recovery" });
    expect(negativeBalance({ "adjust.negativeBalance": "writeOff" }, "2026-04-01", 0, null)).toBeNull();
  });
});
