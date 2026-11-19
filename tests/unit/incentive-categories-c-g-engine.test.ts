import { describe, expect, it } from "vitest";
import { calculateCategoryX, windowEndInclusive } from "@/lib/incentives/categories/engine";
import { inputsHashX, resultHashX } from "@/lib/incentives/categories/hash";
import type { CategoryXInput, CategoryXResult, ExtraCategory, OrderXIn } from "@/lib/incentives/categories/types";
import type { AttributionIn, CreditNoteIn, EventIn, InvoiceIn, ReceiptIn, RepAssignmentIn } from "@/lib/incentives/category-a/types";
import { addDays } from "@/lib/incentives/shared/dates";
import type { SettingValue } from "@/lib/incentives/rules-config/spec";
import { completeConfig } from "../fixtures/incentive-config";

// Categories C–G — the pure engines on SYNTHETIC data. The amounts are the old engine's PDF values used as TEST
// values (C 1% of the first 3, ₹2.5 L turnover, ₹5,000 per customer; D ₹250 per 10 leads / per 5 enquiries; E ₹250–
// ₹1,000; F ₹100 / ₹100 / ₹150, ×2 when named) — not business decisions. G's values are invented TEST values only.
const RS = (r: number) => Math.round(r * 100);
const EMP = "00000000-0000-4000-8000-0000000c0e01";
const EMP2 = "00000000-0000-4000-8000-0000000c0e02";
const CUST = "00000000-0000-4000-8000-0000000c0c01";
const id = (k: string, n: number) => `00000000-0000-4000-8000-${k}${String(n).padStart(12 - k.length, "0")}`;
const TEST: Record<ExtraCategory, Record<string, SettingValue>> = {
  C: { "c.newCustomerLookbackMonths": 12, "c.turnoverWindowMonths": 12, "c.turnoverBasis": "invoiced", "c.requiredTransactions": 3, "c.minTurnover": RS(2_50_000), "c.amountBasis": "taxable", "c.ratePpm": 10_000, "caps.perOrder": RS(5_000), "attribution.historical": "currentRep", "collection.dueDateFallback": ["invoiceDueDate"], "collection.earningBasis": "perReceipt", "payout.minimumPayable": "none" },
  D: { "d.leadsPerUnit": 10, "d.leadUnitAmount": RS(250), "d.leadsMustBeProfiled": "yes", "d.conversionsPerUnit": 5, "d.conversionUnitAmount": RS(250), "d.unitCounting": "perSubmission" },
  E: { "e.minAward": RS(250), "e.maxAward": RS(1_000) },
  F: { "f.googleReviewAmount": RS(100), "f.googleMinWords": 50, "f.googleFiveStarOnly": "yes", "f.googleNeedsEvidence": "yes", "f.emailAmount": RS(100), "f.letterheadAmount": RS(150), "f.namedMultiple": 2 },
  G: { "g.consecutiveMonths": 3, "g.minMonthlyPurchase": RS(50_000), "g.purchaseBasis": "taxable", "g.rewardAmount": RS(500), "g.afterReward": "restart", "caps.perOrder": "none", "attribution.historical": "currentRep" },
};
const elig = [{ subjectType: "employee" as const, subjectId: EMP, role: null, subjectLabel: "Rep", mode: "include" as const, effectiveFrom: "2025-01-01", effectiveTo: null }, { subjectType: "employee" as const, subjectId: EMP2, role: null, subjectLabel: "Rep 2", mode: "include" as const, effectiveFrom: "2025-01-01", effectiveTo: null }];
function input(category: ExtraCategory, over: Partial<CategoryXInput> = {}, settings: Record<string, SettingValue> = {}): CategoryXInput {
  const c = completeConfig({}, elig, category);
  return {
    category,
    month: "2026-06-01",
    asOf: "2026-09-30",
    configVersion: { id: id("a", 1), programId: id("b", 1), versionNo: 1, status: "published", effectiveFrom: "2026-04-01", effectiveTo: null },
    config: { ...c, settings: { ...c.settings, ...TEST[category], "caps.perEmployeeCategoryMonth": "none", "caps.perEmployeeAllCategoriesMonth": "none", ...settings } },
    roles: ["doer", "initiator", "both"],
    employees: [{ id: EMP, name: "Rep", role: "doer", departmentId: null, isActive: true }, { id: EMP2, name: "Rep 2", role: "doer", departmentId: null, isActive: true }],
    customers: [{ id: CUST, name: "New Co", salesRepId: EMP, creditPeriodDays: 30 }],
    ...over,
  };
}
const order = (n: number, date: string, taxableRupees: number, customerId = CUST): OrderXIn => ({ id: id("c50", n), no: `SO ${n}`, date, customerId, partyKey: "new co", paymentTerms: null, states: { cancelled: false, optional: false, postDated: false }, lines: [], totalPaise: RS(taxableRupees * 1.18), taxablePaise: RS(taxableRupees) });

describe("C · new customer acquisition (category-c/3: net, rolling, per receipt, review, carry-forward)", () => {
  // A deal: Sales Orders, each invoiced on its date (due 30 days later), credit notes / returns against an invoice, and
  // receipts as [fraction of what the invoice still asks, days after its due date].
  const due = (d: string) => addDays(d, 30);
  type Spec = { n: number; date: string; rs: number; pay?: [number, number][]; cn?: { rs: number; ret?: boolean; date?: string }; customerId?: string | null };
  function deal(specs: Spec[]) {
    const orders: OrderXIn[] = [], invoices: InvoiceIn[] = [], receipts: ReceiptIn[] = [], creditNotes: CreditNoteIn[] = [], events: EventIn[] = [];
    for (const sp of specs) {
      const o = { ...order(sp.n, sp.date, sp.rs), customerId: sp.customerId === undefined ? CUST : sp.customerId };
      orders.push(o);
      const inv: InvoiceIn = { id: id("c1e", sp.n), no: `INV ${sp.n}`, date: sp.date, customerId: o.customerId, orderId: o.id, totalPaise: o.totalPaise, taxablePaise: o.taxablePaise, itemsPaise: o.taxablePaise, dueDate: due(sp.date) };
      invoices.push(inv);
      let owed = inv.totalPaise;
      if (sp.cn) {
        const cn: CreditNoteIn = { id: id("c3c", sp.n), no: `CN ${sp.n}`, date: sp.cn.date ?? sp.date, customerId: o.customerId, invoiceId: inv.id, totalPaise: RS(sp.cn.rs * 1.18), taxablePaise: RS(sp.cn.rs), itemsPaise: RS(sp.cn.rs) };
        creditNotes.push(cn);
        owed -= cn.totalPaise;
        if (sp.cn.ret) events.push({ id: id("c4e", sp.n), kind: "salesReturn", documentId: cn.id, invoiceId: inv.id, amountPaise: null, date: cn.date });
      }
      (sp.pay ?? [[1, 0]]).forEach(([fraction, late], k) => receipts.push({ id: id("c2f", sp.n * 10 + k), no: `RC ${sp.n}.${k + 1}`, date: addDays(due(sp.date), late), customerId: o.customerId, invoiceId: inv.id, amountPaise: Math.round(owed * fraction) }));
    }
    return { orders, invoices, receipts, creditNotes, events, repHistory: [] as RepAssignmentIn[], attributions: [] as AttributionIn[] };
  }
  const APR_MAY_JUN = (o3?: Partial<Spec>): Spec[] => [{ n: 1, date: "2026-04-10", rs: 1_00_000 }, { n: 2, date: "2026-05-10", rs: 1_00_000 }, { n: 3, date: "2026-06-10", rs: 1_00_000, ...o3 }];
  const C = (over: Partial<CategoryXInput> = {}, settings: Record<string, SettingValue> = {}, month = "2026-06-01") => calculateCategoryX({ ...input("C", over, settings), month });
  const said = (r: CategoryXResult) => [...r.excluded, ...r.held].map((x) => x.message).join(" | ");

  it("credited in the month of the 3rd transaction (its Sales Order date): 1% × net ₹3,00,000 = ₹3,000, paid on time; nothing in May", () => {
    const r = C(deal(APR_MAY_JUN()));
    expect(r.status).toBe("computed");
    expect(r.items).toEqual([expect.objectContaining({ employeeId: EMP, lineCode: "C.1", status: "credited", baseExact: String(RS(3_000)), earnedExact: String(RS(3_000)), multiplierPpm: 1_000_000 })]);
    expect(r.employees[0]).toMatchObject({ earnedPaise: RS(3_000), payablePaise: RS(3_000) });
    expect(C(deal(APR_MAY_JUN()), {}, "2026-05-01").items).toEqual([]);
  });

  it("each receipt earns at its own delay step: on time, on time, half on time + half 60 days late → ₹2,750 (not ₹1,500)", () => {
    const r = C(deal(APR_MAY_JUN({ pay: [[0.5, 0], [1, 60]] })));
    expect(r.employees[0]!.payablePaise).toBe(RS(2_750));
    expect(r.items[0]!.explanation.join(" ")).toMatch(/60 days after the invoice's due date .*: 50%/);
    // "Whole order at its latest payment's delay" stays a configurable choice (Category A's): order 3 at 50% → ₹2,500.
    expect(C(deal(APR_MAY_JUN({ pay: [[0.5, 0], [1, 60]] })), {}, undefined).employees[0]!.payablePaise).toBe(RS(2_750));
    expect(C(deal(APR_MAY_JUN({ pay: [[0.5, 0], [1, 60]] })), { "collection.earningBasis": "wholeOrderWorstReceipt" }).employees[0]!.payablePaise).toBe(RS(2_500));
  });

  it("partial collection: pending, nothing payable, the month unsettled — payable once the last receipt completes it", () => {
    const part = C(deal(APR_MAY_JUN({ pay: [[0.5, 0]] })));
    expect(part.items[0]).toMatchObject({ status: "pending", earnedExact: "0", payableExact: "0" });
    expect(part.employees[0]).toMatchObject({ payablePaise: 0 });
    expect(part.settled).toBe(false);
    expect(C(deal(APR_MAY_JUN({ pay: [[0.5, 0], [1, 0]] }))).employees[0]!.payablePaise).toBe(RS(3_000));
  });

  it("net turnover: ₹3,00,000 less a ₹60,000 sales return = ₹2,40,000, below ₹2,50,000 → nothing, with the reason", () => {
    const r = C(deal(APR_MAY_JUN({ cn: { rs: 60_000, ret: true } })));
    expect(r.items).toEqual([]);
    expect(said(r)).toMatch(/net turnover ₹2,40,000 in the window is below ₹2,50,000/);
  });

  it("net base: a ₹20,000 credit note on order 3 → net ₹2,80,000 → 1% = ₹2,800 (collected net)", () => {
    const r = C(deal(APR_MAY_JUN({ cn: { rs: 20_000 } })));
    expect(r.employees[0]!.payablePaise).toBe(RS(2_800));
    expect(r.items[0]!.explanation.join(" ")).toMatch(/less credit note CN 3 ₹20,000 = net ₹80,000/);
  });

  it("one return reaching the engine twice (the same credit note twice, marked as a return twice) is deducted once", () => {
    const d = deal(APR_MAY_JUN({ cn: { rs: 20_000, ret: true } }));
    d.creditNotes = [...d.creditNotes, ...d.creditNotes];
    d.events = [...d.events, { ...d.events[0]!, id: id("c4e", 99) }];
    expect(C(d).employees[0]!.payablePaise).toBe(RS(2_800));
  });

  it("rolling look-back, INCLUSIVE: an order exactly 12 months before (same day) is within it — not new; one day older — new", () => {
    const within = deal([{ n: 9, date: "2025-04-10", rs: 10_000 }, ...APR_MAY_JUN()]);
    const r1 = C(within);
    expect(r1.items).toEqual([]);
    const older = deal([{ n: 9, date: "2025-04-09", rs: 10_000 }, ...APR_MAY_JUN()]);
    expect(C(older).employees[0]!.payablePaise).toBe(RS(3_000));
    // The 12 is a setting: with 13 months, the 9 Apr 2025 order is within again.
    expect(C(older, { "c.newCustomerLookbackMonths": 13 }).items).toEqual([]);
  });

  it("no financial-year boundary: February, April and May orders complete the acquisition in May", () => {
    const d = deal([{ n: 1, date: "2026-02-10", rs: 1_00_000 }, { n: 2, date: "2026-04-10", rs: 1_00_000 }, { n: 3, date: "2026-05-10", rs: 1_00_000 }]);
    expect(C(d, {}, "2026-05-01").employees[0]!.payablePaise).toBe(RS(3_000));
    expect(C(d, {}, "2026-04-01").items).toEqual([]);
  });

  it("a later calculation date never changes who qualified: orders after the turnover window never count", () => {
    const d = deal([{ n: 1, date: "2026-02-10", rs: 1_00_000 }, { n: 2, date: "2026-04-10", rs: 1_00_000 }, { n: 3, date: "2026-05-10", rs: 1_00_000 }, { n: 4, date: "2027-03-01", rs: 5_00_000 }]);
    const early = calculateCategoryX({ ...input("C", d, { "c.minTurnover": RS(3_50_000) }), month: "2026-05-01", asOf: "2027-02-15" });
    const late = calculateCategoryX({ ...input("C", d, { "c.minTurnover": RS(3_50_000) }), month: "2026-05-01", asOf: "2027-12-31" });
    expect(early.items).toEqual([]);
    expect(late.items).toEqual([]);
    expect(said(late)).toMatch(/net turnover ₹3,00,000 in the window is below ₹3,50,000\./);
  });

  it("a fully returned order is excluded (net ₹0, not a transaction); the next order completes the count", () => {
    const d = deal([{ n: 1, date: "2026-04-10", rs: 1_00_000 }, { n: 2, date: "2026-05-10", rs: 1_00_000, cn: { rs: 1_00_000, ret: true } }, { n: 3, date: "2026-06-10", rs: 1_00_000 }, { n: 4, date: "2026-07-10", rs: 1_00_000 }]);
    expect(C(d, {}, "2026-06-01").items).toEqual([]);
    expect(said(C(d, {}, "2026-05-01"))).toMatch(/SO 2 is fully returned or credited \(net ₹0\): not a transaction/);
    const jul = C(d, {}, "2026-07-01");
    expect(jul.employees[0]!.payablePaise).toBe(RS(3_000));
    expect(jul.items[0]!.explanation.join(" ")).toMatch(/First 3 transactions \(SO 1, SO 3, SO 4\)/);
  });

  it("a fully credited invoice is never 'collected on time': only the cash actually received earns", () => {
    // Order 3 has two invoices: one fully credited, one paid 60 days late — it earns 50% on its net ₹50,000.
    const d = deal(APR_MAY_JUN({ rs: 1_00_000 }));
    const o3 = d.orders[2]!;
    d.invoices = d.invoices.filter((i) => i.orderId !== o3.id);
    d.receipts = d.receipts.filter((r) => r.no !== "RC 3.1");
    const a: InvoiceIn = { id: id("c1e", 31), no: "INV 3A", date: o3.date, customerId: CUST, orderId: o3.id, totalPaise: RS(59_000), taxablePaise: RS(50_000), itemsPaise: RS(50_000), dueDate: due(o3.date) };
    const b: InvoiceIn = { ...a, id: id("c1e", 32), no: "INV 3B" };
    d.invoices.push(a, b);
    d.creditNotes.push({ id: id("c3c", 31), no: "CN 3A", date: o3.date, customerId: CUST, invoiceId: a.id, totalPaise: RS(59_000), taxablePaise: RS(50_000), itemsPaise: RS(50_000) });
    d.receipts.push({ id: id("c2f", 32), no: "RC 3B", date: addDays(due(o3.date), 60), customerId: CUST, invoiceId: b.id, amountPaise: RS(59_000) });
    // Net: ₹1,00,000 + ₹1,00,000 + ₹50,000 = ₹2,50,000 → ₹2,500 base; earned ₹1,000 + ₹1,000 + ₹500 × 50% = ₹2,250.
    expect(C(d).employees[0]!.payablePaise).toBe(RS(2_250));
  });

  it("unmatched records are held for review and never counted, and every acquisition they could belong to is held", () => {
    const d = deal([...APR_MAY_JUN(), { n: 5, date: "2026-06-15", rs: 4_00_000, customerId: null }]);
    const stray: InvoiceIn = { id: id("c1e", 40), no: "INV 40", date: "2026-06-12", customerId: CUST, orderId: null, totalPaise: RS(11_800), taxablePaise: RS(10_000), itemsPaise: null, dueDate: null };
    d.invoices.push(stray);
    d.creditNotes.push({ id: id("c3c", 41), no: "CN 41", date: "2026-06-12", customerId: CUST, invoiceId: null, totalPaise: RS(1_180), taxablePaise: RS(1_000), itemsPaise: null });
    d.events.push({ id: id("c4e", 42), kind: "salesReturn", documentId: stray.id, invoiceId: null, amountPaise: null, date: "2026-06-12" });
    const r = C(d);
    expect(r.reviewCases!.map((c) => [c.caseKind, c.documentNo])).toEqual([["credit-note-invoice", "CN 41"], ["invoice-order", "INV 40"], ["order-customer", "SO 5"], ["return-credit-note", "INV 40"]]);
    // The stray invoice and credit note are New Co's: its acquisition is HELD (nothing counted, nothing paid) until decided.
    expect(r.employees).toEqual([]);
    expect(r.held.map((h) => h.message).join(" ")).toMatch(/New customer New Co: held for review — .*INV 40.*CN 41|New customer New Co: held for review — .*CN 41.*INV 40/);
    expect(r.settled).toBe(false);
    // Excluding them by review: exactly the result without them.
    const ex = (kind: "invoice-order" | "credit-note-invoice" | "return-credit-note" | "order-customer", doc: string) => ({ id: id("c5r", kind.length + doc.length), documentId: doc, caseKind: kind, decision: "exclude" as const, targetId: null });
    const decided = C({ ...d, cReviews: [ex("invoice-order", stray.id), ex("credit-note-invoice", id("c3c", 41)), ex("return-credit-note", stray.id), ex("order-customer", d.orders[3]!.id)] });
    expect(decided.employees.map((e) => e.payablePaise)).toEqual([RS(3_000)]);
    // A customer nobody can be credited for: held too.
    const nobody = C(deal(APR_MAY_JUN()), { "attribution.source": "orderSalesperson" });
    expect(nobody.reviewCases!.map((c) => c.caseKind)).toEqual(["customer-salesperson"]);
    expect(nobody.items).toEqual([]);
  });

  it("a historical unlinked order whose Tally party matches holds the acquisition; linking makes the customer existing, excluding removes it; a party that doesn't match changes nothing", () => {
    const history = (party: string) => {
      const d = deal([{ n: 8, date: "2026-01-15", rs: 50_000, customerId: null }, ...APR_MAY_JUN()]);
      d.orders[0] = { ...d.orders[0]!, partyKey: party };
      return { ...d, customerPartyKeys: { [CUST]: ["new co"] } };
    };
    const held = C(history("new co"));
    expect(held.employees).toEqual([]);
    expect(held.reviewCases!.map((c) => [c.caseKind, c.documentNo, c.customerId])).toEqual([["order-customer", "SO 8", CUST]]);
    expect(held.reviewCases![0]!.message).toMatch(/Its Tally party matches New Co/);
    const jan = history("new co").orders[0]!.id;
    // Linked (in any month): it is New Co's own earlier order, so April isn't a new start — the acquisition began in
    // January (SO 8) and its 3rd transaction is May's SO 2: credited in May on SO 8 + SO 1 + SO 2 (₹2,50,000 → ₹2,500).
    const linkedIn = { ...history("new co"), cReviews: [{ id: id("c5r", 1), documentId: jan, caseKind: "order-customer" as const, decision: "link" as const, targetId: CUST }] };
    expect(C(linkedIn).items).toEqual([]);
    const may = C(linkedIn, {}, "2026-05-01");
    expect(may.employees.map((e) => e.payablePaise)).toEqual([RS(2_500)]);
    expect(may.items[0]!.explanation.join(" ")).toMatch(/SO 8 \(2026-01-15\), its first qualifying order.*First 3 transactions \(SO 8, SO 1, SO 2\)/);
    // Excluded: it never counts.
    const excluded = C({ ...history("new co"), cReviews: [{ id: id("c5r", 2), documentId: jan, caseKind: "order-customer", decision: "exclude", targetId: null }] });
    expect(excluded.employees.map((e) => e.payablePaise)).toEqual([RS(3_000)]);
    // A party that doesn't match: proposed to nobody, never linked; New Co is paid as before.
    const other = C(history("someone else"));
    expect(other.employees.map((e) => e.payablePaise)).toEqual([RS(3_000)]);
    expect(other.reviewCases!.map((c) => [c.caseKind, c.customerId])).toEqual([["order-customer", null]]);
  });

  it("unlinked invoices, credit notes and receipts (matching party) are held; an invoice or credit note naming another customer's record is held", () => {
    const base = () => ({ ...deal(APR_MAY_JUN()), customerPartyKeys: { [CUST]: ["new co"] } });
    const a = base();
    a.invoices.push({ id: id("c1e", 50), no: "INV 50", date: "2026-06-20", customerId: null, orderId: null, totalPaise: RS(59_000), taxablePaise: RS(50_000), itemsPaise: null, dueDate: null });
    a.creditNotes.push({ id: id("c3c", 51), no: "CN 51", date: "2026-06-21", customerId: null, invoiceId: null, totalPaise: RS(11_800), taxablePaise: RS(10_000), itemsPaise: null });
    a.receipts.push({ id: id("c2f", 52), no: "RC 52", date: "2026-06-22", customerId: null, invoiceId: null, amountPaise: RS(5_000) });
    const r = C({ ...a, partyKeys: { [id("c1e", 50)]: "new co", [id("c3c", 51)]: "new co", [id("c2f", 52)]: "new co" } });
    expect(r.reviewCases!.map((c) => [c.caseKind, c.documentNo, c.customerId])).toEqual([["credit-note-invoice", "CN 51", CUST], ["invoice-order", "INV 50", CUST], ["receipt-customer", "RC 52", CUST]]);
    expect(r.employees).toEqual([]); // turnover and collection untouched by them; the acquisition waits
    // An invoice naming another customer's Sales Order: held, for both customers.
    const OTHER = id("c0c", 2);
    const b = base();
    b.invoices[2] = { ...b.invoices[2]!, customerId: OTHER };
    const conflict = C(b);
    expect(conflict.reviewCases!.map((c) => c.caseKind)).toEqual(["invoice-order"]);
    expect(conflict.reviewCases![0]!.message).toMatch(/names .*Sales Order SO 3/);
    expect(conflict.employees).toEqual([]);
  });

  it("dates: the window starts at the first QUALIFYING order and ends inclusive and clamp-safe; same-day orders by number", () => {
    expect([windowEndInclusive("2026-06-10", 12), windowEndInclusive("2028-02-29", 12), windowEndInclusive("2026-01-31", 1), windowEndInclusive("2026-03-31", 12)]).toEqual(["2027-06-09", "2029-02-28", "2026-02-28", "2027-03-30"]);
    // 29 Feb 2028 anchor, 2 transactions: an order on 28 Feb 2029 is inside the window, on 1 Mar 2029 it isn't.
    const at = (d: ReturnType<typeof deal>, settings: Record<string, SettingValue>, month: string) => {
      const i = input("C", d, settings);
      return calculateCategoryX({ ...i, month, asOf: "2030-12-31", configVersion: { ...i.configVersion!, effectiveFrom: "2025-01-01" } });
    };
    const two = (second: string) => at(deal([{ n: 1, date: "2028-02-29", rs: 1_50_000 }, { n: 2, date: second, rs: 1_50_000 }]), { "c.requiredTransactions": 2 }, `${second.slice(0, 7)}-01`);
    expect(two("2029-02-28").employees.map((e) => e.payablePaise)).toEqual([RS(3_000)]);
    expect(two("2029-03-01").items).toEqual([]);
    // 31 Jan with a one-month window: 28 Feb is the window's last day (included).
    const one = (second: string) => at(deal([{ n: 1, date: "2026-01-31", rs: 1_50_000 }, { n: 2, date: second, rs: 1_50_000 }]), { "c.requiredTransactions": 2, "c.turnoverWindowMonths": 1 }, `${second.slice(0, 7)}-01`);
    expect(one("2026-02-28").employees.map((e) => e.payablePaise)).toEqual([RS(3_000)]);
    expect(one("2026-03-01").items).toEqual([]);
    // Same day: SO 1 and SO 2 on 10 Apr — SO 1 starts the acquisition, SO 2 is its second transaction.
    const same = C(deal([{ n: 1, date: "2026-04-10", rs: 1_00_000 }, { n: 2, date: "2026-04-10", rs: 1_00_000 }, { n: 3, date: "2026-06-10", rs: 1_00_000 }]));
    expect(same.items[0]!.explanation.join(" ")).toMatch(/SO 1 \(2026-04-10\), its first qualifying order.*First 3 transactions \(SO 1, SO 2, SO 3\)/);
  });

  it("an earlier order not yet invoiced still counts in the look-back; once it is cancelled the next qualifying order starts the acquisition", () => {
    const d = deal(APR_MAY_JUN());
    d.orders.unshift(order(7, "2026-03-01", 1_00_000)); // no invoice: eligible, not qualifying
    const r = C(d);
    expect(r.items).toEqual([]);
    expect(r.excluded.map((x) => x.message).join(" ")).toMatch(/Not a new customer: New Co has earlier order SO 7 \(2026-03-01\)/);
    d.orders[0] = { ...d.orders[0]!, states: { cancelled: true, optional: false, postDated: false } };
    expect(C(d).employees.map((e) => e.payablePaise)).toEqual([RS(3_000)]);
  });

  it("acquisitions never overlap: with a 3-month look-back and a 12-month window, a later order inside the window doesn't start another", () => {
    const d = deal([{ n: 1, date: "2026-01-10", rs: 1_00_000 }, { n: 2, date: "2026-06-10", rs: 1_00_000 }, { n: 3, date: "2026-07-10", rs: 1_00_000 }, { n: 4, date: "2026-08-10", rs: 1_00_000 }, { n: 5, date: "2026-09-10", rs: 1_00_000 }]);
    expect(C(d, { "c.newCustomerLookbackMonths": 3 }, "2026-07-01").employees.map((e) => e.payablePaise)).toEqual([RS(3_000)]);
    expect(C(d, { "c.newCustomerLookbackMonths": 3 }, "2026-09-01").items).toEqual([]);
  });
  it("an admin's review decision links or excludes — and the next calculation applies it; it never awards by itself", () => {
    const d = deal([{ n: 1, date: "2026-04-10", rs: 1_00_000 }, { n: 2, date: "2026-05-10", rs: 1_00_000 }, { n: 3, date: "2026-06-10", rs: 1_00_000, customerId: null }]);
    expect(C(d).items).toEqual([]);
    const linked = C({ ...d, cReviews: [{ id: id("c5r", 1), documentId: d.orders[2]!.id, caseKind: "order-customer", decision: "link", targetId: CUST }] });
    expect(linked.employees[0]!.payablePaise).toBe(RS(3_000));
    const excluded = C({ ...d, cReviews: [{ id: id("c5r", 1), documentId: d.orders[2]!.id, caseKind: "order-customer", decision: "exclude", targetId: null }] });
    expect(excluded.items).toEqual([]);
    expect(excluded.reviewCases).toEqual([]);
    expect(said(excluded)).toMatch(/Sales Order SO 3 is excluded by an admin's review decision/);
  });

  it("the per-customer limit applies per salesperson: a ₹10,000 base split 50/50 → ₹5,000 each (not ₹2,500 each)", () => {
    const d = deal([{ n: 1, date: "2026-04-10", rs: 4_00_000 }, { n: 2, date: "2026-05-10", rs: 3_00_000 }, { n: 3, date: "2026-06-10", rs: 3_00_000 }]);
    d.attributions = [{ documentId: d.orders[0]!.id, employeeId: EMP, sharePpm: 500_000 }, { documentId: d.orders[0]!.id, employeeId: EMP2, sharePpm: 500_000 }];
    const r = C(d, { "attribution.source": "attributionRecord", "attribution.split": "splitByShares", "caps.perOrder": RS(5_000) });
    expect(r.employees.map((e) => [e.employeeId, e.payablePaise])).toEqual([[EMP, RS(5_000)], [EMP2, RS(5_000)]]);
    // With ₹4,000 per salesperson, each share (₹5,000) is limited to ₹4,000.
    expect(C(d, { "attribution.source": "attributionRecord", "attribution.split": "splitByShares", "caps.perOrder": RS(4_000) }).employees.map((e) => e.payablePaise)).toEqual([RS(4_000), RS(4_000)]);
  });

  it("below the smallest amount: the month's total is held (carry forward), nothing released; 'No minimum' releases it; the exact and rounded values agree", () => {
    const below = C(deal(APR_MAY_JUN()), { "payout.minimumPayable": RS(5_000) });
    expect(below.carryModel).toBe(true);
    expect(below.employees[0]).toMatchObject({ earnedPaise: RS(3_000), ownPayablePaise: RS(3_000), payablePaise: 0, payableExact: "0", belowMinimumPaise: RS(3_000), netPaise: RS(3_000), capConsumedPaise: 0, carry: { lots: [], heldPaise: RS(3_000) } });
    expect(below.employees[0]!.limits.join(" ")).toMatch(/The month's total ₹3,000 is below the smallest amount paid in a month \(₹5,000\): nothing is released; it is carried forward/);
    const none = C(deal(APR_MAY_JUN()), { "payout.minimumPayable": "none" });
    expect(none.employees[0]).toMatchObject({ payablePaise: RS(3_000), payableExact: String(RS(3_000)), capConsumedPaise: RS(3_000) });
    expect(C(deal(APR_MAY_JUN()), { "payout.minimumPayable": RS(3_000) }).employees[0]!.payablePaise).toBe(RS(3_000)); // equal is paid
  });

  it("carry-forward: balances from earlier months and the adjustments carried in count towards the month's total; crossing the minimum releases all of it once", () => {
    const carry = (lots: { id: string; month: string; remainingPaise: number }[], adjustmentsPaise = 0) => [{ employeeId: EMP, name: "Rep", lots, adjustmentsPaise }];
    const L1 = { id: id("c6l", 1), month: "2026-04-01", remainingPaise: RS(1_000) };
    const L2 = { id: id("c6l", 2), month: "2026-05-01", remainingPaise: RS(1_500) };
    // ₹3,000 this month + ₹2,500 carried = ₹5,500 ≥ ₹5,000: released, both balances consumed.
    const rel = C({ ...deal(APR_MAY_JUN()), carry: carry([L1, L2]) }, { "payout.minimumPayable": RS(5_000) });
    expect(rel.employees[0]).toMatchObject({ payablePaise: RS(5_500), carriedInPaise: RS(2_500), capConsumedPaise: RS(3_000), carry: { heldPaise: 0, lots: [{ lotId: L1.id, outcome: "released", amountPaise: RS(1_000) }, { lotId: L2.id, outcome: "released", amountPaise: RS(1_500) }] } });
    // An adjustment carried in counts too (the minimum is on the month's total): ₹3,000 + ₹2,000 = ₹5,000.
    expect(C({ ...deal(APR_MAY_JUN()), carry: carry([], RS(2_000)) }, { "payout.minimumPayable": RS(5_000) }).employees[0]!.payablePaise).toBe(RS(5_000));
    // A month with nothing of its own: only its balances (a salesperson present only through the carry).
    const only = C({ ...deal([]), carry: carry([L1]) }, { "payout.minimumPayable": RS(500) });
    expect(only.employees).toEqual([expect.objectContaining({ employeeId: EMP, ownPayablePaise: 0, payablePaise: RS(1_000) })]);
    // Still below: the balances stay carried, this month is held as a new balance.
    const still = C({ ...deal(APR_MAY_JUN()), carry: carry([L1]) }, { "payout.minimumPayable": RS(10_000) });
    expect(still.employees[0]).toMatchObject({ payablePaise: 0, belowMinimumPaise: RS(4_000), carry: { heldPaise: RS(3_000), lots: [{ lotId: L1.id, outcome: "carried", amountPaise: RS(1_000) }] } });
    // A recovery is offset against the oldest balances first.
    const rec = C({ ...deal([]), carry: carry([L1, L2], -RS(1_200)) }, { "payout.minimumPayable": RS(5_000) });
    expect(rec.employees[0]!.carry).toEqual({ heldPaise: 0, lots: [{ lotId: L1.id, month: L1.month, amountPaise: RS(1_000), outcome: "offset" }, { lotId: L2.id, month: L2.month, amountPaise: RS(200), outcome: "offset" }, { lotId: L2.id, month: L2.month, amountPaise: RS(1_300), outcome: "carried" }] });
    // A recovery larger than the balances: everything offset, the negative remainder carried at lock as configured.
    const neg = C({ ...deal([]), carry: carry([L1], -RS(3_000)) }, { "payout.minimumPayable": RS(5_000) });
    expect(neg.employees[0]).toMatchObject({ payablePaise: 0, netPaise: -RS(2_000), carry: { heldPaise: 0, lots: [{ outcome: "offset", amountPaise: RS(1_000) }] } });
  });

  it("expiry: 'never' by default; after the configured months a balance expires (recorded, not counted); 'Not released' expires at once", () => {
    const carry = [{ employeeId: EMP, name: "Rep", lots: [{ id: id("c6l", 3), month: "2026-01-01", remainingPaise: RS(2_500) }], adjustmentsPaise: 0 }];
    expect(C({ ...deal(APR_MAY_JUN()), carry }, { "payout.minimumPayable": RS(5_000) }).employees[0]!.payablePaise).toBe(RS(5_500)); // never expires
    const exp = C({ ...deal(APR_MAY_JUN()), carry }, { "payout.minimumPayable": RS(5_000), "payout.carryForwardExpiry": "afterMonths", "payout.carryForwardExpiryMonths": 3 });
    expect(exp.employees[0]).toMatchObject({ payablePaise: 0, carry: { heldPaise: RS(3_000), lots: [{ outcome: "expired", amountPaise: RS(2_500) }] } });
    expect(exp.employees[0]!.limits.join(" ")).toMatch(/Carried forward from 2026-01: ₹2,500 expired — still unreleased after 3 months \(recorded\)/);
    const nr = C(deal(APR_MAY_JUN()), { "payout.minimumPayable": RS(5_000), "payout.belowMinimum": "notReleased" });
    expect(nr.employees[0]!.carry).toEqual({ heldPaise: RS(3_000), heldExpires: true, lots: [] });
  });
  it("a carry-model row stores earned = what the month has available, exact and rounded alike (its own figures beside it)", () => {
    const carry = [{ employeeId: EMP, name: "Rep", lots: [{ id: id("c6l", 7), month: "2026-04-01", remainingPaise: RS(1_000) }], adjustmentsPaise: RS(500) }];
    const r = C({ ...deal(APR_MAY_JUN()), carry }, { "payout.minimumPayable": RS(10_000) });
    const e = r.employees[0]!;
    expect(e).toMatchObject({ earnedPaise: RS(4_500), ownEarnedPaise: RS(3_000), payablePaise: 0, pendingPaise: RS(4_500) });
    expect(e.earnedExact).toBe(String(RS(4_500)));
    expect(e.ownEarnedExact).toBe(String(RS(3_000)));
    const rel = C({ ...deal(APR_MAY_JUN()), carry }, { "payout.minimumPayable": RS(4_000) }).employees[0]!;
    expect([rel.earnedExact, rel.payableExact]).toEqual([String(RS(4_500)), String(RS(4_500))]);
  });

  it("one balance can be partly OFFSET and the rest EXPIRED in the same month ('Not released'): two uses, never more than remains", () => {
    const L = { id: id("c6l", 8), month: "2026-04-01", remainingPaise: RS(3_000) };
    const r = C({ ...deal([]), carry: [{ employeeId: EMP, name: "Rep", lots: [L], adjustmentsPaise: -RS(1_000) }] }, { "payout.minimumPayable": RS(5_000), "payout.belowMinimum": "notReleased" });
    expect(r.employees[0]!.carry!.lots).toEqual([
      { lotId: L.id, month: L.month, amountPaise: RS(1_000), outcome: "offset" },
      { lotId: L.id, month: L.month, amountPaise: RS(2_000), outcome: "expired" },
    ]);
  });

  it("a held balance keeps the rules it was HELD under; the month's own settings govern only its new earnings", () => {
    const lot = (n: number, rules?: { belowMinimum: "carryForward" | "notReleased"; expiry: "never" | "afterMonths"; expiryMonths: number | null }) => ({ id: id("c7l", n), month: "2026-01-01", remainingPaise: RS(2_000), ...(rules ? { rules } : {}) });
    const carry = (l: ReturnType<typeof lot>) => [{ employeeId: EMP, name: "Rep", lots: [l], adjustmentsPaise: 0 }];
    const never = { belowMinimum: "carryForward" as const, expiry: "never" as const, expiryMonths: null };
    const after3 = { belowMinimum: "carryForward" as const, expiry: "afterMonths" as const, expiryMonths: 3 };
    // Held under "never expires"; June's version now says "after 3 months": it does NOT expire.
    const kept = C({ ...deal(APR_MAY_JUN()), carry: carry(lot(1, never)) }, { "payout.minimumPayable": RS(10_000), "payout.carryForwardExpiry": "afterMonths", "payout.carryForwardExpiryMonths": 3 });
    expect(kept.employees[0]!.carry!.lots).toEqual([{ lotId: id("c7l", 1), month: "2026-01-01", amountPaise: RS(2_000), outcome: "carried" }]);
    expect(kept.employees[0]!.belowMinimumPaise).toBe(RS(5_000)); // counted: 3,000 + 2,000
    // Held under "after 3 months"; June's version now says "never": it DOES expire (5 months on), with its own rule named.
    const gone = C({ ...deal(APR_MAY_JUN()), carry: carry(lot(2, after3)) }, { "payout.minimumPayable": RS(10_000), "payout.carryForwardExpiry": "never" });
    expect(gone.employees[0]!.carry!.lots).toEqual([{ lotId: id("c7l", 2), month: "2026-01-01", amountPaise: RS(2_000), outcome: "expired" }]);
    expect(gone.employees[0]!.limits.join(" ")).toMatch(/expired — still unreleased after 3 months \(the rule it was held under\)/);
    // June's version now says "Not released": the earlier balance (held to be carried) stays carried; only June's own
    // below-minimum amount is not released.
    const nr = C({ ...deal(APR_MAY_JUN()), carry: carry(lot(3, never)) }, { "payout.minimumPayable": RS(10_000), "payout.belowMinimum": "notReleased" });
    expect(nr.employees[0]!.carry).toEqual({ heldPaise: RS(3_000), heldExpires: true, lots: [{ lotId: id("c7l", 3), month: "2026-01-01", amountPaise: RS(2_000), outcome: "carried" }] });
    // An input recorded before balances carried their rules is reproduced exactly as it was calculated (the month's settings).
    const legacy = C({ ...deal(APR_MAY_JUN()), carry: carry(lot(4)) }, { "payout.minimumPayable": RS(10_000), "payout.carryForwardExpiry": "afterMonths", "payout.carryForwardExpiryMonths": 3 });
    expect(legacy.employees[0]!.carry!.lots[0]!.outcome).toBe("expired");
    // The rules are part of the input: the same balance under different rules hashes differently (no silent reuse).
    expect(inputsHashX({ ...input("C"), carry: carry(lot(5, never)) })).not.toBe(inputsHashX({ ...input("C"), carry: carry(lot(5, after3)) }));
  });

  it("an invoice naming a Sales Order that isn't in Forms is an invoice-order case and holds the acquisition; one naming a CANCELLED order is not a case", () => {
    const d = deal(APR_MAY_JUN());
    const ghost = { ...d.invoices[2]!, id: id("c1e", 90), no: "INV 90", orderId: id("c50", 999) };
    const r = C({ ...d, invoices: [...d.invoices, ghost] });
    expect(r.reviewCases).toEqual([expect.objectContaining({ caseKind: "invoice-order", documentNo: "INV 90", customerId: CUST })]);
    expect(said(r)).toMatch(/Invoice INV 90 \(2026-06-10\) names a Sales Order that isn't in Forms: held for review/);
    expect(r.items).toEqual([]);
    // The same invoice naming a cancelled order: left out with it, no case, the acquisition stands.
    const cancelled = { ...order(999, "2026-06-12", 50_000), states: { cancelled: true, optional: false, postDated: false } };
    const ok = C({ ...d, orders: [...d.orders, cancelled], invoices: [...d.invoices, ghost] });
    expect(ok.reviewCases).toEqual([]);
    expect(ok.employees[0]!.payablePaise).toBe(RS(3_000));
  });

  it("references the loader couldn't follow to the end hold the customers they touch — every customer when none can be named (fail-closed)", () => {
    const d = deal(APR_MAY_JUN());
    const mine = C({ ...d, incompleteReferences: { documentIds: [id("c9d", 1)], customerIds: [CUST] } });
    expect(mine.items).toEqual([]);
    expect(mine.settled).toBe(false);
    expect(said(mine)).toMatch(/New customer New Co: held — Forms' linked records \(1 not followed\) go further than the calculation follows/);
    expect(C({ ...d, incompleteReferences: { documentIds: [id("c9d", 1)], customerIds: [] } }).items).toEqual([]);
    expect(C({ ...d, incompleteReferences: { documentIds: [id("c9d", 1)], customerIds: [id("c0c", 77)] } }).employees[0]!.payablePaise).toBe(RS(3_000));
  });

  it("missing configuration blocks: no minimum-payable choice, no turnover window", () => {
    const base = input("C", deal(APR_MAY_JUN()));
    const { "payout.minimumPayable": _m, ...noMin } = base.config!.settings;
    const r = calculateCategoryX({ ...base, month: "2026-06-01", config: { ...base.config!, settings: noMin } });
    expect(r.status).toBe("blocked");
    expect(r.problems.join(" ")).toMatch(/Smallest amount paid in a month/);
    const { "c.turnoverWindowMonths": _w, ...noWin } = base.config!.settings;
    expect(calculateCategoryX({ ...base, month: "2026-06-01", config: { ...base.config!, settings: noWin } }).problems.join(" ")).toMatch(/Turnover window/);
  });

  it("is deterministic", () => {
    const a = { ...input("C", deal(APR_MAY_JUN({ pay: [[0.5, 0], [1, 60]] }))), month: "2026-06-01" };
    const b = { ...a, orders: [...a.orders!].reverse(), invoices: [...a.invoices!].reverse(), receipts: [...a.receipts!].reverse() };
    expect(inputsHashX(b)).toBe(inputsHashX(a));
    expect(resultHashX(calculateCategoryX(b))).toBe(resultHashX(calculateCategoryX(a)));
  });
});

describe("D · leads and enquiries", () => {
  const batches = [
    { id: id("d0b", 1), employeeId: EMP, periodMonth: "2026-06", leadCount: 25, profiled: true, approved: true },
    { id: id("d0b", 2), employeeId: EMP, periodMonth: "2026-06", leadCount: 9, profiled: true, approved: true },
    { id: id("d0b", 3), employeeId: EMP, periodMonth: "2026-06", leadCount: 40, profiled: false, approved: true },
    { id: id("d0b", 4), employeeId: EMP, periodMonth: "2026-06", leadCount: 40, profiled: true, approved: false },
  ];
  const conversions = [{ id: id("d0c", 1), employeeId: EMP2, periodMonth: "2026-06", convertedCount: 11, approved: true }];
  it("per submission: 25 → 2 × ₹250; 9 → nothing; unprofiled and unapproved left out; 11 enquiries → 2 × ₹250", () => {
    const r = calculateCategoryX(input("D", { leadBatches: batches, leadConversions: conversions }));
    expect(r.employees.map((e) => [e.employeeId, e.payablePaise])).toEqual([[EMP, RS(500)], [EMP2, RS(500)]]);
    expect(r.excluded.map((x) => x.message).join(" ")).toMatch(/not marked as profiled.*|fewer than 10/s);
  });
  it("per month: 25 + 9 = 34 → 3 × ₹250", () => {
    expect(calculateCategoryX(input("D", { leadBatches: batches, leadConversions: [] }, { "d.unitCounting": "perMonth" })).employees[0]!.payablePaise).toBe(RS(750));
  });
  it("the monthly limit (TEST ₹1,000)", () => {
    const many = Array.from({ length: 6 }, (_, i) => ({ id: id("d1b", i), employeeId: EMP, periodMonth: "2026-06", leadCount: 10, profiled: true, approved: true }));
    expect(calculateCategoryX(input("D", { leadBatches: many }, { "caps.perEmployeeCategoryMonth": RS(1_000) })).employees[0]).toMatchObject({ payablePaise: RS(1_000) });
  });
});

describe("E · client meetings", () => {
  it("the admin's award kept within ₹250–₹1,000; an unapproved or unawarded meeting is left out", () => {
    const meetings = [
      { id: id("e0m", 1), employeeId: EMP, periodMonth: "2026-06", awardedPaise: RS(1_500), approved: true, label: "Meeting 1" },
      { id: id("e0m", 2), employeeId: EMP, periodMonth: "2026-06", awardedPaise: RS(100), approved: true, label: "Meeting 2" },
      { id: id("e0m", 3), employeeId: EMP, periodMonth: "2026-06", awardedPaise: RS(500), approved: false, label: "Meeting 3" },
      { id: id("e0m", 4), employeeId: EMP, periodMonth: "2026-06", awardedPaise: null, approved: true, label: "Meeting 4" },
    ];
    const r = calculateCategoryX(input("E", { meetings }));
    expect(r.items.map((i) => i.payableExact)).toEqual([String(RS(1_000)), String(RS(250))]);
    expect(r.excluded).toHaveLength(2);
  });
  it("the largest award is the configured e.maxAward, nothing fixed: ₹1,500 is kept whole under a ₹2,000 maximum, ₹1,000 under ₹1,000", () => {
    const meetings = [{ id: id("e0m", 1), employeeId: EMP, periodMonth: "2026-06", awardedPaise: RS(1_500), approved: true, label: "Meeting 1" }];
    expect(calculateCategoryX(input("E", { meetings }, { "e.maxAward": RS(2_000) })).employees[0]!.payablePaise).toBe(RS(1_500));
    expect(calculateCategoryX(input("E", { meetings }, { "e.maxAward": RS(1_000) })).employees[0]!.payablePaise).toBe(RS(1_000));
  });
});

describe("F · reviews and testimonials", () => {
  const t = (n: number, kind: "google_review" | "email" | "letterhead", over: Partial<{ wordCount: number; starRating: number | null; hasEvidence: boolean; namesTeamMember: boolean; approved: boolean }> = {}) => ({ id: id("f0t", n), employeeId: EMP, periodMonth: "2026-06", kind, wordCount: 60, starRating: 5, hasEvidence: true, namesTeamMember: false, approved: true, ...over });
  it("Google ₹100, email ₹100, letterhead ₹150 × 2 when named; short, four-star or evidence-less reviews are left out", () => {
    const r = calculateCategoryX(input("F", { testimonials: [t(1, "google_review"), t(2, "email"), t(3, "letterhead", { namesTeamMember: true }), t(4, "google_review", { wordCount: 30 }), t(5, "google_review", { starRating: 4 }), t(6, "google_review", { hasEvidence: false })] }));
    expect(r.employees[0]!.payablePaise).toBe(RS(100 + 100 + 300));
    expect(r.excluded.map((x) => x.message)).toEqual(expect.arrayContaining([expect.stringMatching(/30 words/), expect.stringMatching(/five-star/), expect.stringMatching(/screenshot/)]));
  });
  it("f.googleFiveStarOnly decides: \"no\" credits a four-star review, \"yes\" leaves it out", () => {
    const four = [t(1, "google_review", { starRating: 4 })];
    expect(calculateCategoryX(input("F", { testimonials: four }, { "f.googleFiveStarOnly": "no" })).employees[0]!.payablePaise).toBe(RS(100));
    expect(calculateCategoryX(input("F", { testimonials: four }, { "f.googleFiveStarOnly": "yes" })).employees[0]?.payablePaise ?? 0).toBe(0);
  });
});

describe("G · consecutive monthly purchases (proposed structure, TEST values)", () => {
  const months = (list: [string, number][]) => list.map(([d, v], i) => order(100 + i, d, v));
  it("3 consecutive months of at least ₹50,000 earn the reward in the 3rd; the count starts again", () => {
    const orders = months([["2026-04-05", 60_000], ["2026-05-05", 60_000], ["2026-06-05", 60_000], ["2026-07-05", 60_000]]);
    expect(calculateCategoryX(input("G", { orders, repHistory: [], attributions: [] })).items).toEqual([expect.objectContaining({ lineCode: "G.1", payableExact: String(RS(500)) })]);
    expect(calculateCategoryX({ ...input("G", { orders, repHistory: [], attributions: [] }), month: "2026-07-01" }).items).toEqual([]);
    expect(calculateCategoryX({ ...input("G", { orders, repHistory: [], attributions: [] }, { "g.afterReward": "everyFurtherMonth" }), month: "2026-07-01" }).items).toHaveLength(1);
  });
  it("a month below the minimum breaks the run", () => {
    const orders = months([["2026-04-05", 60_000], ["2026-05-05", 10_000], ["2026-06-05", 60_000]]);
    expect(calculateCategoryX(input("G", { orders, repHistory: [], attributions: [] })).items).toEqual([]);
  });
  it("with nothing decided, Category G can't be calculated: every value is required", () => {
    const c = completeConfig({}, elig, "G");
    const r = calculateCategoryX({ ...input("G"), config: { ...c, settings: {} } });
    expect(r.status).toBe("blocked");
    expect(r.problems.join(" ")).toMatch(/Consecutive months of purchases .*isn't set/);
  });
});
