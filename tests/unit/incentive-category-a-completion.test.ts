import { describe, expect, it } from "vitest";
import { calculateCategoryA } from "@/lib/incentives/category-a/engine";
import type { CategoryAInput } from "@/lib/incentives/category-a/types";
import { checkConfig } from "@/lib/incentives/rules-config/validate";
import { settingsFor } from "@/lib/incentives/rules-config/spec";
import { aprilConfig, aprilInput, CUST, EMP, EMP2, invoiceId, L, orderId, receiptId, type Pay } from "../fixtures/category-a";

// Category A completion (engine category-a/2): every defect fixed in the engine and the settings, each with a test that
// fails on category-a/1's behaviour, and the boundaries the earlier tests didn't pin. PURE; test values only.

const ON_TIME: Pay[][] = Array(12).fill([[1, 5]]);
const set = (i: CategoryAInput, s: Record<string, unknown>): CategoryAInput => ({ ...i, config: { ...i.config!, settings: { ...i.config!.settings, ...(s as Record<string, string | number | string[]>) } } });
const run = (i: CategoryAInput) => {
  const r = calculateCategoryA(i);
  expect(r.status, r.problems.join("\n")).toBe("computed");
  return r;
};
const emp = (i: CategoryAInput, id = EMP) => run(i).employees.find((e) => e.employeeId === id);
const share = (n: number) => Math.round((n / 12) * 2_000_00);

describe("D1 · invoice basis: an invoice takes its Sales Order's salesperson", () => {
  const invoiceBasis = (s: Record<string, unknown> = {}) => set(aprilInput(ON_TIME), { "basis.document": "invoice", "basis.monthDate": "invoiceDate", "attribution.source": "orderSalesperson", ...s });
  it("salespeople recorded on the Sales Orders credit their invoices (category-a/1 credited nobody)", () => {
    const i = invoiceBasis();
    const r = run({ ...i, attributions: i.orders.map((o) => ({ documentId: o.id, employeeId: EMP, sharePpm: 1_000_000 })) });
    expect(r.held).toEqual([]);
    expect(r.employees[0]!.earnedPaise).toBe(2_000_00);
    expect(r.units.every((u) => u.unitType === "sales-invoices")).toBe(true);
  });
  it("an invoice with no Sales Order is held, with the reason", () => {
    const i = invoiceBasis();
    const r = run({ ...i, invoices: i.invoices.map((v, k) => (k === 0 ? { ...v, orderId: null } : v)), attributions: i.orders.map((o) => ({ documentId: o.id, employeeId: EMP, sharePpm: 1_000_000 })) });
    const h = r.held.find((x) => x.documentId === invoiceId(1))!;
    expect(h).toMatchObject({ code: "unassigned" });
    expect(h.message).toMatch(/no Sales Order in Forms, and salespeople are recorded on Sales Orders/);
  });
  it("split shares recorded per order apply to each of its invoices", () => {
    const i = invoiceBasis({ "attribution.source": "attributionRecord", "attribution.split": "splitByShares" });
    const attributions = i.orders.flatMap((o) => [{ documentId: o.id, employeeId: EMP, sharePpm: 500_000 }, { documentId: o.id, employeeId: EMP2, sharePpm: 500_000 }]);
    const r = run({ ...i, attributions, config: { ...i.config!, eligibility: [...i.config!.eligibility, { subjectType: "employee", subjectId: EMP2, role: null, subjectLabel: "Second", mode: "include", effectiveFrom: "2026-01-01", effectiveTo: null }] } });
    expect(r.employees.map((e) => e.salesPaise)).toEqual([L(60), L(60)]);
  });
});

describe("D2 / D3 · credit notes are never passed over silently", () => {
  const withCn = (cn: Partial<CategoryAInput["creditNotes"][number]>, s: Record<string, unknown> = { "adjust.creditNote": "reduceOriginalMonthSales" }) =>
    set({ ...aprilInput(ON_TIME), creditNotes: [{ id: "00000000-0000-4000-8000-3a0000000001", no: "CN 1", date: "2026-04-20", customerId: CUST, invoiceId: invoiceId(1), totalPaise: L(1), taxablePaise: L(1), itemsPaise: L(1), ...cn }] }, s);
  it("a credit note linked to no invoice is held (code credit-note-unlinked)", () => {
    const r = run(withCn({ invoiceId: null }));
    expect(r.held).toEqual([expect.objectContaining({ code: "credit-note-unlinked", documentNo: "CN 1" })]);
    expect(r.settled).toBe(false);
  });
  it("one naming a document that isn't a sales invoice (e.g. the order) is held too", () => {
    expect(run(withCn({ invoiceId: orderId(1) })).held[0]!.message).toMatch(/names a document that isn't a Forms sales invoice/);
  });
  it("\"ignore\" is a configured choice: an ignored unlinked credit note isn't held, and its consequence is explained", () => {
    expect(run(withCn({ invoiceId: null }, { "adjust.creditNote": "ignore" })).held).toEqual([]);
    const linked = run(withCn({}, { "adjust.creditNote": "ignore" }));
    expect(linked.units.find((u) => u.unitId === orderId(1))!.explanation.join(" ")).toMatch(/never becomes fully collected/);
  });
  it("a credit note with no amount on the counted basis is held and deducts nothing (category-a/1 deducted ₹0 silently)", () => {
    const r = run(set(withCn({ taxablePaise: null }), { "basis.amount": "taxable" }));
    expect(r.held).toEqual([expect.objectContaining({ code: "credit-note-no-amount", documentNo: "CN 1" })]);
    expect(r.employees[0]!.salesPaise).toBe(L(120));
    const issue = run(set(withCn({ taxablePaise: null }, { "adjust.creditNote": "reduceInIssueMonth" }), { "basis.amount": "taxable" }));
    expect(issue.held.map((h) => h.code)).toEqual(["credit-note-no-amount"]);
    // Reducing only what is collected needs no amount on the basis: nothing is held.
    expect(run(set(withCn({ taxablePaise: null }, { "adjust.creditNote": "reduceOrderCollectionOnly" }), { "basis.amount": "taxable" })).held).toEqual([]);
  });
  it("a credit note with an amount reduces the order's month exactly", () => {
    expect(emp(withCn({}))!.salesPaise).toBe(L(119));
  });
});

describe("D4 · a bounced cheque: \"restart the delay\" isn't offered for Category A", () => {
  it("only \"Reverse what it earned\" is a choice; B and C keep their own settings", () => {
    expect(settingsFor("A").find((d) => d.key === "adjust.bouncedCheque")!.choices!.map((c) => c.value)).toEqual(["reverseReceiptShare"]);
    expect(settingsFor("B").find((d) => d.key === "adjust.bouncedCheque")!.choices!.map((c) => c.value)).toEqual(["reverseReceiptShare", "reverseAndRestartDelay"]);
  });
});

describe("D5 · an on-account receipt with no customer never matches another blank-customer invoice", () => {
  it("it is held to be allocated by hand", () => {
    const i = set(aprilInput(ON_TIME), { "collection.onAccountReceipts": "allocateOldestInvoiceFirst" });
    i.invoices = i.invoices.map((v, k) => (k === 0 ? { ...v, customerId: null } : v));
    i.orders = i.orders.map((o, k) => (k === 0 ? { ...o, customerId: null } : o));
    i.receipts = i.receipts.map((x) => (x.id === receiptId(1, 1) ? { ...x, customerId: null, invoiceId: null } : x));
    const r = run(i);
    expect(r.pieces.find((p) => p.receiptId === receiptId(1, 1))).toMatchObject({ status: "held" });
    expect(r.held.find((h) => h.documentId === receiptId(1, 1))).toMatchObject({ code: "receipt" });
    expect(r.pieces.some((p) => p.receiptId === receiptId(1, 1) && p.status === "credited")).toBe(false);
  });
});

describe("D7 · settled counts every order of the month, and nothing held", () => {
  it("all collected and nothing held: settled", () => {
    expect(run(aprilInput(ON_TIME)).settled).toBe(true);
  });
  it("an order credited to nobody (its customer isn't in the master) keeps the month unsettled", () => {
    const i = aprilInput(ON_TIME);
    i.orders = i.orders.map((o, k) => (k === 0 ? { ...o, customerId: "00000000-0000-4000-8000-0000000000c9" } : o));
    i.invoices = i.invoices.map((v, k) => (k === 0 ? { ...v, customerId: "00000000-0000-4000-8000-0000000000c9" } : v));
    const r = run(i);
    expect(r.held[0]).toMatchObject({ code: "unassigned" });
    expect(r.settled).toBe(false);
  });
  it("an order credited to nobody eligible (left out, not held) and not yet collected keeps the month unsettled", () => {
    // Order 1 is a second customer's, whose representative isn't included: left out (category-a/1 then ignored it).
    const C2 = "00000000-0000-4000-8000-0000000000c2";
    const i = aprilInput([[[0.5, 5]], ...Array(11).fill([[1, 5]])], { asOf: "2026-05-10" });
    i.customers = [...i.customers, { id: C2, name: "Customer Two", salesRepId: EMP2, creditPeriodDays: null }];
    i.orders = i.orders.map((o, k) => (k === 0 ? { ...o, customerId: C2 } : o));
    i.invoices = i.invoices.map((v, k) => (k === 0 ? { ...v, customerId: C2 } : v));
    i.receipts = i.receipts.map((x) => (x.id === receiptId(1, 1) ? { ...x, customerId: C2 } : x));
    const r = run(i);
    expect(r.held).toEqual([]);
    expect(r.excluded.some((x) => x.documentId === orderId(1))).toBe(true);
    expect(r.settled).toBe(false);
    // Past the last delay step it is settled (nothing more can change what it earns).
    expect(run({ ...i, asOf: "2026-09-30" }).settled).toBe(true);
  });
});

describe("D12 · \"Only orders of at least a minimum value\": exactly the minimum takes a share", () => {
  const minAt = (min: number) => run(set(aprilInput(ON_TIME), { "allocation.eligibleOrders": "onlyOrdersAboveMin", "allocation.minOrderAmount": min, "allocation.method": "equalPerOrder" }));
  it("an order of exactly the minimum takes a share; 1 paisa more than the order doesn't", () => {
    expect(minAt(L(10)).employees[0]!.ordersSharing).toBe(12);
    expect(minAt(L(10) + 1).employees[0]!.ordersSharing).toBe(0);
  });
  it("the label says so", () => {
    expect(settingsFor("A").find((d) => d.key === "allocation.eligibleOrders")!.choices!.find((c) => c.value === "onlyOrdersAboveMin")!.label).toBe("Only orders of at least a minimum value");
  });
});

describe("D13 · flat slabs above the highest slab never drop to nothing", () => {
  // 20 orders of ₹10 L = ₹2 Cr, above the highest slab (₹1.6 Cr). Slab limits removed so the figures show.
  const twoCrore = (method: string, aboveTop: string, extra: Record<string, unknown> = {}) => {
    const i = set(aprilInput(Array(20).fill([[1, 5]])), { "slabs.method": method, "slabs.aboveTop": aboveTop, "caps.perEmployeeCategoryMonth": "none", "caps.perEmployeeAllCategoriesMonth": "none", ...extra });
    i.config!.slabs = i.config!.slabs.map((s) => ({ ...s, capPaise: null }));
    return run(i).employees[0]!;
  };
  it("flat, nothing more: the highest slab's rate as at its top (0.20% of ₹1.6 Cr = ₹32,000) — category-a/1 gave ₹0", () => {
    expect(twoCrore("flat", "noFurtherIncentive").pool).toBe("3200000");
  });
  it("flat above threshold, nothing more: 0.20% of (₹1.6 Cr − ₹1 Cr) = ₹12,000", () => {
    expect(twoCrore("flatAboveThreshold", "noFurtherIncentive").pool).toBe("1200000");
  });
  it("flat, the top rate continues: 0.20% of all ₹2 Cr = ₹40,000", () => {
    expect(twoCrore("flat", "continueTopRate").pool).toBe("4000000");
  });
  it("flat, a fixed amount above: the top slab's figure at its top plus the fixed ₹500", () => {
    expect(twoCrore("flat", "fixedAmount", { "slabs.aboveTopAmount": 500_00 }).pool).toBe("3250000");
  });
  it("flat, exactly at the top edge (₹1.6 Cr, lower-inclusive): the highest slab, as at its top", () => {
    const i = set(aprilInput(Array(16).fill([[1, 5]])), { "slabs.method": "flat", "caps.perEmployeeCategoryMonth": "none", "caps.perEmployeeAllCategoriesMonth": "none" });
    i.config!.slabs = i.config!.slabs.map((s) => ({ ...s, capPaise: null }));
    expect(run(i).employees[0]!.pool).toBe("3200000");
  });
});

describe("D18 / D19 · pre-closures and links the calculation can't use are held", () => {
  it("a pre-closure on an order with no product-line amounts is held (category-a/1 skipped it)", () => {
    const i = set(aprilInput(ON_TIME), { "basis.preClosure": "deductPreClosedValue" });
    i.orders = i.orders.map((o, k) => (k === 0 ? { ...o, itemsPaise: null } : o));
    i.preclosures = [{ orderId: orderId(1), date: "2026-04-20", itemsValuePaise: L(5) }];
    const r = run(i);
    expect(r.held).toEqual([expect.objectContaining({ code: "preclosure-incomplete", documentId: orderId(1) })]);
  });
  it("a pre-closure the loader couldn't value (its line has no amount) is held", () => {
    const r = run({ ...aprilInput(ON_TIME), preclosureProblems: [{ orderId: orderId(2), orderNo: "SO 2", date: "2026-04-21", reason: "line 1 has no amount." }] });
    expect(r.held).toEqual([expect.objectContaining({ code: "preclosure-incomplete", documentNo: "SO 2" })]);
    expect(r.held[0]!.message).toMatch(/line 1 has no amount/);
  });
  it("documents whose links go further than the loader follows are held", () => {
    const r = run({ ...aprilInput(ON_TIME), referencesIncomplete: [{ documentId: receiptId(3, 1), documentNo: "RC 3.1" }] });
    expect(r.held).toEqual([expect.objectContaining({ code: "reference-chain", documentNo: "RC 3.1" })]);
  });
});

describe("D27 · the representative \"on the order's date\" uses the Sales Order's date, never the month's", () => {
  it("orders of 28 March invoiced in April (the invoice date places the month): March's representative", () => {
    const i = set(aprilInput(ON_TIME), { "basis.monthDate": "invoiceDate", "attribution.historical": "repAtOrderDate" });
    i.orders = i.orders.map((o) => ({ ...o, date: "2026-03-28" }));
    i.customers = [{ id: CUST, name: "Customer One", salesRepId: EMP2, creditPeriodDays: null }];
    i.repHistory = [
      { customerId: CUST, employeeId: EMP, from: "2026-01-01", to: "2026-03-31" },
      { customerId: CUST, employeeId: EMP2, from: "2026-04-01", to: null },
    ];
    const r = run(i);
    expect(r.employees.map((e) => e.employeeId)).toEqual([EMP]); // category-a/1 looked up 5 April: Second (not included)
    expect(r.employees[0]!.salesPaise).toBe(L(120));
  });
});

describe("thresholds and slab edges, to the paisa", () => {
  const sales = (paise: number, s: Record<string, unknown> = {}) => {
    const i = set(aprilInput([[[1, 5]]]), s);
    i.orders = [{ ...i.orders[0]!, totalPaise: paise }];
    i.invoices = [{ ...i.invoices[0]!, totalPaise: paise }];
    i.receipts = [{ ...i.receipts[0]!, amountPaise: paise }];
    return run(i).employees[0]!;
  };
  it("₹1 Cr − 1 paisa doesn't qualify; exactly ₹1 Cr does (at least), and doesn't (above)", () => {
    expect(sales(L(100) - 1).qualified).toBe(false);
    expect(sales(L(100)).qualified).toBe(true);
    expect(sales(L(100), { "eligibility.thresholdComparison": "above" }).qualified).toBe(false);
    expect(sales(L(100) + 1, { "eligibility.thresholdComparison": "above" }).qualified).toBe(true);
  });
  it("marginal: ₹1.2 Cr exactly fills slab 1 (₹2,000) and nothing of slab 2, either edge rule", () => {
    expect(sales(L(120)).pool).toBe("200000");
    expect(sales(L(120), { "slabs.boundaries": "upperInclusive" }).pool).toBe("200000");
    expect(sales(L(120) + 100).pool).toBe("4000003/20"); // ₹1 above: 0.15% of ₹1 = 0.15 paise more, exactly
  });
  it("flat: the slab an amount exactly on an edge belongs to follows the edge rule", () => {
    const flat = (b: string) => {
      const e = sales(L(120), { "slabs.method": "flat", "slabs.boundaries": b, "caps.perEmployeeCategoryMonth": "none" });
      return e.slabLines.map((l) => l.lineCode);
    };
    expect(flat("lowerInclusive")).toEqual(["A.2"]);
    expect(flat("upperInclusive")).toEqual(["A.1"]);
  });
});

describe("settings that can't be honoured are refused by validation, with the reason", () => {
  const problems = (s: Record<string, unknown>, slabFrom?: number) => {
    const c = aprilConfig(s as never);
    if (slabFrom !== undefined) c.slabs = [{ ...c.slabs[0]!, fromPaise: slabFrom }, ...c.slabs.slice(1)];
    return checkConfig(c, { roles: ["both"] }).problems.map((p) => p.message).join(" | ");
  };
  it("D29: the first slab must start exactly at the threshold", () => {
    expect(problems({}, L(90))).toMatch(/the first slab must start exactly at the threshold/);
    expect(problems({})).not.toMatch(/first slab/);
  });
  it("D14: a limit of ₹0 is refused (it would pay nothing)", () => {
    expect(problems({ "caps.perOrder": 0 })).toMatch(/Most one order can earn: ₹0 would mean nothing is ever paid/);
    expect(problems({ "caps.perEmployeeCategoryMonth": 0 })).toMatch(/₹0 would mean nothing is ever paid/);
    expect(problems({ "caps.perOrder": "none" })).not.toMatch(/₹0/);
  });
  it("split credit needs credit assigned per order", () => {
    expect(problems({ "attribution.split": "splitByShares", "attribution.source": "customerSalesRep" })).toMatch(/splitting by shares works only when credit is assigned per order/);
    expect(problems({ "attribution.split": "splitByShares", "attribution.source": "attributionRecord" })).not.toMatch(/splitting/);
  });
  it("a pre-closure deduction with sales counted from invoices is refused", () => {
    expect(problems({ "basis.document": "invoice", "basis.preClosure": "deductPreClosedValue" })).toMatch(/with sales counted from Sales Invoices a pre-closure changes nothing/);
    expect(problems({ "basis.document": "invoice", "basis.preClosure": "ignore" })).not.toMatch(/pre-closure/);
  });
  it("D4: a version that chose \"restart the delay\" is refused", () => {
    expect(problems({ "adjust.bouncedCheque": "reverseAndRestartDelay" })).toMatch(/Bounced cheques: Choose one of the listed options/);
  });
});

describe("amount bases, month dates and order filters (figures, not just choices)", () => {
  const diff = (s: Record<string, unknown>, change: (i: CategoryAInput) => void = () => {}) => {
    const i = set(aprilInput(ON_TIME), s);
    change(i);
    return run(i).employees[0];
  };
  it("total, taxable and product lines give their own figures", () => {
    const change = (i: CategoryAInput) => {
      i.orders = i.orders.map((o) => ({ ...o, totalPaise: L(11.8), taxablePaise: L(10), itemsPaise: L(9) }));
      i.invoices = i.invoices.map((v) => ({ ...v, totalPaise: L(11.8) }));
      i.receipts = i.receipts.map((x) => ({ ...x, amountPaise: L(11.8) }));
    };
    expect(diff({ "basis.amount": "total" }, change)!.salesPaise).toBe(L(141.6));
    expect(diff({ "basis.amount": "taxable" }, change)!.salesPaise).toBe(L(120));
    expect(diff({ "basis.amount": "itemsOnly" }, change)!.salesPaise).toBe(L(108));
  });
  it("the customer's order date moves orders out of the month", () => {
    const r = run(set(aprilInput(ON_TIME), { "basis.monthDate": "customerOrderDate" }));
    expect(r.employees[0]!.salesPaise).toBe(L(120)); // 4 April: still April
    const i = set(aprilInput(ON_TIME), { "basis.monthDate": "customerOrderDate" });
    i.orders = i.orders.map((o, k) => (k < 2 ? { ...o, customerOrderDate: "2026-03-30" } : o));
    expect(run(i).employees[0]!.salesPaise).toBe(L(100));
  });
  it("each order filter leaves its orders out", () => {
    for (const k of ["cancelled", "optional", "postDated"] as const) {
      const i = set(aprilInput(ON_TIME), { "basis.voucherFilter": [k] });
      i.orders = i.orders.map((o, n) => (n === 0 ? { ...o, states: { ...o.states, [k]: true } } : o));
      const r = run(i);
      expect(r.employees[0]!.salesPaise, k).toBe(L(110));
      expect(r.excluded[0]!.message).toMatch(new RegExp(k));
    }
  });
});
