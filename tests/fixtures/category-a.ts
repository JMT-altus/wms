import type { IncentiveConfig, SettingValue } from "@/lib/incentives/rules-config/spec";
import type { CategoryAInput, InvoiceIn, OrderIn, ReceiptIn } from "@/lib/incentives/category-a/types";
import { completeConfig } from "./incentive-config";

/**
 * The two April calculation examples as engine input. 12 orders of ₹10 L each (₹1.2 Cr) for one salesperson in
 * April 2026; each order has one invoice of the same day, due that day, so a receipt's delay is simply the days
 * after the invoice. The settings are TEST values chosen to match the examples, not business decisions.
 */
export const L = (lakhs: number) => Math.round(lakhs * 1_00_000 * 100);
export const EMP = "00000000-0000-4000-8000-0000000000e1";
export const EMP2 = "00000000-0000-4000-8000-0000000000e2";
export const CUST = "00000000-0000-4000-8000-0000000000c1";
export const VERSION = "00000000-0000-4000-8000-0000000000a1";
export const PROGRAM = "00000000-0000-4000-8000-0000000000b1";
const id = (kind: string, n: number) => `00000000-0000-4000-8000-${kind}${String(n).padStart(12 - kind.length, "0")}`;
export const orderId = (n: number) => id("0d", n);
export const invoiceId = (n: number) => id("1e", n);
export const receiptId = (n: number, k: number) => id("2f", n * 10 + k);

export const APRIL_SETTINGS: Record<string, SettingValue> = {
  "basis.document": "salesOrder",
  "basis.amount": "total",
  "basis.monthDate": "orderDate",
  "basis.voucherFilter": ["cancelled"],
  "basis.preClosure": "ignore",
  "eligibility.thresholdComparison": "atLeast",
  "slabs.boundaries": "lowerInclusive",
  "slabs.aboveTop": "noFurtherIncentive",
  "slabs.gaps": "refuse",
  "allocation.method": "equalPerOrder",
  "allocation.eligibleOrders": "allInMonth",
  "collection.stepBoundary": "upperInclusive",
  "collection.dueDateFallback": ["invoiceDueDate"],
  "collection.missingDueDate": "treatAsOnTime",
  "collection.recoveryAfterNil": "recoverToStepAtReceipt",
  "collection.unreceivedPortion": "pendingUntilReceived",
  "collection.onAccountReceipts": "ignoreUntilAllocated",
  "collection.multiInvoiceReceipts": "useImportedReference",
  "attribution.source": "customerSalesRep",
  "attribution.historical": "currentRep",
  "attribution.split": "single",
  "rounding.method": "halfUp",
  "rounding.precision": "paise",
  "rounding.level": "employeeMonthTotal",
  "caps.perOrder": "none",
};

export function aprilConfig(settings: Record<string, SettingValue> = {}): IncentiveConfig {
  const c = completeConfig({}, [{ subjectType: "employee", subjectId: EMP, role: null, subjectLabel: "Salesperson", mode: "include", effectiveFrom: "2026-01-01", effectiveTo: null }]);
  return { ...c, settings: { ...c.settings, ...APRIL_SETTINGS, ...settings } };
}

/** A receipt: [fraction of the order (0–1), days after the invoice]. */
export type Pay = [number, number];

export function aprilOrders(payments: Pay[][], customer = CUST): { orders: OrderIn[]; invoices: InvoiceIn[]; receipts: ReceiptIn[] } {
  const orders: OrderIn[] = [], invoices: InvoiceIn[] = [], receipts: ReceiptIn[] = [];
  payments.forEach((pays, i) => {
    const n = i + 1;
    orders.push({ id: orderId(n), no: `SO ${n}`, date: "2026-04-05", customerId: customer, totalPaise: L(10), taxablePaise: L(10), itemsPaise: L(10), customerOrderDate: "2026-04-04", paymentTerms: null, states: { cancelled: false, optional: false, postDated: false } });
    invoices.push({ id: invoiceId(n), no: `INV ${n}`, date: "2026-04-05", customerId: customer, orderId: orderId(n), totalPaise: L(10), taxablePaise: L(10), itemsPaise: L(10), dueDate: "2026-04-05" });
    pays.forEach(([fraction, days], k) => {
      receipts.push({ id: receiptId(n, k + 1), no: `RC ${n}.${k + 1}`, date: new Date(Date.parse("2026-04-05T00:00:00Z") + days * 86_400_000).toISOString().slice(0, 10), customerId: customer, invoiceId: invoiceId(n), amountPaise: Math.round(L(10) * fraction) });
    });
  });
  return { orders, invoices, receipts };
}

/** Example 1: each order paid in full at once — 4 within 45 days, 4 at 46–75, 2 at 76–100, 2 after 100. */
export const EXAMPLE_1: Pay[][] = [...Array(4).fill([[1, 10]]), ...Array(4).fill([[1, 50]]), ...Array(2).fill([[1, 80]]), ...Array(2).fill([[1, 110]])];
/** Example 2: partial receipts, each at its own delay (fractions × multipliers sum to 5.55). */
export const EXAMPLE_2: Pay[][] = [
  [[0.5, 10], [0.5, 60]], // 0.5 + 0.25 = 0.75
  [[0.25, 10], [0.25, 60], [0.5, 90]], // 0.25 + 0.125 + 0.125 = 0.5
  [[0.8, 10], [0.2, 120]], // 0.8 + 0 = 0.8
  [[1, 30]], // 1
  ...Array(4).fill([[1, 50]]), // 0.5 each
  ...Array(2).fill([[1, 80]]), // 0.25 each
  ...Array(2).fill([[1, 110]]), // 0
];

export function aprilInput(payments: Pay[][], over: Partial<CategoryAInput> = {}, settings: Record<string, SettingValue> = {}): CategoryAInput {
  return {
    month: "2026-04-01",
    asOf: "2026-09-30",
    configVersion: { id: VERSION, programId: PROGRAM, versionNo: 1, status: "published", effectiveFrom: "2026-04-01", effectiveTo: null },
    config: aprilConfig(settings),
    roles: ["doer", "initiator", "both"],
    ...aprilOrders(payments),
    creditNotes: [],
    preclosures: [],
    events: [],
    customers: [{ id: CUST, name: "Customer One", salesRepId: EMP, creditPeriodDays: 30 }],
    repHistory: [],
    attributions: [],
    employees: [
      { id: EMP, name: "Salesperson", role: "doer", departmentId: null, isActive: true },
      { id: EMP2, name: "Second", role: "doer", departmentId: null, isActive: true },
    ],
    ...over,
  };
}
