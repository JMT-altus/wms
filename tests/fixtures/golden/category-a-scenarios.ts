import type { CategoryAInput, CreditNoteIn, EventIn, InvoiceIn, ReceiptIn } from "@/lib/incentives/category-a/types";
import { aprilInput, CUST, EMP, EMP2, EXAMPLE_1, EXAMPLE_2, invoiceId, L, orderId, receiptId, type Pay } from "../category-a";

/**
 * The Category A GOLDEN MASTER scenarios: the two April examples (₹1,083.33 and ₹925.00) and a spread of every setting
 * family the engine reads (basis, threshold and slabs, allocation, delay and due dates, partial payments, adjustments,
 * attribution, departed employees, limits and rounding, blocked configurations). Synthetic test data only — the
 * settings are test values, not business decisions.
 *
 * The snapshot (category-a-engine.json) stores each scenario's INPUT as well as its result and hashes, so the golden
 * test re-runs the engine on the stored input: a later change to these builders or to the fixtures can never hide a
 * change in Category A's results.
 */

const id = (kind: string, n: number) => `00000000-0000-4000-8000-${kind}${String(n).padStart(12 - kind.length, "0")}`;
const cn = (n: number, inv: number, total: number, date = "2026-04-20", taxable: number | null = total): CreditNoteIn => ({ id: id("3c", n), no: `CN ${n}`, date, customerId: CUST, invoiceId: invoiceId(inv), totalPaise: total, taxablePaise: taxable, itemsPaise: taxable });
const ev = (n: number, kind: EventIn["kind"], documentId: string, date: string, amountPaise: number | null = null, inv: string | null = null): EventIn => ({ id: id("4e", n), kind, documentId, invoiceId: inv, amountPaise, date });
const ONE_MONTH: Pay[][] = [[[1, 10]], [[0.5, 20], [0.5, 50]], [[1, 80]], [[0.25, 5]]];
const TWELVE_ON_TIME: Pay[][] = Array(12).fill([[1, 10]]);

function withInput(base: CategoryAInput, f: (i: CategoryAInput) => void): CategoryAInput {
  const copy = JSON.parse(JSON.stringify(base)) as CategoryAInput;
  f(copy);
  return copy;
}

export function categoryAScenarios(): { name: string; input: CategoryAInput }[] {
  const out: { name: string; input: CategoryAInput }[] = [];
  const add = (name: string, input: CategoryAInput) => out.push({ name, input });

  add("april example 1 (₹1,083.33)", aprilInput(EXAMPLE_1));
  add("april example 2 (₹925.00)", aprilInput(EXAMPLE_2));
  add("blocked: no configuration", aprilInput(EXAMPLE_1, { config: null, configVersion: null }));
  add("blocked: version not published", aprilInput(EXAMPLE_1, { configVersion: { id: id("a", 9), programId: id("b", 1), versionNo: 3, status: "approved", effectiveFrom: "2026-04-01", effectiveTo: null } }));
  add("blocked: version not in force", aprilInput(EXAMPLE_1, { configVersion: { id: id("a", 9), programId: id("b", 1), versionNo: 3, status: "published", effectiveFrom: "2026-05-01", effectiveTo: null } }));
  add("blocked: incomplete configuration", withInput(aprilInput(EXAMPLE_1), (i) => void delete i.config!.settings["rounding.method"]));

  // Basis
  add("invoice basis, invoice month", aprilInput(EXAMPLE_2, {}, { "basis.document": "invoice", "basis.monthDate": "invoiceDate" }));
  add("taxable basis with customer order date", aprilInput(EXAMPLE_2, {}, { "basis.amount": "taxable", "basis.monthDate": "customerOrderDate" }));
  add("items basis", aprilInput(EXAMPLE_1, {}, { "basis.amount": "itemsOnly" }));
  add("voucher filter: optional and post-dated", withInput(aprilInput(EXAMPLE_1, {}, { "basis.voucherFilter": ["cancelled", "optional", "postDated"] }), (i) => {
    i.orders[0]!.states.optional = true;
    i.orders[1]!.states.postDated = true;
    i.orders[2]!.states.cancelled = true;
  }));
  add("voucher filter: none", withInput(aprilInput(EXAMPLE_1, {}, { "basis.voucherFilter": [] }), (i) => void (i.orders[2]!.states.cancelled = true)));
  for (const pc of ["ignore", "deductPreClosedValue", "deductInMonthOfPreClosure"] as const)
    add(`pre-closure ${pc}`, aprilInput(EXAMPLE_2, { preclosures: [{ orderId: orderId(1), date: "2026-04-15", itemsValuePaise: L(2) }, { orderId: orderId(3), date: "2026-05-02", itemsValuePaise: L(4) }] }, { "basis.preClosure": pc }));

  // Threshold and slabs
  add("threshold not reached", aprilInput([[[1, 10]]]));
  add("threshold exactly, above comparison", aprilInput(Array(10).fill([[1, 10]]), {}, { "eligibility.thresholdComparison": "above" }));
  add("threshold exactly, at least", aprilInput(Array(10).fill([[1, 10]])));
  add("flat slabs", aprilInput(Array(13).fill([[1, 10]]), {}, { "slabs.method": "flat" }));
  add("flat above threshold", aprilInput(Array(13).fill([[1, 10]]), {}, { "slabs.method": "flatAboveThreshold" }));
  add("above top: continue top rate", aprilInput(Array(18).fill([[1, 10]]), {}, { "slabs.aboveTop": "continueTopRate" }));
  add("above top: fixed amount", aprilInput(Array(18).fill([[1, 10]]), {}, { "slabs.aboveTop": "fixedAmount", "slabs.aboveTopAmount": 50_000 }));
  add("upper-inclusive slab edges", aprilInput(Array(12).fill([[1, 10]]), {}, { "slabs.boundaries": "upperInclusive" }));

  // Allocation
  add("allocation proportional to value", withInput(aprilInput(EXAMPLE_2, {}, { "allocation.method": "proportionalToValue" }), (i) => {
    i.orders[0]!.totalPaise = L(15);
    i.invoices[0]!.totalPaise = L(15);
  }));
  add("allocation proportional to collected", aprilInput(EXAMPLE_2, {}, { "allocation.method": "proportionalToCollected" }));
  add("allocation only orders above a minimum", withInput(aprilInput(EXAMPLE_2, {}, { "allocation.eligibleOrders": "onlyOrdersAboveMin", "allocation.minOrderAmount": L(10) }), (i) => {
    i.orders[1]!.totalPaise = L(5);
    i.orders.push({ ...i.orders[0]!, id: orderId(99), no: "SO 99", totalPaise: L(9), taxablePaise: L(9), itemsPaise: L(9) });
  }));

  // Delay and due dates
  add("delay from invoice date", aprilInput(EXAMPLE_2, {}, { "collection.delayFrom": "invoiceDate" }));
  add("delay from order date", aprilInput(EXAMPLE_2, {}, { "collection.delayFrom": "orderDate" }));
  add("step boundary exclusive", aprilInput([...Array(10).fill([[1, 45]]), [[1, 75]], [[1, 100]]], {}, { "collection.stepBoundary": "upperExclusive" }));
  add("due-date fallback chain, missing due dates", withInput(aprilInput(EXAMPLE_2, {}, { "collection.dueDateFallback": ["invoiceDueDate", "orderPaymentTerms", "customerTerms", "defaultDays"], "collection.defaultDays": 15 }), (i) => {
    i.invoices.forEach((inv, k) => {
      if (k % 2) inv.dueDate = null;
    });
    i.orders[1]!.paymentTerms = "Within 20 days of invoice";
    i.customers[0]!.creditPeriodDays = 25;
  }));
  add("missing due date held for review", withInput(aprilInput(EXAMPLE_2, {}, { "collection.missingDueDate": "holdForReview" }), (i) => i.invoices.forEach((inv) => (inv.dueDate = null))));
  add("missing due date left out", withInput(aprilInput(EXAMPLE_2, {}, { "collection.missingDueDate": "excludeReceipt" }), (i) => i.invoices.forEach((inv, k) => (inv.dueDate = k < 3 ? null : inv.dueDate))));
  add("no recovery after nil", aprilInput([...EXAMPLE_2, [[0.5, 120], [0.5, 10]]], {}, { "collection.recoveryAfterNil": "noRecovery" }));

  // Partial payments
  add("whole order at its latest payment", aprilInput(EXAMPLE_2, {}, { "collection.earningBasis": "wholeOrderWorstReceipt" }));
  add("whole order weighted, part unpaid", aprilInput([...EXAMPLE_2.slice(0, 11), [[0.5, 10]]], {}, { "collection.earningBasis": "wholeOrderWeighted" }));
  add("payable as received, unreceived at today's step", aprilInput([...EXAMPLE_2.slice(0, 10), [[0.4, 10]], [[0.1, 50]]], {}, { "collection.payableWhen": "asReceived", "collection.unreceivedPortion": "decayAsOfToday" }));
  add("pending until received", aprilInput([...EXAMPLE_2.slice(0, 10), [[0.4, 10]], []]));
  add("on-account receipts, oldest invoice first", withInput(aprilInput(TWELVE_ON_TIME, {}, { "collection.onAccountReceipts": "allocateOldestInvoiceFirst" }), (i) => {
    for (const r of i.receipts.slice(0, 3)) r.invoiceId = null;
    i.receipts.push({ id: receiptId(98, 1), no: "RC OA", date: "2026-05-01", customerId: CUST, invoiceId: null, amountPaise: L(25) });
  }));
  add("on-account receipts held for manual allocation", withInput(aprilInput(TWELVE_ON_TIME, {}, { "collection.onAccountReceipts": "manualAllocationRequired" }), (i) => void (i.receipts[0]!.invoiceId = null)));
  add("on-account receipts ignored", withInput(aprilInput(TWELVE_ON_TIME), (i) => void (i.receipts[0]!.invoiceId = null)));
  for (const multi of ["useImportedReference", "manualAllocation", "oldestFirst"] as const)
    add(`receipt paying several invoices: ${multi}`, withInput(aprilInput([...TWELVE_ON_TIME.slice(0, 10), [], []], {}, { "collection.multiInvoiceReceipts": multi }), (i) => {
      i.receipts.push({ id: receiptId(97, 1), no: "RC MULTI", date: "2026-04-20", customerId: CUST, invoiceId: invoiceId(11), amountPaise: L(25) });
    }));
  add("receipt naming an unknown invoice", withInput(aprilInput(TWELVE_ON_TIME), (i) => void (i.receipts[0]!.invoiceId = id("1e", 999))));

  // Adjustments
  const cns = [cn(1, 1, L(2)), cn(2, 2, L(1), "2026-05-03"), cn(3, 3, L(10))];
  for (const rule of ["reduceOriginalMonthSales", "reduceInIssueMonth", "reduceOrderCollectionOnly", "ignore"] as const)
    add(`credit notes: ${rule}`, aprilInput(EXAMPLE_2, { creditNotes: cns }, { "adjust.creditNote": rule, "basis.amount": "taxable" }));
  add("sales return marked on a credit note", aprilInput(EXAMPLE_2, { creditNotes: cns, events: [ev(1, "salesReturn", cns[0]!.id, "2026-04-21")] }, { "adjust.creditNote": "ignore", "adjust.salesReturn": "reduceOriginalMonthSales" }));
  add("refund, bounce, reversal, hold, allocation", aprilInput(EXAMPLE_2, {
    events: [
      ev(2, "refund", receiptId(1, 1), "2026-05-01", L(2)),
      ev(3, "bounced", receiptId(2, 1), "2026-04-20"),
      ev(4, "reversed", receiptId(3, 1), "2026-04-22"),
      ev(5, "hold", receiptId(4, 1), "2026-05-01"),
      ev(6, "allocation", receiptId(5, 1), "2026-05-01", L(6), invoiceId(5)),
      ev(7, "allocation", receiptId(5, 1), "2026-05-01", L(4), invoiceId(6)),
    ],
  }, { "adjust.reversedReceipt": "holdForReview", "adjust.bouncedCheque": "reverseAndRestartDelay" }));
  add("refund ignored, reversal reversed", aprilInput(EXAMPLE_2, { events: [ev(8, "refund", receiptId(1, 1), "2026-05-01", L(2)), ev(9, "reversed", receiptId(3, 1), "2026-04-22")] }, { "adjust.refund": "ignore", "adjust.reversedReceipt": "reverseReceiptShare" }));
  add("allocation by hand larger than the receipt", aprilInput(EXAMPLE_2, { events: [ev(10, "allocation", receiptId(5, 1), "2026-05-01", L(20), invoiceId(5))] }));
  add("events after as-of are not seen", aprilInput(EXAMPLE_2, { events: [ev(11, "bounced", receiptId(1, 1), "2026-12-01")] }));

  // Attribution
  const twoOrders = aprilInput(TWELVE_ON_TIME, {}, { "attribution.source": "attributionRecord", "attribution.split": "splitByShares" });
  add("attribution records, split", withInput(twoOrders, (i) => {
    i.employees[1]!.role = "doer";
    i.config!.eligibility.push({ subjectType: "employee", subjectId: EMP2, role: null, subjectLabel: "Second", mode: "include", effectiveFrom: "2026-01-01", effectiveTo: null });
    i.attributions = i.orders.map((o, k) => (k < 6 ? [{ documentId: o.id, employeeId: EMP, sharePpm: 600_000 }, { documentId: o.id, employeeId: EMP2, sharePpm: 400_000 }] : [{ documentId: o.id, employeeId: EMP, sharePpm: 1_000_000 }])).flat();
    i.attributions.push({ documentId: orderId(12), employeeId: EMP2, sharePpm: 1 }); // 100.0001%: refused
  }));
  add("attribution records, single but split", withInput(aprilInput(TWELVE_ON_TIME, {}, { "attribution.source": "attributionRecord" }), (i) => {
    i.attributions = i.orders.slice(0, 11).map((o) => ({ documentId: o.id, employeeId: EMP, sharePpm: 1_000_000 }));
    i.attributions.push({ documentId: orderId(1), employeeId: EMP2, sharePpm: 500_000 });
  }));
  add("order salesperson", withInput(aprilInput(TWELVE_ON_TIME, {}, { "attribution.source": "orderSalesperson" }), (i) => {
    i.attributions = i.orders.slice(1).map((o) => ({ documentId: o.id, employeeId: EMP, sharePpm: 1_000_000 }));
  }));
  add("representative at order date", withInput(aprilInput(TWELVE_ON_TIME, {}, { "attribution.historical": "repAtOrderDate" }), (i) => {
    i.repHistory = [{ customerId: CUST, employeeId: EMP, from: "2026-01-01", to: "2026-04-30" }];
  }));
  add("no representative on record", aprilInput(TWELVE_ON_TIME, {}, { "attribution.historical": "repAtOrderDate" }));
  add("customer not in the master", withInput(aprilInput(TWELVE_ON_TIME), (i) => void (i.customers = [])));
  add("customer without a representative", withInput(aprilInput(TWELVE_ON_TIME), (i) => void (i.customers[0]!.salesRepId = null)));
  add("salesperson excluded by eligibility", withInput(aprilInput(TWELVE_ON_TIME), (i) => i.config!.eligibility.push({ subjectType: "employee", subjectId: EMP, role: null, subjectLabel: "Salesperson", mode: "exclude", effectiveFrom: "2026-04-10", effectiveTo: "2026-04-30" })));
  for (const rule of ["excludeFromMonthLeft", "payUntilLastWorkingDay"] as const)
    add(`departed salesperson: ${rule}`, withInput(aprilInput(EXAMPLE_2, {}, { "eligibility.inactiveEmployees": rule }), (i) => {
      i.employees[0]!.isActive = false;
      i.config!.eligibility[0]!.effectiveTo = "2026-05-20";
    }));
  add("departed salesperson without a last day", withInput(aprilInput(EXAMPLE_2), (i) => void (i.employees[0]!.isActive = false)));

  // Limits and rounding
  add("cap per order", aprilInput(EXAMPLE_1, {}, { "caps.perOrder": 10_000 }));
  add("monthly category cap", aprilInput(Array(16).fill([[1, 10]]), {}, { "caps.perEmployeeCategoryMonth": 300_000 }));
  add("all-categories cap with other categories", aprilInput(Array(16).fill([[1, 10]]), { otherCategoriesPaise: { [EMP]: 1_600_000 } }));
  add("all-categories cap none", aprilInput(EXAMPLE_2, {}, { "caps.perEmployeeAllCategoriesMonth": "none", "caps.perEmployeeCategoryMonth": "none" }));
  for (const level of ["perOrder", "perReceipt"] as const) add(`rounding ${level}`, aprilInput(EXAMPLE_2, {}, { "rounding.level": level }));
  for (const [method, precision] of [["down", "rupee"], ["up", "tenRupees"], ["halfEven", "paise"], ["halfUp", "rupee"]] as const)
    add(`rounding ${method} to ${precision}`, aprilInput(EXAMPLE_1, {}, { "rounding.method": method, "rounding.precision": precision }));

  // Months and as-of
  add("as-of mid-collection", aprilInput(EXAMPLE_2, { asOf: "2026-05-20" }));
  add("another month's documents", withInput(aprilInput(EXAMPLE_2), (i) => {
    const extra: { orders: CategoryAInput["orders"]; invoices: InvoiceIn[]; receipts: ReceiptIn[] } = { orders: [], invoices: [], receipts: [] };
    extra.orders.push({ ...i.orders[0]!, id: orderId(50), no: "SO 50", date: "2026-03-28" });
    extra.invoices.push({ ...i.invoices[0]!, id: invoiceId(50), no: "INV 50", date: "2026-03-28", orderId: orderId(50), dueDate: "2026-03-28" });
    extra.receipts.push({ id: receiptId(50, 1), no: "RC 50.1", date: "2026-04-10", customerId: CUST, invoiceId: invoiceId(50), amountPaise: L(10) });
    i.orders.push(...extra.orders);
    i.invoices.push(...extra.invoices);
    i.receipts.push(...extra.receipts);
  }));
  return out;
}
