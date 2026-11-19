import { describe, expect, it } from "vitest";
import { calculateCategoryB } from "@/lib/incentives/category-b/engine";
import { inputsHashB, resultHashB } from "@/lib/incentives/category-b/hash";
import type { CategoryBInput, QualificationResult } from "@/lib/incentives/category-b/types";
import { allCategoriesAllowance } from "@/lib/incentives/shared/all-categories";
import { monthsBefore } from "@/lib/incentives/shared/dates";
import { bInput, creditNote, CUST_B, EMP_B, HISTORY, invoice, order, P, receipt, RS, so, inv, cnId, rc } from "../fixtures/category-b";

// Category B — the pure engine, on SYNTHETIC test data (fixtures/category-b.ts): TEST rate 1%, TEST per-order limit
// ₹1,500, TEST monthly limit ₹5,000, minimum ₹1,00,000. Delay steps (Category A's reference): 0–45 days 100%, 45–75 50%,
// 75–100 25%, after 100 nil, counted from the invoice's due date (invoice date + 30 days).
const run = (i: CategoryBInput) => calculateCategoryB(i);
const q = (i: CategoryBInput, n = 1): QualificationResult | undefined => run(i).qualifications.find((x) => x.orderId === so(n));
const pay = (i: CategoryBInput) => run(i).employees.find((e) => e.employeeId === EMP_B);

describe("a qualifying order — exact arithmetic", () => {
  it("existing customer, new product and brand, ₹1,20,000 invoice paid on time: 1% × ₹1,20,000 = ₹1,200.00", () => {
    const r = run(bInput());
    expect(r.status).toBe("computed");
    const x = r.qualifications[0]!;
    expect([x.orderNo, x.automatic, x.outcome, x.invoiceNo, x.invoiceMonth, x.netTaxablePaise, x.baseExact]).toEqual(["SO 1", "qualified", "qualified", "INV 1", "2026-04-01", RS(1_20_000), String(RS(1_200))]);
    expect(x.evidence.earlierOrders.map((o) => o.no)).toEqual(["SO 100"]);
    expect(x.evidence.newProducts).toEqual(["Motor"]);
    expect(x.evidence.newBrands).toEqual(["Beta"]);
    expect(pay(bInput())).toMatchObject({ earnedPaise: RS(1_200), payablePaise: RS(1_200), pendingPaise: 0, ordersCredited: 1, salesPaise: RS(1_20_000) });
    expect(r.units).toHaveLength(1);
    expect(r.pieces.filter((p) => p.status === "credited").map((p) => [p.delayDays, p.multiplierPpm])).toEqual([[0, 1_000_000]]);
  });
  it("is deterministic: the input in any order gives the same hashes", () => {
    const a = bInput();
    const b = { ...a, orders: [...a.orders].reverse(), products: [...a.products].reverse(), customers: [...a.customers].reverse() };
    expect(inputsHashB(b)).toBe(inputsHashB(a));
    expect(resultHashB(run(b))).toBe(resultHashB(run(a)));
  });
});

describe("existing customer (look back, earlier orders)", () => {
  it("a customer with no earlier order is new, not Category B", () => {
    const x = q(bInput({ orders: [order(1, "2026-04-02", [P.motor])] }))!;
    expect([x.automatic, x.outcome]).toEqual(["not-qualified", "not-qualified"]);
    expect(x.reasons.join(" ")).toMatch(/Not an existing customer: no earlier eligible Sales Order of Customer B in the 24 months before 2026-04-02/);
    expect(pay(bInput({ orders: [order(1, "2026-04-02", [P.motor])] }))).toBeUndefined();
  });
  it("the look back is inclusive of the day exactly 24 months before, and not a day more", () => {
    expect(monthsBefore("2026-04-02", 24)).toBe("2024-04-02");
    expect(q(bInput({ orders: [order(100, "2024-04-02", [P.drive]), order(1, "2026-04-02", [P.motor])] }))!.outcome).toBe("qualified");
    expect(q(bInput({ orders: [order(100, "2024-04-01", [P.drive]), order(1, "2026-04-02", [P.motor])] }))!.outcome).toBe("not-qualified");
    // A configured 30-month look back finds it.
    expect(q(bInput({ orders: [order(100, "2024-04-01", [P.drive]), order(1, "2026-04-02", [P.motor])] }, { "b.existingLookbackMonths": 30 }))!.outcome).toBe("qualified");
  });
  it("same-day orders: an earlier voucher number counts, a later one doesn't, and an order is never its own history", () => {
    const same = (n: number) => order(n, "2026-04-02", [P.drive]);
    expect(q(bInput({ orders: [same(0), order(1, "2026-04-02", [P.motor])] }))!.outcome).toBe("qualified"); // SO 0 before SO 1
    expect(q(bInput({ orders: [same(2), order(1, "2026-04-02", [P.motor])] }))!.outcome).toBe("not-qualified"); // SO 2 after SO 1
  });
  it("cancelled earlier orders never count; optional ones only as \"Orders left out\" says", () => {
    const cancelled = { ...HISTORY, states: { cancelled: true, optional: false, postDated: false } };
    expect(q(bInput({ orders: [cancelled, order(1, "2026-04-02", [P.motor])] }))!.outcome).toBe("not-qualified");
    const optional = { ...HISTORY, states: { cancelled: false, optional: true, postDated: false } };
    expect(q(bInput({ orders: [optional, order(1, "2026-04-02", [P.motor])] }))!.outcome).toBe("qualified");
    expect(q(bInput({ orders: [optional, order(1, "2026-04-02", [P.motor])] }, { "basis.voucherFilter": ["cancelled", "optional"] }))!.outcome).toBe("not-qualified");
  });
  it("a cancelled order itself is left out, even with a manual decision", () => {
    const i = bInput({ orders: [HISTORY, order(1, "2026-04-02", [P.motor], { states: { cancelled: true, optional: false, postDated: false } })], overrides: [{ id: "00000000-0000-4000-8000-00000000f001", orderId: so(1), decision: "qualify", reason: "test", byId: null, byName: "Admin" }] });
    expect(q(i)!.outcome).toBe("not-qualified");
    expect(q(i)!.reasons.join(" ")).toMatch(/Left out: the order is cancelled/);
  });
});

describe("new product OR new brand", () => {
  it("a product already bought is not new; its brand isn't either", () => {
    const x = q(bInput({ orders: [HISTORY, order(1, "2026-04-02", [P.drive])] }))!;
    expect(x.outcome).toBe("not-qualified");
    expect(x.reasons.join(" ")).toMatch(/No new product or brand/);
  });
  it("a new product of a brand already bought qualifies (new product)", () => {
    const x = q(bInput({ orders: [HISTORY, order(1, "2026-04-02", [P.gearbox])] }))!;
    expect([x.outcome, x.evidence.newProducts, x.evidence.newBrands]).toEqual(["qualified", ["Gearbox"], []]);
  });
  it("a genuinely new product qualifies even with no brand", () => {
    expect(q(bInput({ orders: [HISTORY, order(1, "2026-04-02", [P.coupling])] }))!.outcome).toBe("qualified");
  });
  it("the novelty window can have its own length", () => {
    // The Drive was bought 10 Jun 2025; with a 6-month novelty window it counts as new again.
    expect(q(bInput({ orders: [HISTORY, order(1, "2026-04-02", [P.drive])] }, { "b.noveltyWindow": "own", "b.noveltyLookbackMonths": 6 }))!.outcome).toBe("qualified");
  });
  it("an unmatched line is never treated as new: review — unless another line is certainly new", () => {
    const review = q(bInput({ orders: [HISTORY, order(1, "2026-04-02", [P.drive, null])] }))!;
    expect([review.automatic, review.outcome, review.evidence.unmatchedLines]).toEqual(["needs-review", "needs-review", ["Unmatched item 2"]]);
    expect(review.reasons.join(" ")).toMatch(/never treated as new/);
    expect(q(bInput({ orders: [HISTORY, order(1, "2026-04-02", [P.motor, null])] }))!.outcome).toBe("qualified");
  });
  it("an unmatched line in the earlier orders makes a \"new\" product uncertain: review", () => {
    const x = q(bInput({ orders: [order(100, "2025-06-10", [P.drive, null]), order(1, "2026-04-02", [P.motor])] }))!;
    expect(x.outcome).toBe("needs-review");
    expect(x.reasons.join(" ")).toMatch(/Can't be decided automatically: Motor is new unless one of the earlier unmatched lines was it/);
  });
  it("an order with no item lines needs review", () => {
    expect(q(bInput({ orders: [HISTORY, order(1, "2026-04-02", [])] }))!.outcome).toBe("needs-review");
  });
});

describe("unmatched customer records", () => {
  it("an order whose party isn't linked to the Customer Master needs review", () => {
    const x = q(bInput({ orders: [HISTORY, order(1, "2026-04-02", [P.motor], { customerId: null })] }))!;
    expect(x.outcome).toBe("needs-review");
    expect(x.reasons.join(" ")).toMatch(/isn't linked to the Customer Master/);
  });
  it("earlier orders of the same party not linked to the master: review, not \"new customer\"", () => {
    const x = q(bInput({ orders: [{ ...HISTORY, customerId: null }, order(1, "2026-04-02", [P.motor])] }))!;
    expect(x.outcome).toBe("needs-review");
    expect(x.reasons.join(" ")).toMatch(/SO 100 isn't linked to the Customer Master/);
  });
  it("an invoice of the month with no Sales Order is never qualified or ignored: it needs review", () => {
    const r = run(bInput({ invoices: [invoice(1, 1, "2026-04-05", 1_20_000), invoice(9, null, "2026-04-20", 2_00_000)] }));
    expect(r.reviewInvoices.map((x) => x.invoiceNo)).toEqual(["INV 9"]);
    expect(r.reviewInvoices[0]!.reason).toMatch(/names no Sales Order/);
    expect(r.excluded.some((n) => n.documentNo === "INV 9")).toBe(true);
  });
});

describe("the qualifying invoice: first individual invoice of at least the minimum, once per order", () => {
  it("exactly ₹1,00,000 qualifies; ₹99,999.99 doesn't", () => {
    expect(q(bInput({ invoices: [invoice(1, 1, "2026-04-05", 1_00_000)] }))!.outcome).toBe("qualified");
    expect(q(bInput({ invoices: [invoice(1, 1, "2026-04-05", 99_999.99)] }))!.outcome).toBe("not-qualified");
  });
  it("invoices are never added together: two of ₹60,000 don't qualify", () => {
    const x = q(bInput({ invoices: [invoice(1, 1, "2026-04-05", 60_000), invoice(2, 1, "2026-04-20", 60_000)] }))!;
    expect(x.outcome).toBe("not-qualified");
    expect(x.reasons.join(" ")).toMatch(/never added together/);
  });
  it("the first below and the second above: the second qualifies, in ITS month", () => {
    const i = bInput({ invoices: [invoice(1, 1, "2026-04-05", 60_000), invoice(2, 1, "2026-05-10", 1_50_000)], receipts: [receipt(2, 2, "2026-06-01", RS(1_77_000))] });
    expect(run(i).qualifications.find((x) => x.orderId === so(1))).toBeUndefined(); // not April's
    const may = run({ ...i, month: "2026-05-01", configVersion: { ...i.configVersion!, effectiveFrom: "2026-04-01" } });
    expect(may.qualifications[0]).toMatchObject({ invoiceNo: "INV 2", invoiceMonth: "2026-05-01", outcome: "qualified" });
    expect(may.employees[0]).toMatchObject({ payablePaise: RS(1_500) }); // 1% × ₹1,50,000 = ₹1,500 (the TEST limit exactly)
  });
  it("two above the minimum: only the first, once", () => {
    const i = bInput({ invoices: [invoice(1, 1, "2026-04-05", 1_20_000), invoice(2, 1, "2026-04-25", 1_30_000)], receipts: [receipt(1, 1, "2026-05-01", RS(1_41_600)), receipt(2, 2, "2026-05-01", RS(1_53_400))] });
    const r = run(i);
    expect(r.qualifications.map((x) => x.invoiceNo)).toEqual(["INV 1"]);
    expect(r.employees[0]!.payablePaise).toBe(RS(1_200));
  });
  it("the month is the qualifying invoice's date, not the order's", () => {
    const i = bInput({ orders: [HISTORY, order(1, "2026-03-28", [P.motor])] });
    expect(q(i)).toMatchObject({ orderDate: "2026-03-28", invoiceMonth: "2026-04-01", inMonth: true });
  });
  it("an invoice with no taxable value can't be compared: review", () => {
    expect(q(bInput({ invoices: [invoice(1, 1, "2026-04-05", 1_20_000, { taxablePaise: null })] }))!.outcome).toBe("needs-review");
  });
});

describe("credit notes and returns", () => {
  it("before payout, a credit note taking the invoice below the minimum reassesses it: the next invoice qualifies", () => {
    const i = bInput({ invoices: [invoice(1, 1, "2026-04-05", 1_20_000), invoice(2, 1, "2026-05-10", 1_10_000)], creditNotes: [creditNote(1, 1, "2026-04-20", 30_000)] });
    expect(q(i)).toBeUndefined(); // INV 1 is now ₹90,000: April has nothing for SO 1
    const may = run({ ...i, month: "2026-05-01" });
    expect(may.qualifications[0]).toMatchObject({ invoiceNo: "INV 2", outcome: "qualified" });
  });
  it("a credit note keeping it above the minimum reduces the amount: 1% × (₹1,20,000 − ₹10,000) = ₹1,100", () => {
    const i = bInput({ creditNotes: [creditNote(1, 1, "2026-04-20", 10_000)], receipts: [receipt(1, 1, "2026-05-01", RS(1_10_000 * 1.18))] });
    expect(q(i)).toMatchObject({ netTaxablePaise: RS(1_10_000), baseExact: String(RS(1_100)) });
    expect(pay(i)!.payablePaise).toBe(RS(1_100));
  });
  it("after payout the invoice stays fixed: below the minimum the whole amount goes (recovered), above it the difference", () => {
    const earned = [{ orderId: so(1), invoiceId: inv(1), month: "2026-04-01" }];
    const below = bInput({ earned, invoices: [invoice(1, 1, "2026-04-05", 1_20_000), invoice(2, 1, "2026-05-10", 1_10_000)], creditNotes: [creditNote(1, 1, "2026-06-20", 30_000)] });
    const x = q(below)!;
    expect([x.pinned, x.invoiceNo, x.baseExact]).toEqual([true, "INV 1", "0"]);
    expect(x.reasons.join(" ")).toMatch(/whole Category B paid on it is recovered/);
    expect(run({ ...below, month: "2026-05-01" }).qualifications).toEqual([]); // INV 2 never qualifies: SO 1 already earned
    const above = bInput({ earned, creditNotes: [creditNote(1, 1, "2026-06-20", 10_000)] });
    expect(q(above)!.baseExact).toBe(String(RS(1_100)));
  });
  it("a sales return is a credit note, or ignored, as \"Sales returns\" says", () => {
    const events = [{ id: "00000000-0000-4000-8000-00000000e001", kind: "salesReturn" as const, documentId: cnId(1), invoiceId: null, amountPaise: null, date: "2026-04-21" }];
    const i = (rule: string) => bInput({ creditNotes: [creditNote(1, 1, "2026-04-20", 30_000)], events }, { "b.salesReturns": rule });
    // As a credit note: INV 1 is ₹90,000 after it, below the minimum, and there is no other invoice.
    expect(q(i("asCreditNote"))!.outcome).toBe("not-qualified");
    expect(q(i("ignore"))!.outcome).toBe("qualified");
  });
});

describe("collection: fully collected only, each receipt at its own delay", () => {
  it("part-paid: earned but not payable", () => {
    const e = pay(bInput({ receipts: [receipt(1, 1, "2026-05-01", RS(70_800))] }))!;
    expect(e).toMatchObject({ earnedPaise: RS(600), payablePaise: 0, pendingPaise: RS(600) });
  });
  it("half on time, half 60 days late (50%): ₹600 + ₹300 = ₹900", () => {
    // Due 5 May. RC 1 on 1 May (on time, 100%); RC 2 on 4 Jul (60 days after due: 50%).
    const e = pay(bInput({ receipts: [receipt(1, 1, "2026-05-01", RS(70_800)), receipt(2, 1, "2026-07-04", RS(70_800))] }))!;
    expect(e).toMatchObject({ earnedPaise: RS(900), payablePaise: RS(900) });
  });
  it("the per-order limit applies BEFORE decay: 1% × ₹2,00,000 = ₹2,000 → ₹1,500, paid 50 days late (50%) → ₹750", () => {
    const i = bInput({ invoices: [invoice(1, 1, "2026-04-05", 2_00_000)], receipts: [receipt(1, 1, "2026-06-24", RS(2_36_000))] });
    expect(q(i)!.baseExact).toBe(String(RS(1_500)));
    expect(pay(i)!.payablePaise).toBe(RS(750));
  });
  it("a bounced receipt earns nothing and leaves the invoice uncollected", () => {
    const i = bInput({ events: [{ id: "00000000-0000-4000-8000-00000000e002", kind: "bounced", documentId: rc(1), invoiceId: null, amountPaise: null, date: "2026-05-03" }] });
    expect(pay(i)).toMatchObject({ earnedPaise: 0, payablePaise: 0 });
  });
});

describe("limits", () => {
  // Five existing customers of the same salesperson, each buying a Motor (new to them) for ₹1,50,000 → ₹1,500 each.
  const five = () => {
    const cust = (n: number) => `00000000-0000-4000-8000-00000000c${String(n).padStart(3, "0")}`;
    const customers = [1, 2, 3, 4, 5].map((n) => ({ id: cust(n), name: `Customer ${n}`, salesRepId: EMP_B, creditPeriodDays: 30 }));
    const orders = [1, 2, 3, 4, 5].flatMap((n) => [order(100 + n, "2025-06-10", [P.drive], { customerId: cust(n), partyKey: `c${n}` }), order(n, "2026-04-02", [P.motor], { customerId: cust(n), partyKey: `c${n}` })]);
    const invoices = [1, 2, 3, 4, 5].map((n) => invoice(n, n, "2026-04-05", 1_50_000, { customerId: cust(n) }));
    const receipts = [1, 2, 3, 4, 5].map((n) => ({ ...receipt(n, n, "2026-05-01", RS(1_77_000)), customerId: cust(n) }));
    return { orders, invoices, receipts, customers };
  };
  it("the TEST monthly limit: 5 orders × ₹1,500 = ₹7,500 → ₹5,000", () => {
    const e = pay(bInput(five()))!;
    expect(e.payablePaise).toBe(RS(5_000));
    expect(e.limits.join(" ")).toMatch(/Category B in a month: ₹5,000/);
  });
  it("an explicit \"No limit\" monthly cap: ₹7,500", () => {
    expect(pay(bInput(five(), { "caps.perEmployeeCategoryMonth": "none" }))!.payablePaise).toBe(RS(7_500));
  });
  it("a missing rate or monthly limit is never assumed: the month is blocked", () => {
    const noCap = bInput();
    delete noCap.config!.settings["caps.perEmployeeCategoryMonth"];
    expect(run(noCap)).toMatchObject({ status: "blocked" });
    expect(run(noCap).problems.join(" ")).toMatch(/Most a salesperson can earn from Category B in a month .* isn't set/);
    const noRate = bInput();
    delete noRate.config!.settings["b.ratePpm"];
    expect(run(noRate).problems.join(" ")).toMatch(/Incentive rate .* isn't set/);
  });
  it("the all-categories limit shared with Category A, proportionally: never more than the limit", () => {
    const i = bInput(five(), { "caps.perEmployeeCategoryMonth": "none" });
    // TEST: limit ₹10,000; Category A has ₹7,500 open → B ₹7,500: each keeps half of ₹10,000.
    const r = run({ ...i, allCategories: { capPaise: RS(10_000), policy: "proportional", order: [], others: { [EMP_B]: [{ category: "A", prePaise: RS(7_500), finalPaise: RS(7_500), fixed: false }] } } });
    expect(r.employees[0]).toMatchObject({ beforeAllCategoriesPaise: RS(7_500), payablePaise: RS(5_000) });
    // With Category A locked at ₹8,000, B gets what is left: ₹2,000.
    const locked = run({ ...i, allCategories: { capPaise: RS(10_000), policy: "proportional", order: [], others: { [EMP_B]: [{ category: "A", prePaise: RS(9_000), finalPaise: RS(8_000), fixed: true }] } } });
    expect(locked.employees[0]!.payablePaise).toBe(RS(2_000));
  });
});

describe("the shared all-categories allocation", () => {
  it("proportional shares add up to the limit exactly and never exceed it (largest remainder, ties by code)", () => {
    const a = allCategoriesAllowance({ capPaise: 1_000, policy: "proportional", order: [], own: "A", ownPrePaise: 1_000, others: [{ category: "B", prePaise: 2_000, finalPaise: 0, fixed: false }] });
    const b = allCategoriesAllowance({ capPaise: 1_000, policy: "proportional", order: [], own: "B", ownPrePaise: 2_000, others: [{ category: "A", prePaise: 1_000, finalPaise: 0, fixed: false }] });
    expect([a.allowedPaise, b.allowedPaise]).toEqual([333, 667]);
    expect(a.allowedPaise + b.allowedPaise).toBe(1_000);
  });
  it("in a chosen order: the first category fills first, whichever it is", () => {
    const first = allCategoriesAllowance({ capPaise: 1_000, policy: "categoryOrder", order: ["B", "A"], own: "B", ownPrePaise: 800, others: [{ category: "A", prePaise: 800, finalPaise: 0, fixed: false }] });
    const second = allCategoriesAllowance({ capPaise: 1_000, policy: "categoryOrder", order: ["B", "A"], own: "A", ownPrePaise: 800, others: [{ category: "B", prePaise: 800, finalPaise: 0, fixed: false }] });
    expect([first.allowedPaise, second.allowedPaise]).toEqual([800, 200]);
  });
  it("under the limit nothing changes; no limit, nothing changes", () => {
    expect(allCategoriesAllowance({ capPaise: 5_000, policy: "proportional", order: [], own: "A", ownPrePaise: 1_000, others: [{ category: "B", prePaise: 1_000, finalPaise: 0, fixed: false }] }).allowedPaise).toBe(1_000);
    expect(allCategoriesAllowance({ capPaise: null, policy: "proportional", order: [], own: "A", ownPrePaise: 9_999, others: [] }).allowedPaise).toBe(9_999);
  });
});

describe("manual decisions", () => {
  const ov = (decision: "qualify" | "exclude") => [{ id: "00000000-0000-4000-8000-00000000f002", orderId: so(1), decision, reason: "Checked with the customer file", byId: "00000000-0000-4000-8000-00000000f0e1", byName: "Admin One" }];
  it("an authorised \"qualify\" decides a review case; the amount still needs the qualifying invoice and full collection", () => {
    const i = bInput({ orders: [HISTORY, order(1, "2026-04-02", [null])], overrides: ov("qualify") });
    expect(q(i)).toMatchObject({ automatic: "needs-review", outcome: "qualified" });
    expect(q(i)!.reasons.join(" ")).toMatch(/Decided by hand by Admin One: qualifies — “Checked with the customer file”/);
    expect(pay(i)!.payablePaise).toBe(RS(1_200));
  });
  it("\"exclude\" takes a qualifying order out, with the automatic outcome kept beside it", () => {
    const i = bInput({ overrides: ov("exclude") });
    expect(q(i)).toMatchObject({ automatic: "qualified", outcome: "not-qualified" });
    expect(pay(i)).toBeUndefined();
  });
});

describe("blocked and attribution", () => {
  it("no published version: blocked with the reason", () => {
    expect(run(bInput({ config: null, configVersion: null })).problems.join(" ")).toMatch(/No published Category B/);
  });
  it("slabs on a Category B version are refused", () => {
    const i = bInput();
    i.config!.slabs = [{ lineCode: "B.1", label: "x", fromPaise: 0, toPaise: 100, valueType: "percent", ratePpm: 1, fixedPaise: null, capPaise: null }];
    expect(run(i).problems.join(" ")).toMatch(/Category B has no incentive slabs/);
  });
  it("a salesperson not covered by the eligibility rows isn't credited (said why)", () => {
    const i = bInput();
    i.config!.eligibility = [{ subjectType: "employee", subjectId: EMP_B, role: null, subjectLabel: "Sample Rep", mode: "include", effectiveFrom: "2026-05-01", effectiveTo: null }];
    const r = run(i);
    expect(r.employees).toEqual([]);
    expect(r.excluded.map((n) => n.message).join(" ")).toMatch(/isn't included in Salesperson Eligibility/);
  });
  it("the customer's representative takes the credit (Customer Master)", () => {
    expect(run(bInput()).units[0]).toMatchObject({ employeeId: EMP_B, sharePpm: 1_000_000 });
    expect(CUST_B).toBeTruthy();
  });
});
