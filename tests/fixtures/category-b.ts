import type { SettingValue, IncentiveConfig } from "@/lib/incentives/rules-config/spec";
import type { CategoryBInput, OrderBIn, ProductIn } from "@/lib/incentives/category-b/types";
import type { CreditNoteIn, InvoiceIn, ReceiptIn } from "@/lib/incentives/category-a/types";
import { completeConfig } from "./incentive-config";

/**
 * Category B engine fixtures. SYNTHETIC TEST DATA ONLY: every amount, rate and limit here is a clearly labelled test
 * value chosen to make the arithmetic easy to follow — none is a business decision or a company figure.
 *   TEST rate 1% · TEST per-order limit ₹1,500 · TEST monthly limit ₹5,000 · minimum ₹1,00,000 (confirmed decision)
 *   One salesperson, one existing customer with an order in June 2025, products with brands Alpha / Beta / none.
 */
export const RS = (rupees: number) => Math.round(rupees * 100);
export const EMP_B = "00000000-0000-4000-8000-00000000b0e1";
export const CUST_B = "00000000-0000-4000-8000-00000000b0c1";
export const CUST_NEW = "00000000-0000-4000-8000-00000000b0c2";
export const VERSION_B = "00000000-0000-4000-8000-00000000b0a1";
export const PROGRAM_B = "00000000-0000-4000-8000-00000000b0b1";
const id = (kind: string, n: number) => `00000000-0000-4000-8000-${kind}${String(n).padStart(12 - kind.length, "0")}`;
export const so = (n: number) => id("b50", n);
export const inv = (n: number) => id("b1e", n);
export const rc = (n: number) => id("b2f", n);
export const cnId = (n: number) => id("b3c", n);
export const P = { drive: id("b9a", 1), motor: id("b9a", 2), gearbox: id("b9a", 3), coupling: id("b9a", 4) };
export const PRODUCTS: ProductIn[] = [
  { id: P.drive, name: "Drive", brand: "Alpha" },
  { id: P.motor, name: "Motor", brand: "Beta" },
  { id: P.gearbox, name: "Gearbox", brand: "Alpha" },
  { id: P.coupling, name: "Coupling", brand: null },
];

export const TEST_SETTINGS: Record<string, SettingValue> = {
  "b.ratePpm": 10_000, // TEST 1%
  "caps.perOrder": RS(1_500), // TEST
  "caps.perEmployeeCategoryMonth": RS(5_000), // TEST
  "caps.perEmployeeAllCategoriesMonth": "none",
  "attribution.historical": "currentRep",
  "collection.recoveryAfterNil": "recoverToStepAtReceipt",
  "rounding.method": "halfUp",
  "rounding.precision": "paise",
};

export function bConfig(settings: Record<string, SettingValue> = {}): IncentiveConfig {
  const c = completeConfig({}, [{ subjectType: "employee", subjectId: EMP_B, role: null, subjectLabel: "Sample Rep", mode: "include", effectiveFrom: "2024-01-01", effectiveTo: null }], "B");
  return { ...c, settings: { ...c.settings, ...TEST_SETTINGS, ...settings } };
}

export const order = (n: number, date: string, productIds: (string | null)[], over: Partial<OrderBIn> = {}): OrderBIn => ({
  id: so(n),
  no: `SO ${n}`,
  date,
  customerId: CUST_B,
  partyKey: "customer b",
  paymentTerms: null,
  states: { cancelled: false, optional: false, postDated: false },
  lines: productIds.map((p, i) => ({ productId: p, item: p ? (PRODUCTS.find((x) => x.id === p)?.name ?? "Unknown") : `Unmatched item ${i + 1}` })),
  ...over,
});
/** An invoice: taxable as given, 18% GST on top, due 30 days after. */
export const invoice = (n: number, orderN: number | null, date: string, taxableRupees: number, over: Partial<InvoiceIn> = {}): InvoiceIn => ({
  id: inv(n),
  no: `INV ${n}`,
  date,
  customerId: CUST_B,
  orderId: orderN === null ? null : so(orderN),
  totalPaise: RS(taxableRupees * 1.18),
  taxablePaise: RS(taxableRupees),
  itemsPaise: RS(taxableRupees),
  dueDate: new Date(Date.parse(`${date}T00:00:00Z`) + 30 * 86_400_000).toISOString().slice(0, 10),
  ...over,
});
export const receipt = (n: number, invoiceN: number, date: string, amountPaise: number): ReceiptIn => ({ id: rc(n), no: `RC ${n}`, date, customerId: CUST_B, invoiceId: inv(invoiceN), amountPaise });
export const creditNote = (n: number, invoiceN: number, date: string, taxableRupees: number): CreditNoteIn => ({ id: cnId(n), no: `CN ${n}`, date, customerId: CUST_B, invoiceId: inv(invoiceN), totalPaise: RS(taxableRupees * 1.18), taxablePaise: RS(taxableRupees), itemsPaise: RS(taxableRupees) });

/** The earlier order that makes Customer B an existing customer: 10 Jun 2025, a Drive (brand Alpha). */
export const HISTORY = order(100, "2025-06-10", [P.drive]);

/**
 * April 2026: SO 1 (a Motor — new product, new brand Beta) invoiced 5 Apr for ₹1,20,000 taxable (₹1,41,600 with GST),
 * paid in full on 1 May, before its due date. TEST arithmetic: 1% × ₹1,20,000 = ₹1,200 (under the TEST ₹1,500 limit).
 */
export function bInput(over: Partial<CategoryBInput> = {}, settings: Record<string, SettingValue> = {}): CategoryBInput {
  return {
    month: "2026-04-01",
    asOf: "2026-09-30",
    configVersion: { id: VERSION_B, programId: PROGRAM_B, versionNo: 1, status: "published", effectiveFrom: "2026-04-01", effectiveTo: null },
    config: bConfig(settings),
    roles: ["doer", "initiator", "both"],
    orders: [HISTORY, order(1, "2026-04-02", [P.motor])],
    invoices: [invoice(1, 1, "2026-04-05", 1_20_000)],
    receipts: [receipt(1, 1, "2026-05-01", RS(1_41_600))],
    creditNotes: [],
    events: [],
    customers: [{ id: CUST_B, name: "Customer B", salesRepId: EMP_B, creditPeriodDays: 30 }, { id: CUST_NEW, name: "New Customer", salesRepId: EMP_B, creditPeriodDays: 30 }],
    repHistory: [],
    attributions: [],
    employees: [{ id: EMP_B, name: "Sample Rep", role: "doer", departmentId: null, isActive: true }],
    products: PRODUCTS,
    overrides: [],
    earned: [],
    ...over,
  };
}
