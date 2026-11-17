import { describe, expect, it } from "vitest";
import { calculateCategoryA } from "@/lib/incentives/category-a/engine";
import type { CategoryAInput } from "@/lib/incentives/category-a/types";
import { aprilInput, CUST, EMP, EMP2, invoiceId, L, orderId, receiptId, type Pay } from "../fixtures/category-a";

// Category A rules that the first engine tests didn't cover: pre-closures, representative history, people who leave,
// reversed and held receipts, receipts paying several invoices, allocations by hand, what unpaid amounts show, sales
// returns, a salesperson recorded on the order. PURE engine; the settings are test values, not business decisions.

const ON_TIME: Pay[][] = Array(12).fill([[1, 5]]); // 12 × ₹10 L, each paid in full 5 days after its invoice
const set = (i: CategoryAInput, s: Record<string, unknown>): CategoryAInput => ({ ...i, config: { ...i.config!, settings: { ...i.config!.settings, ...(s as Record<string, string | number | string[]>) } } });
const run = (i: CategoryAInput) => calculateCategoryA(i);
const emp = (i: CategoryAInput) => {
  const r = run(i);
  expect(r.status, r.problems.join("\n")).toBe("computed");
  return r.employees.find((e) => e.employeeId === EMP);
};
const share = (n: number) => Math.round((n / 12) * 2_000_00);

describe("pre-closed quantities (basis.preClosure)", () => {
  const halfOfOrder1 = (date: string) => ({ ...aprilInput(ON_TIME), preclosures: [{ orderId: orderId(1), date, itemsValuePaise: L(5) }] });
  it("ignore: sales count the full order; the customer owes less, so the order is still fully collected", () => {
    const r = run(set(halfOfOrder1("2026-04-20"), { "basis.preClosure": "ignore" }));
    expect(r.employees[0]!.salesPaise).toBe(L(120));
    expect(r.employees[0]!.earnedPaise).toBe(2_000_00);
    const u = r.units.find((x) => x.unitId === orderId(1))!;
    expect([u.collectiblePaise, u.fullyCollected]).toEqual([L(5), true]);
    expect(r.pieces.find((p) => p.unitId === orderId(1) && p.status === "over-collected")?.amountPaise).toBe(L(5));
  });
  it("deductPreClosedValue: the order's own value drops (₹1.15 Cr → pool ₹1,500)", () => {
    const e = emp(set(halfOfOrder1("2026-04-20"), { "basis.preClosure": "deductPreClosedValue" }))!;
    expect(e.salesPaise).toBe(L(115));
    expect(e.pool).toBe("150000");
    expect(e.earnedPaise).toBe(1_500_00);
  });
  it("deductInMonthOfPreClosure: taken off the month it was pre-closed in, not the order's month", () => {
    const sameMonth = emp(set(halfOfOrder1("2026-04-20"), { "basis.preClosure": "deductInMonthOfPreClosure" }))!;
    expect(sameMonth.salesPaise).toBe(L(115));
    expect(sameMonth.explanation.join(" ")).toMatch(/Pre-closure on order SO 1/);
    const later = set(halfOfOrder1("2026-05-20"), { "basis.preClosure": "deductInMonthOfPreClosure" });
    expect(emp(later)!.salesPaise).toBe(L(120));
    const may = run({ ...later, month: "2026-05-01" });
    expect(may.employees.find((x) => x.employeeId === EMP)!.salesPaise).toBe(-L(5));
  });
});

describe("whose sale it is", () => {
  const history = (rows: CategoryAInput["repHistory"]) => set({ ...aprilInput(ON_TIME), customers: [{ id: CUST, name: "Customer One", salesRepId: EMP2, creditPeriodDays: null }], repHistory: rows }, { "attribution.historical": "repAtOrderDate" });
  it("the representative on the order's date, not today's", () => {
    const i = history([
      { customerId: CUST, employeeId: EMP, from: "2026-01-01", to: "2026-04-30" },
      { customerId: CUST, employeeId: EMP2, from: "2026-05-01", to: null },
    ]);
    expect(emp(i)!.earnedPaise).toBe(2_000_00);
    // The current representative (Customer Master) is Second, who isn't included: nobody is credited.
    const now = run(set(i, { "attribution.historical": "currentRep" }));
    expect(now.employees).toEqual([]);
    expect(now.excluded[0]!.message).toMatch(/Second isn't included/);
  });
  it("no representative on record for the date, or two at once, leaves the order unattributed with the reason", () => {
    expect(run(history([{ customerId: CUST, employeeId: EMP, from: "2026-05-01", to: null }])).excluded[0]!.message).toMatch(/No representative of Customer One is on record for 2026-04-05/);
    const two = run(history([{ customerId: CUST, employeeId: EMP, from: "2026-01-01", to: null }, { customerId: CUST, employeeId: EMP2, from: "2026-04-01", to: null }]));
    expect(two.excluded[0]!.message).toMatch(/Several representatives/);
  });
  it("a salesperson recorded on the order: one person at 100%, or the order is listed as needing one", () => {
    const i = set(aprilInput(ON_TIME), { "attribution.source": "orderSalesperson" });
    const none = run(i);
    expect(none.employees).toEqual([]);
    expect(none.excluded).toHaveLength(12);
    expect(none.excluded[0]!.message).toMatch(/No salesperson is recorded for this order/);
    const recorded = { ...i, attributions: i.orders.map((o) => ({ documentId: o.id, employeeId: EMP, sharePpm: 1_000_000 })) };
    expect(emp(recorded)!.earnedPaise).toBe(2_000_00);
    const split = { ...recorded, attributions: [...recorded.attributions.slice(1), { documentId: orderId(1), employeeId: EMP, sharePpm: 500_000 }, { documentId: orderId(1), employeeId: EMP2, sharePpm: 500_000 }] };
    expect(run(split).excluded.find((x) => x.documentId === orderId(1))!.message).toMatch(/one person at 100%/);
  });
});

describe("salespeople who leave (eligibility.inactiveEmployees)", () => {
  const leaving = (lastDay: string | null, pays: Pay[][] = ON_TIME) => {
    const i = aprilInput(pays);
    i.employees = i.employees.map((e) => (e.id === EMP ? { ...e, isActive: false } : e));
    i.config!.eligibility = [{ subjectType: "employee", subjectId: EMP, role: null, subjectLabel: "Salesperson", mode: "include", effectiveFrom: "2026-01-01", effectiveTo: lastDay }];
    return i;
  };
  it("nothing from the month they leave", () => {
    const r = run(set(leaving("2026-04-20"), { "eligibility.inactiveEmployees": "excludeFromMonthLeft" }));
    expect(r.employees).toEqual([]);
    expect(r.excluded[0]!.message).toMatch(/left in 2026-04: nothing from that month on/);
  });
  it("earn until the last working day: receipts after it earn nothing", () => {
    // 6 orders paid on 10 Apr, 6 on 15 May; the last working day is 10 May.
    const pays: Pay[][] = [...Array(6).fill([[1, 5]]), ...Array(6).fill([[1, 40]])];
    const e = emp(set(leaving("2026-05-10", pays), { "eligibility.inactiveEmployees": "payUntilLastWorkingDay" }))!;
    expect(e.earnedPaise).toBe(share(6));
  });
  it("someone who left with no last working day recorded is left out, with the reason", () => {
    const r = run(set(leaving(null), { "eligibility.inactiveEmployees": "payUntilLastWorkingDay" }));
    expect(r.employees).toEqual([]);
    expect(r.excluded[0]!.message).toMatch(/no last working day is recorded/);
  });
});

describe("receipts held, reversed, bounced, split and applied", () => {
  const withEvent = (kind: "reversed" | "hold" | "bounced", s: Record<string, unknown> = {}) => set({ ...aprilInput(ON_TIME), events: [{ id: "ev1", kind, documentId: receiptId(1, 1), invoiceId: null, amountPaise: null, date: "2026-04-20" }] }, s);
  it("a reversed receipt is held for review, or reversed, as configured", () => {
    const held = run(withEvent("reversed", { "adjust.reversedReceipt": "holdForReview" }));
    expect(held.held.map((h) => h.documentId)).toContain(receiptId(1, 1));
    expect(held.pieces.find((p) => p.receiptId === receiptId(1, 1))!.status).toBe("held");
    expect(held.employees[0]!.earnedPaise).toBe(share(11));
    const reversed = run(withEvent("reversed", { "adjust.reversedReceipt": "reverseReceiptShare" }));
    expect(reversed.pieces.find((p) => p.receiptId === receiptId(1, 1))!.status).toBe("reversed");
    expect(reversed.held).toEqual([]);
  });
  it("a receipt held by hand earns nothing until the hold is retired", () => {
    const r = run(withEvent("hold"));
    expect(r.held[0]!.message).toMatch(/Held for review by hand/);
    expect(r.employees[0]!.earnedPaise).toBe(share(11));
  });
  it("a bounced cheque that keeps the delay running says so", () => {
    const r = run(withEvent("bounced", { "adjust.bouncedCheque": "reverseAndRestartDelay" }));
    expect(r.pieces.find((p) => p.receiptId === receiptId(1, 1))!.note).toMatch(/delay keeps running/);
  });
  const twoInvoices = (amount: number, invoice: string | null) => {
    const i = aprilInput(ON_TIME);
    i.receipts = i.receipts.filter((r) => r.id !== receiptId(1, 1)).map((r) => (r.id === receiptId(2, 1) ? { ...r, amountPaise: amount, invoiceId: invoice } : r));
    return i;
  };
  it("a receipt paying two invoices: oldest first, its own invoice only, or split by hand, as configured", () => {
    const i = twoInvoices(L(20), invoiceId(2));
    const oldest = run(set(i, { "collection.multiInvoiceReceipts": "oldestFirst" }));
    expect(oldest.employees[0]!.payablePaise).toBe(2_000_00);
    expect(oldest.pieces.filter((p) => p.receiptId === receiptId(2, 1) && p.status === "credited").map((p) => [p.invoiceId, p.amountPaise])).toEqual([[invoiceId(1), L(10)], [invoiceId(2), L(10)]].sort());
    const named = run(set(i, { "collection.multiInvoiceReceipts": "useImportedReference" }));
    expect(named.employees[0]!.payablePaise).toBe(share(11));
    expect(named.pieces.find((p) => p.receiptId === receiptId(2, 1) && p.status === "over-collected")!.amountPaise).toBe(L(10));
    const manual = run(set(i, { "collection.multiInvoiceReceipts": "manualAllocation" }));
    expect(manual.held.map((h) => h.documentId)).toContain(receiptId(2, 1));
  });
  it("allocations by hand split one receipt between invoices; more than the receipt is held", () => {
    const i = twoInvoices(L(20), null);
    const split = { ...i, events: [{ id: "a1", kind: "allocation" as const, documentId: receiptId(2, 1), invoiceId: invoiceId(1), amountPaise: L(10), date: "2026-04-10" }, { id: "a2", kind: "allocation" as const, documentId: receiptId(2, 1), invoiceId: invoiceId(2), amountPaise: L(10), date: "2026-04-10" }] };
    expect(emp(split)!.payablePaise).toBe(2_000_00);
    const tooMuch = { ...split, events: [...split.events, { id: "a3", kind: "allocation" as const, documentId: receiptId(2, 1), invoiceId: invoiceId(3), amountPaise: L(1), date: "2026-04-10" }] };
    expect(run(tooMuch).held[0]!.message).toMatch(/doesn't fit the receipt/);
  });
});

describe("amounts not yet received (collection.unreceivedPortion)", () => {
  const unpaidOrder1 = (asOf: string, how: string) => {
    const i = aprilInput(ON_TIME, { asOf });
    return set({ ...i, receipts: i.receipts.filter((r) => r.id !== receiptId(1, 1)) }, { "collection.unreceivedPortion": how });
  };
  it("pending until received: at the full rate", () => {
    expect(emp(unpaidOrder1("2026-09-30", "pendingUntilReceived"))!.projectedPaise).toBe(share(1));
  });
  it("at the step the calculation day falls in", () => {
    expect(emp(unpaidOrder1("2026-05-10", "decayAsOfToday"))!.projectedPaise).toBe(share(1)); // 35 days: 100%
    expect(emp(unpaidOrder1("2026-06-01", "decayAsOfToday"))!.projectedPaise).toBe(Math.round((0.5 / 12) * 2_000_00)); // 57 days: 50% of ₹166.666… = ₹83.33
    expect(emp(unpaidOrder1("2026-09-30", "decayAsOfToday"))!.projectedPaise).toBe(0); // 178 days: 0%
  });
  it("is never payable", () => {
    const e = emp(unpaidOrder1("2026-05-10", "decayAsOfToday"))!;
    expect(e.payablePaise).toBe(share(11));
  });
});

describe("sales returns are treated by their own setting", () => {
  it("a credit note marked as a sales return follows adjust.salesReturn, not adjust.creditNote", () => {
    const i = set(aprilInput(ON_TIME), { "adjust.creditNote": "ignore", "adjust.salesReturn": "reduceOriginalMonthSales" });
    i.creditNotes = [{ id: "cn1", no: "CN 1", date: "2026-04-25", customerId: CUST, invoiceId: invoiceId(1), totalPaise: L(10), taxablePaise: L(10), itemsPaise: L(10) }];
    expect(emp(i)!.salesPaise).toBe(L(120)); // an ordinary credit note, ignored
    const ret = { ...i, events: [{ id: "sr", kind: "salesReturn" as const, documentId: "cn1", invoiceId: null, amountPaise: null, date: "2026-04-25" }] };
    expect(emp(ret)!.salesPaise).toBe(L(110));
  });
});

describe("effective dates", () => {
  it("a version that starts after the month began isn't used for it", () => {
    const r = run(aprilInput(ON_TIME, { configVersion: { id: "v", programId: "p", versionNo: 2, status: "published", effectiveFrom: "2026-05-01", effectiveTo: null } }));
    expect(r.status).toBe("blocked");
    expect(r.problems.join(" ")).toMatch(/isn't in force for the whole of 2026-04/);
  });
});
