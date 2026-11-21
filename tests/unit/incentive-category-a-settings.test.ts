import { describe, expect, it } from "vitest";
import { calculateCategoryA } from "@/lib/incentives/category-a/engine";
import type { CategoryAInput } from "@/lib/incentives/category-a/types";
import type { EligibilityRow, Slab } from "@/lib/incentives/rules-config/spec";
import { aprilInput, CUST, EMP, invoiceId, L, orderId, receiptId, type Pay } from "../fixtures/category-a";

// Category A settings, each with FIGURES (not only "a choice exists"): where the delay is counted from and the due-date
// fallbacks, a missing due date, recovery after nil, sales returns and refunds, the per-order limit, sharing by the
// amount collected, gaps and fixed-amount slabs, and eligibility by department, role and start day. PURE; test values.

const ON_TIME: Pay[][] = Array(12).fill([[1, 5]]);
const set = (i: CategoryAInput, s: Record<string, unknown>): CategoryAInput => ({ ...i, config: { ...i.config!, settings: { ...i.config!.settings, ...(s as Record<string, string | number | string[]>) } } });
const run = (i: CategoryAInput) => {
  const r = calculateCategoryA(i);
  expect(r.status, r.problems.join("\n")).toBe("computed");
  return r;
};
const emp = (i: CategoryAInput) => run(i).employees.find((e) => e.employeeId === EMP);
const share = (n: number) => Math.round((n / 12) * 2_000_00);

describe("collection: where the delay is counted from, and the due-date fallbacks", () => {
  // Every order paid in full 50 days after its invoice; each invoice due 60 days after it.
  const late = (s: Record<string, unknown>, change: (i: CategoryAInput) => void = () => {}) => {
    const i = set(aprilInput(Array(12).fill([[1, 50]])), s);
    i.invoices = i.invoices.map((v) => ({ ...v, dueDate: "2026-06-04" }));
    change(i);
    return run(i).employees[0]?.earnedPaise ?? 0;
  };
  const noDue = (i: CategoryAInput) => {
    i.invoices = i.invoices.map((v) => ({ ...v, dueDate: null }));
  };
  it("from the due date: paid before it, 100%; from the invoice date or the order date: 50 days, 50%", () => {
    expect(late({ "collection.delayFrom": "invoiceDueDate" })).toBe(2_000_00);
    expect(late({ "collection.delayFrom": "invoiceDate" })).toBe(1_000_00);
    expect(late({ "collection.delayFrom": "orderDate" })).toBe(1_000_00);
  });
  it("no due date on the invoice: the order's terms, then the customer's credit period, then the default", () => {
    const terms = (i: CategoryAInput) => {
      noDue(i);
      i.orders = i.orders.map((o) => ({ ...o, paymentTerms: "Within 60 Days" }));
    };
    const all = ["invoiceDueDate", "orderPaymentTerms", "customerTerms", "defaultDays"];
    expect(late({ "collection.dueDateFallback": all, "collection.defaultDays": 0 }, terms)).toBe(2_000_00); // due on day 60: on time
    expect(late({ "collection.dueDateFallback": all, "collection.defaultDays": 0 }, noDue)).toBe(2_000_00); // customer's 30 days: 20 late, 100%
    expect(late({ "collection.dueDateFallback": ["invoiceDueDate", "defaultDays"], "collection.defaultDays": 0 }, noDue)).toBe(1_000_00); // 50 late: 50%
  });
  it("no due date at all: on time, held for review, or left out, as configured", () => {
    expect(late({ "collection.dueDateFallback": ["invoiceDueDate"], "collection.missingDueDate": "treatAsOnTime" }, noDue)).toBe(2_000_00);
    const i = set(aprilInput(Array(12).fill([[1, 50]])), { "collection.dueDateFallback": ["invoiceDueDate"], "collection.missingDueDate": "holdForReview" });
    noDue(i);
    const held = run(i);
    expect(held.employees[0]!.earnedPaise).toBe(0);
    expect(held.held).toHaveLength(12);
    expect(held.held.every((h) => h.code === "receipt")).toBe(true);
    expect(late({ "collection.dueDateFallback": ["invoiceDueDate"], "collection.missingDueDate": "excludeReceipt" }, noDue)).toBe(0);
  });
});

describe("after an amount drops to nil", () => {
  // Steps that drop to 0% at 45 days and come back to 50% from 75 (steps needn't fall steadily).
  const nil = (recovery: string) => {
    const i = set(aprilInput(Array(12).fill([[0.5, 50], [0.5, 80]])), { "collection.recoveryAfterNil": recovery });
    i.config!.delaySteps = [{ fromDays: 0, toDays: 45, multiplierPpm: 1_000_000 }, { fromDays: 45, toDays: 75, multiplierPpm: 0 }, { fromDays: 75, toDays: null, multiplierPpm: 500_000 }];
    return run(i).employees[0]!.earnedPaise;
  };
  it("\"It stays nil\": the later payment earns nothing; \"at the step it falls in\": it earns 50%", () => {
    expect(nil("noRecovery")).toBe(0);
    expect(nil("recoverToStepAtReceipt")).toBe(500_00); // half of each order at 50%: ₹2,000 × 0.5 × 0.5
  });
});

describe("sales returns and refunds", () => {
  const RET = "00000000-0000-4000-8000-3a0000000009";
  const returned = (rule: string, date = "2026-04-20") =>
    set({ ...aprilInput(ON_TIME), creditNotes: [{ id: RET, no: "RET 1", date, customerId: CUST, invoiceId: invoiceId(1), totalPaise: L(1), taxablePaise: L(1), itemsPaise: L(1) }], events: [{ id: "ev-r", kind: "salesReturn", documentId: RET, invoiceId: null, amountPaise: null, date }] }, { "adjust.salesReturn": rule, "adjust.creditNote": "ignore" });
  it("a return reduces the original month, the month of the return, only what is collected, or nothing", () => {
    expect(emp(returned("reduceOriginalMonthSales"))!.salesPaise).toBe(L(119));
    expect(emp(returned("reduceInIssueMonth", "2026-05-03"))!.salesPaise).toBe(L(120));
    expect(run({ ...returned("reduceInIssueMonth", "2026-05-03"), month: "2026-05-01" }).employees[0]!.salesPaise).toBe(-L(1));
    const coll = run(returned("reduceOrderCollectionOnly"));
    expect(coll.employees[0]!.salesPaise).toBe(L(120));
    expect(coll.units.find((u) => u.unitId === orderId(1))!.collectiblePaise).toBe(L(9));
    expect(emp(returned("ignore"))!.salesPaise).toBe(L(120));
  });
  it("a refund takes back what the refunded part earned, or is ignored, as configured", () => {
    const refund = (rule: string) => run(set({ ...aprilInput(ON_TIME), events: [{ id: "ev-f", kind: "refund", documentId: receiptId(1, 1), invoiceId: null, amountPaise: L(5), date: "2026-04-25" }] }, { "adjust.refund": rule, "collection.payableWhen": "asReceived" })).employees[0]!;
    expect(refund("ignore").earnedPaise).toBe(2_000_00);
    expect(refund("reverseReceiptShare").earnedPaise).toBe(Math.round((11.5 / 12) * 2_000_00));
  });
});

describe("limits and sharing", () => {
  it("the most one order can earn limits each order's share (applied after the delay)", () => {
    expect(emp(set(aprilInput(ON_TIME), { "caps.perOrder": 100_00 }))!.earnedPaise).toBe(12 * 100_00);
  });
  it("sharing in proportion to the amount collected: an order with nothing collected takes no share", () => {
    expect(emp(set(aprilInput([[], ...Array(11).fill([[1, 5]])]), { "allocation.method": "proportionalToCollected" }))!.earnedPaise).toBe(2_000_00);
    expect(emp(set(aprilInput([[], ...Array(11).fill([[1, 5]])]), { "allocation.method": "equalPerOrder" }))!.earnedPaise).toBe(share(11));
  });
});

describe("slab shapes", () => {
  const slab = (code: string, from: number, to: number, x: { rate?: number; fixed?: number }): Slab => ({ lineCode: code, label: code, fromPaise: from, toPaise: to, valueType: x.fixed !== undefined ? "fixed" : "percent", ratePpm: x.fixed !== undefined ? null : x.rate!, fixedPaise: x.fixed ?? null, capPaise: null });
  const one = (paise: number, s: Record<string, unknown>, slabs: Slab[]) => {
    const i = set(aprilInput([[[1, 5]]]), { "caps.perEmployeeCategoryMonth": "none", ...s });
    i.config!.slabs = slabs;
    i.orders = [{ ...i.orders[0]!, totalPaise: paise }];
    i.invoices = [{ ...i.invoices[0]!, totalPaise: paise }];
    i.receipts = [{ ...i.receipts[0]!, amountPaise: paise }];
    return run(i).employees[0]!;
  };
  it("gaps allowed: sales inside a gap earn nothing more", () => {
    const slabs = [slab("A.1", L(100), L(120), { rate: 1_000 }), slab("A.2", L(130), L(160), { rate: 2_000 })];
    expect(one(L(125), { "slabs.gaps": "allow" }, slabs).pool).toBe("200000");
    expect(one(L(140), { "slabs.gaps": "allow" }, slabs).pool).toBe("400000"); // ₹2,000 + 0.2% of ₹10 L
  });
  it("fixed-amount slabs: marginal adds each slab reached; flat pays the slab reached", () => {
    const slabs = [slab("A.1", L(100), L(120), { fixed: 1_500_00 }), slab("A.2", L(120), L(140), { fixed: 2_500_00 })];
    expect(one(L(120), {}, slabs).pool).toBe("400000");
    expect(one(L(120), { "slabs.method": "flat" }, slabs).pool).toBe("250000");
  });
});

describe("eligibility by department, by role, and from a day in the month", () => {
  const withRows = (rows: EligibilityRow[], change: (i: CategoryAInput) => void = () => {}) => {
    const i = aprilInput(ON_TIME);
    i.config!.eligibility = rows;
    change(i);
    return run(i);
  };
  const DEP = "00000000-0000-4000-8000-0000000000d1";
  const inDep = (i: CategoryAInput) => {
    i.employees = i.employees.map((e) => (e.id === EMP ? { ...e, departmentId: DEP } : e));
  };
  const dept: EligibilityRow = { subjectType: "department", subjectId: DEP, role: null, subjectLabel: "Sales", mode: "include", effectiveFrom: "2026-01-01", effectiveTo: null };
  it("a department row includes its members; an exclude row wins", () => {
    expect(withRows([dept], inDep).employees[0]!.earnedPaise).toBe(2_000_00);
    const ex = withRows([dept, { subjectType: "employee", subjectId: EMP, role: null, subjectLabel: "Salesperson", mode: "exclude", effectiveFrom: "2026-04-01", effectiveTo: "2026-04-30" }], inDep);
    expect(ex.employees).toEqual([]);
    expect(ex.excluded[0]!.message).toMatch(/is excluded on 2026-04-05/);
  });
  it("a role row includes everyone with that role", () => {
    expect(withRows([{ subjectType: "role", subjectId: null, role: "doer", subjectLabel: "Doer", mode: "include", effectiveFrom: "2026-01-01", effectiveTo: null }]).employees[0]!.earnedPaise).toBe(2_000_00);
  });
  it("included from 10 April: orders of 5 April aren't theirs", () => {
    const r = withRows([{ subjectType: "employee", subjectId: EMP, role: null, subjectLabel: "Salesperson", mode: "include", effectiveFrom: "2026-04-10", effectiveTo: null }]);
    expect(r.employees).toEqual([]);
    expect(r.excluded[0]!.message).toMatch(/isn't included in Salesperson Eligibility on 2026-04-05/);
  });
});
