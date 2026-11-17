import { CATEGORY_LABEL, type DelayStep, type IncentiveConfig, type SettingValue, type Slab } from "@/lib/incentives/rules-config/spec";
import { checkConfig, isMonthStart, isDay, rupees } from "@/lib/incentives/rules-config/validate";
import * as R from "./rational";
import type { Q } from "./rational";
import {
  ENGINE_VERSION,
  type CategoryAInput,
  type CategoryAResult,
  type CreditNoteIn,
  type EmployeeIn,
  type EmployeeResult,
  type InvoiceIn,
  type Note,
  type OrderIn,
  type ReceiptPiece,
  type SlabLine,
  type UnitResult,
} from "./types";

/**
 * Category A ("Sales Order Received") — the calculation. PURE: the same input always gives the same result, in the
 * same order, whatever order the input lists things in. Every decision below reads a setting of the published
 * configuration version; where a setting is missing, invalid or the version isn't published and in force for the
 * month, nothing is calculated and the result says why (status "blocked").
 *
 * The steps, each one a section of the configuration:
 *   1. Sales units (General Eligibility): the month's Sales Orders or Sales Invoices, their counted amount, the orders
 *      left out, pre-closures.
 *   2. Whose sale (Salesperson Eligibility): the attribution source, history, shared credit, eligibility rows and
 *      people who left.
 *   3. Each salesperson's monthly sales, with credit notes / returns / pre-closures that reduce them.
 *   4. Threshold and slabs → the month's incentive pool.
 *   5. Sharing the pool between the salesperson's orders (Incentive Allocation).
 *   6. Receipts applied to invoices (Partial Payment Rules: on-account and multi-invoice receipts, manual allocations,
 *      refunds, bounced and reversed receipts) — each receipt at ITS OWN date and delay (Collection and Payment Delay).
 *   7. What each order earns and when it is payable (earning basis, payable when, unreceived amounts).
 *   8. Limits and rounding (Rounding and Limits), at the configured level only.
 */

const DAY = 86_400_000;
const toMs = (d: string) => Date.parse(`${d}T00:00:00Z`);
const daysBetween = (from: string, to: string) => Math.round((toMs(to) - toMs(from)) / DAY);
const addDays = (d: string, n: number) => new Date(toMs(d) + n * DAY).toISOString().slice(0, 10);
const monthOf = (d: string) => d.slice(0, 7);
const monthEnd = (monthStart: string) => {
  const [y, m] = monthStart.split("-").map(Number) as [number, number];
  return new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
};
const byKey = <T>(xs: readonly T[], key: (x: T) => string) => [...xs].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
/** Document numbers in natural order (INV 2 before INV 10): each run of digits is padded so text order is number order. */
const natural = (s: string) => s.replace(/\d+/g, (d) => d.replace(/^0+(?=\d)/, "").padStart(20, "0"));
const docKey = (x: { date: string; no: string; id: string }) => `${x.date}|${natural(x.no)}|${x.id}`;
const ONE = R.q(1);

type S = Record<string, SettingValue>;
const str = (s: S, k: string) => s[k] as string;
const num = (s: S, k: string) => s[k] as number;
const list = (s: S, k: string) => (s[k] as string[] | undefined) ?? [];
const cap = (s: S, k: string): number | null => (s[k] === "none" ? null : (s[k] as number));

function blocked(input: CategoryAInput, problems: string[]): CategoryAResult {
  return {
    engineVersion: ENGINE_VERSION,
    status: "blocked",
    problems,
    month: input.month,
    asOf: input.asOf,
    configVersionId: input.configVersion?.id ?? null,
    configVersionNo: input.configVersion?.versionNo ?? null,
    employees: [],
    units: [],
    pieces: [],
    held: [],
    excluded: [],
    settled: false,
    settingsUsed: input.config?.settings ?? {},
  };
}

/** Why the configuration can't be used for this month, or nothing. */
export function configProblems(input: CategoryAInput): string[] {
  const out: string[] = [];
  if (!isMonthStart(input.month)) out.push(`${input.month} isn't the first day of a month.`);
  if (!isDay(input.asOf)) out.push(`${input.asOf} isn't a date.`);
  const v = input.configVersion;
  if (!v || !input.config) {
    out.push(`No published Category A (${CATEGORY_LABEL.A}) configuration is in force for ${input.month.slice(0, 7)}. Publish one in Admin & Master Setup → Incentive Rules.`);
    return out;
  }
  if (v.status !== "published") out.push(`Configuration version ${v.versionNo} is ${v.status}, not published: only a published version can be used.`);
  if (!v.effectiveFrom || v.effectiveFrom > input.month || (v.effectiveTo !== null && v.effectiveTo < monthEnd(input.month)))
    out.push(`Configuration version ${v.versionNo} isn't in force for the whole of ${input.month.slice(0, 7)} (${v.effectiveFrom ?? "no start"} – ${v.effectiveTo ?? "open"}).`);
  const { problems, missing } = checkConfig(input.config, { roles: input.roles });
  for (const p of problems) out.push(`Configuration problem: ${p.message}`);
  for (const m of missing) out.push(`Configuration incomplete: ${m.message}`);
  if (!problems.length && input.config.settings["period.unit"] !== "calendarMonth") out.push("Only a calendar-month calculation period is supported.");
  return out;
}

/* ── delay steps ──────────────────────────────────────────────────────── */

function stepFor(steps: readonly DelayStep[], days: number, boundary: string): DelayStep {
  for (const s of steps) {
    if (s.toDays === null) return s;
    if (boundary === "upperInclusive" ? days <= s.toDays : days < s.toDays) return s;
  }
  return steps[steps.length - 1]!;
}

/* ── slabs ────────────────────────────────────────────────────────────── */

function slabPool(sales: number, threshold: number, s: S, slabs: readonly Slab[]): { lines: SlabLine[]; pool: Q } {
  const method = str(s, "slabs.method");
  const lowerInclusive = str(s, "slabs.boundaries") === "lowerInclusive";
  const aboveTop = str(s, "slabs.aboveTop");
  const top = slabs[slabs.length - 1]!;
  const S = R.q(sales);
  const lines: SlabLine[] = [];
  const push = (slab: Slab, amount: Q, note: string) => {
    const limited = slab.capPaise === null ? amount : R.min(amount, R.q(slab.capPaise));
    lines.push({ lineCode: slab.lineCode, label: slab.label, amount: R.text(amount), limited: R.text(limited), note: slab.capPaise !== null && R.cmp(amount, limited) > 0 ? `${note}; limited to ${rupees(slab.capPaise)}` : note });
  };
  const inSlab = (x: number, sl: Slab) => (lowerInclusive ? x >= sl.fromPaise && x < sl.toPaise : x > sl.fromPaise && x <= sl.toPaise);
  const beyondTop = lowerInclusive ? sales >= top.toPaise : sales > top.toPaise;

  if (method === "marginal") {
    for (const sl of slabs) {
      const isTop = sl === top;
      const upper = isTop && aboveTop === "continueTopRate" ? Math.max(sales, sl.toPaise) : sl.toPaise;
      const part = Math.max(0, Math.min(sales, upper) - sl.fromPaise);
      if (sl.valueType === "percent") {
        if (part > 0) push(sl, R.mul(R.q(part), R.ppm(sl.ratePpm ?? 0)), `${(sl.ratePpm! / 10_000).toString()}% of ${rupees(part)} inside the slab${isTop && upper > sl.toPaise ? " (the top rate continues above it)" : ""}`);
      } else {
        const reached = lowerInclusive ? sales >= sl.fromPaise : sales > sl.fromPaise;
        if (reached) push(sl, R.q(sl.fixedPaise ?? 0), `fixed ${rupees(sl.fixedPaise ?? 0)} for reaching the slab`);
      }
    }
  } else {
    // flat / flatAboveThreshold: the slab the sales fall in (or the top one, if the top rate continues).
    let sl = slabs.find((x) => inSlab(sales, x)) ?? null;
    if (!sl && beyondTop && aboveTop === "continueTopRate") sl = top;
    if (sl) {
      const base = method === "flat" ? S : R.max(R.ZERO, R.sub(S, R.q(threshold)));
      if (sl.valueType === "percent") push(sl, R.mul(base, R.ppm(sl.ratePpm ?? 0)), `${(sl.ratePpm! / 10_000).toString()}% of ${method === "flat" ? "all sales" : "the sales above the threshold"}`);
      else push(sl, R.q(sl.fixedPaise ?? 0), `fixed ${rupees(sl.fixedPaise ?? 0)}`);
    }
  }
  if (beyondTop && aboveTop === "fixedAmount") {
    const amt = num(s, "slabs.aboveTopAmount");
    lines.push({ lineCode: `${top.lineCode}+`, label: "Above the highest slab", amount: R.text(R.q(amt)), limited: R.text(R.q(amt)), note: `fixed ${rupees(amt)} for sales above ${rupees(top.toPaise)}` });
  }
  return { lines, pool: R.sum(lines.map((l) => R.fromText(l.limited))) };
}

/* ── the calculation ──────────────────────────────────────────────────── */

interface Unit {
  id: string;
  no: string;
  type: "sales-orders" | "sales-invoices";
  monthDate: string;
  customerId: string | null;
  order: OrderIn | null;
  invoices: InvoiceIn[];
  /** Counted value (basis amount), before any deduction. */
  basePaise: number;
  /** Counted value after the deductions that change the unit itself. */
  valuePaise: number;
  /** What the customer must pay on the unit (GST included): what receipts are measured against. */
  collectible: Q;
  explanation: string[];
}

interface Share {
  unit: Unit;
  employee: EmployeeIn;
  sharePpm: number;
}

export function calculateCategoryA(input: CategoryAInput): CategoryAResult {
  const problems = configProblems(input);
  if (problems.length) return blocked(input, problems);
  const cfg = input.config as IncentiveConfig;
  const s = cfg.settings;
  const steps = cfg.delaySteps;
  const lastStepFrom = steps[steps.length - 1]!.fromDays;
  const month = input.month.slice(0, 7);
  const asOf = input.asOf;
  const seen = <T extends { date: string }>(xs: readonly T[]) => xs.filter((x) => x.date <= asOf);

  const held: Note[] = [];
  const excluded: Note[] = [];
  const orders = byKey(seen(input.orders), docKey);
  const invoices = byKey(seen(input.invoices), docKey);
  const receipts = byKey(seen(input.receipts), docKey);
  const creditNotes = byKey(seen(input.creditNotes), docKey);
  const events = byKey(seen(input.events), (e) => `${e.date}|${e.id}`);
  const preclosures = byKey(seen(input.preclosures), (p) => `${p.date}|${p.orderId}|${p.itemsValuePaise}`);
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const customerById = new Map(input.customers.map((c) => [c.id, c]));
  const employeeById = new Map(input.employees.map((e) => [e.id, e]));
  const invoicesOfOrder = new Map<string, InvoiceIn[]>();
  for (const inv of invoices) if (inv.orderId) invoicesOfOrder.set(inv.orderId, [...(invoicesOfOrder.get(inv.orderId) ?? []), inv]);
  const returnIds = new Set(events.filter((e) => e.kind === "salesReturn").map((e) => e.documentId));

  const basis = str(s, "basis.document");
  const amountBasis = str(s, "basis.amount");
  const monthDateBasis = str(s, "basis.monthDate");
  const filtered = new Set(list(s, "basis.voucherFilter"));
  const preClosure = str(s, "basis.preClosure");
  const amountOf = (d: { totalPaise: number; taxablePaise: number | null; itemsPaise: number | null }): number | null =>
    amountBasis === "total" ? d.totalPaise : amountBasis === "taxable" ? d.taxablePaise : d.itemsPaise;
  const amountLabel = amountBasis === "total" ? "total value" : amountBasis === "taxable" ? "taxable value" : "product lines";
  /** How a credit note (or sales return) is treated: its setting's choice. */
  const cnRule = (cn: CreditNoteIn) => (returnIds.has(cn.id) ? str(s, "adjust.salesReturn") : str(s, "adjust.creditNote"));
  const cnWord = (cn: CreditNoteIn) => (returnIds.has(cn.id) ? "Sales return" : "Credit note");

  /* 1. Sales units */
  const unitOrderOf = (inv: InvoiceIn) => (inv.orderId ? orderById.get(inv.orderId) ?? null : null);
  const candidates: { id: string; no: string; type: Unit["type"]; customerId: string | null; order: OrderIn | null; invoices: InvoiceIn[]; doc: OrderIn | InvoiceIn }[] =
    basis === "salesOrder"
      ? orders.map((o) => ({ id: o.id, no: o.no, type: "sales-orders" as const, customerId: o.customerId, order: o, invoices: invoicesOfOrder.get(o.id) ?? [], doc: o }))
      : invoices.map((i) => ({ id: i.id, no: i.no, type: "sales-invoices" as const, customerId: i.customerId, order: unitOrderOf(i), invoices: [i], doc: i }));

  const allUnits: Unit[] = [];
  for (const c of candidates) {
    const why: string[] = [];
    let monthDate: string | null;
    if (monthDateBasis === "orderDate") monthDate = c.order?.date ?? null;
    else if (monthDateBasis === "customerOrderDate") monthDate = c.order?.customerOrderDate && isDay(c.order.customerOrderDate) ? c.order.customerOrderDate : null;
    else monthDate = c.type === "sales-invoices" ? c.doc.date : (c.invoices[0]?.date ?? null);
    if (!monthDate) {
      // Only worth saying for a document that could be this month's.
      if (monthOf(c.doc.date) === month)
        excluded.push({ documentId: c.id, documentNo: c.no, employeeId: null, message: monthDateBasis === "invoiceDate" ? "Not invoiced yet: the month is decided by the invoice date." : monthDateBasis === "customerOrderDate" ? "No customer's order date (Order - Date), which decides the month." : "No Sales Order, whose date decides the month." });
      continue;
    }
    if (c.order) {
      const st = c.order.states;
      const out = (["cancelled", "optional", "postDated"] as const).filter((k) => st[k] && filtered.has(k));
      if (out.length) {
        if (monthOf(monthDate) === month) excluded.push({ documentId: c.id, documentNo: c.no, employeeId: null, message: `Left out: the order is ${out.join(", ")} (Orders left out).` });
        continue;
      }
    }
    const base = amountOf(c.doc);
    if (base === null || base <= 0) {
      if (monthOf(monthDate) === month) excluded.push({ documentId: c.id, documentNo: c.no, employeeId: null, message: `No ${amountLabel} to count.` });
      continue;
    }
    let value = base;
    let collectible = R.q(c.doc.totalPaise);
    why.push(`${c.type === "sales-orders" ? "Order" : "Invoice"} ${c.no} of ${monthDate}: ${amountLabel} ${rupees(base)}.`);
    // Pre-closures (orders only: an invoice is what was delivered).
    if (c.type === "sales-orders" && c.order) {
      const pcs = preclosures.filter((p) => p.orderId === c.id);
      const items = c.order.itemsPaise;
      if (pcs.length && items && items > 0) {
        const pcValue = pcs.reduce((a, p) => a + p.itemsValuePaise, 0);
        const fraction = R.min(ONE, R.q(pcValue, items));
        collectible = R.sub(collectible, R.mul(collectible, fraction));
        if (preClosure === "deductPreClosedValue") {
          const ded = R.round(R.mul(R.q(base), fraction), "halfUp", "paise");
          value -= ded;
          why.push(`Pre-closed ${rupees(pcValue)} of ${rupees(items)} in items: ${rupees(ded)} deducted.`);
        } else why.push(`Pre-closed ${rupees(pcValue)} of ${rupees(items)} in items: the customer owes that much less${preClosure === "ignore" ? "; sales count the full order" : "; deducted in the month of pre-closure"}.`);
      }
    }
    // Credit notes / sales returns against the unit's invoices.
    const invIds = new Set(c.invoices.map((i) => i.id));
    for (const cn of creditNotes.filter((x) => x.invoiceId && invIds.has(x.invoiceId))) {
      const rule = cnRule(cn);
      if (rule === "ignore") {
        why.push(`${cnWord(cn)} ${cn.no} ignored (configured).`);
        continue;
      }
      collectible = R.sub(collectible, R.q(cn.totalPaise));
      if (rule === "reduceOriginalMonthSales") {
        const amt = amountOf(cn) ?? 0;
        value -= amt;
        why.push(`${cnWord(cn)} ${cn.no} of ${cn.date}: ${rupees(amt)} off the order's month.`);
      } else why.push(`${cnWord(cn)} ${cn.no} of ${cn.date}: ${rupees(cn.totalPaise)} less to collect${rule === "reduceInIssueMonth" ? "; sales reduced in its own month" : ""}.`);
    }
    allUnits.push({ id: c.id, no: c.no, type: c.type, monthDate, customerId: c.customerId, order: c.order, invoices: c.invoices, basePaise: base, valuePaise: Math.max(0, value), collectible: R.max(R.ZERO, collectible), explanation: why });
  }
  const unitById = new Map(allUnits.map((u) => [u.id, u]));
  const unitOfInvoice = new Map<string, Unit>();
  for (const u of allUnits) for (const i of u.invoices) unitOfInvoice.set(i.id, u);

  /* 2. Whose sale */
  const attrSource = str(s, "attribution.source");
  const historical = str(s, "attribution.historical");
  const split = str(s, "attribution.split");
  const inactive = str(s, "eligibility.inactiveEmployees");
  const elig = cfg.eligibility;
  const matches = (e: EmployeeIn, r: (typeof elig)[number]) => (r.subjectType === "employee" ? r.subjectId === e.id : r.subjectType === "department" ? r.subjectId !== null && r.subjectId === e.departmentId : r.role === e.role);
  const covers = (r: (typeof elig)[number], day: string) => r.effectiveFrom <= day && (r.effectiveTo === null || r.effectiveTo >= day);
  /** Whether the configuration covers the employee on the day, or why not. */
  const eligibleOn = (e: EmployeeIn, day: string): string | null => {
    if (!elig.some((r) => r.mode === "include" && matches(e, r) && covers(r, day))) return `${e.name} isn't included in Salesperson Eligibility on ${day}.`;
    const ex = elig.find((r) => r.mode === "exclude" && matches(e, r) && covers(r, day));
    if (ex) return `${e.name} is excluded on ${day} (${ex.subjectLabel}).`;
    return null;
  };
  /** A departed employee's last working day: the end of the inclusion that covers them (the WMS records no leaving date elsewhere). */
  const lastDayOf = (e: EmployeeIn): string | null => {
    const ends = elig.filter((r) => r.mode === "include" && matches(e, r)).map((r) => r.effectiveTo);
    if (!ends.length || ends.some((x) => x === null)) return null;
    return (ends as string[]).sort().at(-1)!;
  };
  const departed = new Map<string, { lastDay: string | null }>();
  for (const e of input.employees) if (!e.isActive) departed.set(e.id, { lastDay: lastDayOf(e) });

  const sharesOf = (u: Unit): { shares: { employeeId: string; sharePpm: number }[] } | { why: string } => {
    if (attrSource === "attributionRecord") {
      const rows = input.attributions.filter((a) => a.documentId === u.id);
      if (!rows.length) return { why: "No salesperson is assigned to it (Incentive Rules attribution)." };
      const total = rows.reduce((a, r) => a + r.sharePpm, 0);
      if (split === "single" && (rows.length !== 1 || rows[0]!.sharePpm !== 1_000_000)) return { why: "Shared credit is set to one salesperson per order, but its assignment names several or less than 100%." };
      if (total !== 1_000_000) return { why: `Its assigned shares add up to ${total / 10_000}%, not 100%.` };
      return { shares: rows.map((r) => ({ employeeId: r.employeeId, sharePpm: r.sharePpm })) };
    }
    if (attrSource === "orderSalesperson") {
      // The salesperson recorded for the Forms order (Incentive Rules → Order Salespeople, linked from the order's page):
      // one person, 100%. Tally's import carries no salesperson, so an order without a record stays unattributed.
      const rows = input.attributions.filter((a) => a.documentId === u.id);
      if (!rows.length) return { why: "No salesperson is recorded for this order yet (Order Salespeople)." };
      if (rows.length !== 1 || rows[0]!.sharePpm !== 1_000_000) return { why: "A salesperson recorded on the order must be one person at 100%; this order's record names several or less." };
      return { shares: [{ employeeId: rows[0]!.employeeId, sharePpm: 1_000_000 }] };
    }
    // customerSalesRep
    const cust = u.customerId ? customerById.get(u.customerId) : undefined;
    if (!cust) return { why: "Its customer isn't in the Customer Master." };
    if (historical === "currentRep") return cust.salesRepId ? { shares: [{ employeeId: cust.salesRepId, sharePpm: 1_000_000 }] } : { why: `${cust.name} has no sales representative.` };
    const rows = input.repHistory.filter((r) => r.customerId === cust.id && r.from <= u.monthDate && (r.to === null || r.to >= u.monthDate));
    if (!rows.length) return { why: `No representative of ${cust.name} is on record for ${u.monthDate}.` };
    if (new Set(rows.map((r) => r.employeeId)).size > 1) return { why: `Several representatives of ${cust.name} are on record for ${u.monthDate}.` };
    return { shares: [{ employeeId: rows[0]!.employeeId, sharePpm: 1_000_000 }] };
  };

  const sharesByUnit = new Map<string, Share[]>();
  for (const u of allUnits) {
    const inMonth = monthOf(u.monthDate) === month;
    const r = sharesOf(u);
    if ("why" in r) {
      if (inMonth) excluded.push({ documentId: u.id, documentNo: u.no, employeeId: null, message: `Not credited to anyone: ${r.why}` });
      continue;
    }
    const out: Share[] = [];
    for (const sh of r.shares) {
      const e = employeeById.get(sh.employeeId);
      if (!e) {
        if (inMonth) excluded.push({ documentId: u.id, documentNo: u.no, employeeId: sh.employeeId, message: "Its salesperson is no longer an employee." });
        continue;
      }
      const notEligible = eligibleOn(e, u.monthDate);
      if (notEligible) {
        if (inMonth) excluded.push({ documentId: u.id, documentNo: u.no, employeeId: e.id, message: notEligible });
        continue;
      }
      const d = departed.get(e.id);
      if (d) {
        if (!d.lastDay) {
          if (inMonth) excluded.push({ documentId: u.id, documentNo: u.no, employeeId: e.id, message: `${e.name} has left and no last working day is recorded (end their inclusion in Salesperson Eligibility).` });
          continue;
        }
        const out1 = inactive === "excludeFromMonthLeft" ? month >= monthOf(d.lastDay) : u.monthDate > d.lastDay;
        if (out1) {
          if (inMonth) excluded.push({ documentId: u.id, documentNo: u.no, employeeId: e.id, message: inactive === "excludeFromMonthLeft" ? `${e.name} left in ${monthOf(d.lastDay)}: nothing from that month on.` : `${e.name}'s last working day was ${d.lastDay}.` });
          continue;
        }
      }
      out.push({ unit: u, employee: e, sharePpm: sh.sharePpm });
    }
    sharesByUnit.set(u.id, out);
  }

  /* 3. Monthly sales per salesperson */
  const monthUnits = allUnits.filter((u) => monthOf(u.monthDate) === month);
  const salesQ = new Map<string, Q>();
  const salesNotes = new Map<string, string[]>();
  const addSales = (e: string, amt: Q, note?: string) => {
    salesQ.set(e, R.add(salesQ.get(e) ?? R.ZERO, amt));
    if (note) salesNotes.set(e, [...(salesNotes.get(e) ?? []), note]);
  };
  for (const u of monthUnits) for (const sh of sharesByUnit.get(u.id) ?? []) addSales(sh.employee.id, R.mul(R.q(u.valuePaise), R.ppm(sh.sharePpm)));
  // Reductions placed in this month though their order is from any month.
  for (const cn of creditNotes) {
    if (monthOf(cn.date) !== month || cnRule(cn) !== "reduceInIssueMonth" || !cn.invoiceId) continue;
    const u = unitOfInvoice.get(cn.invoiceId);
    if (!u) continue;
    for (const sh of sharesByUnit.get(u.id) ?? []) addSales(sh.employee.id, R.mul(R.q(-(amountOf(cn) ?? 0)), R.ppm(sh.sharePpm)), `${cnWord(cn)} ${cn.no}: ${rupees(amountOf(cn) ?? 0)} off this month's sales.`);
  }
  if (preClosure === "deductInMonthOfPreClosure") {
    for (const p of preclosures) {
      if (monthOf(p.date) !== month) continue;
      const u = unitById.get(p.orderId);
      if (!u || !u.order?.itemsPaise) continue;
      const ded = R.mul(R.q(u.basePaise), R.min(ONE, R.q(p.itemsValuePaise, u.order.itemsPaise)));
      for (const sh of sharesByUnit.get(u.id) ?? []) addSales(sh.employee.id, R.mul(R.mul(ded, R.ppm(sh.sharePpm)), R.q(-1)), `Pre-closure on order ${u.no} (${p.date}): ${rupees(R.round(ded, "halfUp", "paise"))} off this month's sales.`);
    }
  }

  /* 6. Receipts applied to invoices (done for every customer involved, in date order, so the oldest-first rules are exact) */
  const refundRule = str(s, "adjust.refund");
  const bounceRule = str(s, "adjust.bouncedCheque");
  const reversedRule = str(s, "adjust.reversedReceipt");
  const onAccount = str(s, "collection.onAccountReceipts");
  const multi = str(s, "collection.multiInvoiceReceipts");
  const invoiceDue = new Map<string, Q>(); // what is still to be collected on each invoice
  for (const inv of invoices) {
    let due = R.q(inv.totalPaise);
    for (const cn of creditNotes) if (cn.invoiceId === inv.id && cnRule(cn) !== "ignore") due = R.sub(due, R.q(cn.totalPaise));
    invoiceDue.set(inv.id, R.max(R.ZERO, due));
  }
  const oldestOpen = (customerId: string | null, day: string, except?: string) =>
    invoices.filter((i) => i.customerId === customerId && i.id !== except && i.date <= day && R.cmp(invoiceDue.get(i.id)!, R.ZERO) > 0);
  interface Applied { receiptId: string; receiptNo: string; date: string; invoiceId: string; amount: Q; how: string }
  const applied: Applied[] = [];
  const pieces: ReceiptPiece[] = [];
  const piece = (r: (typeof receipts)[number], amount: number | Q, status: ReceiptPiece["status"], note: string, invoiceId: string | null = null) => {
    const unit = invoiceId ? unitOfInvoice.get(invoiceId) ?? null : null;
    pieces.push({ receiptId: r.id, receiptNo: r.no, receiptDate: r.date, invoiceId, unitId: unit?.id ?? null, employeeId: null, amountPaise: typeof amount === "number" ? amount : R.round(amount, "halfUp", "paise"), referenceDate: null, delayDays: null, multiplierPpm: null, earnedExact: "0", status, note });
  };
  const apply = (r: (typeof receipts)[number], inv: InvoiceIn, amount: Q, how: string) => {
    if (R.isZero(amount)) return;
    invoiceDue.set(inv.id, R.max(R.ZERO, R.sub(invoiceDue.get(inv.id)!, amount)));
    applied.push({ receiptId: r.id, receiptNo: r.no, date: r.date, invoiceId: inv.id, amount, how });
  };
  const fifo = (r: (typeof receipts)[number], amount: Q, how: string, except?: string): Q => {
    let left = amount;
    for (const inv of oldestOpen(r.customerId, r.date, except)) {
      if (R.isZero(left)) break;
      const take = R.min(left, invoiceDue.get(inv.id)!);
      apply(r, inv, take, how);
      left = R.sub(left, take);
    }
    return left;
  };
  for (const r of receipts) {
    const evs = events.filter((e) => e.documentId === r.id);
    if (evs.some((e) => e.kind === "bounced")) {
      piece(r, r.amountPaise, "reversed", bounceRule === "reverseAndRestartDelay" ? "Cheque bounced: it earns nothing, and the delay keeps running until a payment that clears." : "Cheque bounced: it earns nothing.");
      continue;
    }
    if (evs.some((e) => e.kind === "reversed")) {
      if (reversedRule === "holdForReview") {
        piece(r, r.amountPaise, "held", "Receipt reversed: held for review.");
        held.push({ documentId: r.id, documentNo: r.no, employeeId: null, message: "Receipt reversed: held for review." });
      } else piece(r, r.amountPaise, "reversed", "Receipt reversed: it earns nothing.");
      continue;
    }
    if (evs.some((e) => e.kind === "hold")) {
      piece(r, r.amountPaise, "held", "Held for review by hand: it earns nothing until the hold is released.");
      held.push({ documentId: r.id, documentNo: r.no, employeeId: null, message: "Held for review by hand." });
      continue;
    }
    let amount = R.q(r.amountPaise);
    if (refundRule === "reverseReceiptShare") {
      const refunded = evs.filter((e) => e.kind === "refund").reduce((a, e) => a + (e.amountPaise ?? 0), 0);
      if (refunded > 0) {
        const cut = Math.min(refunded, r.amountPaise);
        amount = R.q(r.amountPaise - cut);
        piece(r, cut, "reversed", `Refunded ${rupees(cut)}: that part earns nothing.`);
      }
    }
    const manual = evs.filter((e) => e.kind === "allocation");
    if (manual.length) {
      const total = manual.reduce((a, e) => a + (e.amountPaise ?? 0), 0);
      if (R.cmp(R.q(total), amount) > 0 || manual.some((e) => !e.invoiceId || !invoiceById.has(e.invoiceId))) {
        piece(r, amount, "held", "Its allocation by hand is more than the receipt, or names an unknown invoice: held.");
        held.push({ documentId: r.id, documentNo: r.no, employeeId: null, message: "Allocation by hand doesn't fit the receipt." });
        continue;
      }
      for (const e of manual) apply(r, invoiceById.get(e.invoiceId!)!, R.q(e.amountPaise ?? 0), "allocated by hand");
      const rest = R.sub(amount, R.q(total));
      if (!R.isZero(rest)) piece(r, rest, "held", "Part of the receipt isn't allocated by hand yet.");
      continue;
    }
    if (r.invoiceId && invoiceById.has(r.invoiceId)) {
      const inv = invoiceById.get(r.invoiceId)!;
      const due = invoiceDue.get(inv.id)!;
      if (R.cmp(amount, due) <= 0 || multi === "useImportedReference") {
        apply(r, inv, amount, "the invoice it names");
        continue;
      }
      apply(r, inv, due, "the invoice it names");
      const excess = R.sub(amount, due);
      if (multi === "oldestFirst") {
        const left = fifo(r, excess, "the customer's oldest open invoice", inv.id);
        if (!R.isZero(left)) piece(r, left, "excluded", "More than the customer's open invoices: the excess isn't applied.");
      } else {
        piece(r, excess, "held", "It pays more than the invoice it names: the excess waits to be split by hand.");
        held.push({ documentId: r.id, documentNo: r.no, employeeId: null, message: "Pays several invoices: split it by hand." });
      }
      continue;
    }
    if (r.invoiceId && !invoiceById.has(r.invoiceId)) {
      piece(r, amount, "excluded", "The invoice it names isn't in Forms.");
      continue;
    }
    // On account.
    if (onAccount === "allocateOldestInvoiceFirst") {
      const left = fifo(r, amount, "on account: the customer's oldest open invoice");
      if (!R.isZero(left)) piece(r, left, "excluded", "On account, and more than the customer's open invoices: the excess isn't applied.");
    } else if (onAccount === "manualAllocationRequired") {
      piece(r, amount, "held", "On account: held until it is allocated by hand.");
      held.push({ documentId: r.id, documentNo: r.no, employeeId: null, message: "On-account receipt: allocate it by hand." });
    } else piece(r, amount, "excluded", "On account: ignored until it is allocated.");
  }

  /* delay reference dates */
  const delayFrom = str(s, "collection.delayFrom");
  const fallback = list(s, "collection.dueDateFallback");
  const missingDue = str(s, "collection.missingDueDate");
  const boundary = str(s, "collection.stepBoundary");
  const termsDays = (t: string | null) => {
    const m = t ? /(\d{1,3})\s*days?\b/i.exec(t) : null;
    return m ? Number(m[1]) : null;
  };
  const referenceDate = (inv: InvoiceIn): { date: string; from: string } | null => {
    if (delayFrom === "invoiceDate") return { date: inv.date, from: "the invoice date" };
    if (delayFrom === "orderDate") {
      const o = inv.orderId ? orderById.get(inv.orderId) : undefined;
      return o ? { date: o.date, from: "the order date" } : null;
    }
    for (const src of fallback) {
      if (src === "invoiceDueDate" && inv.dueDate) return { date: inv.dueDate, from: "the invoice's due date" };
      if (src === "orderPaymentTerms") {
        const o = inv.orderId ? orderById.get(inv.orderId) : undefined;
        const n = termsDays(o?.paymentTerms ?? null);
        if (n !== null) return { date: addDays(inv.date, n), from: `the order's payment terms (${n} days)` };
      }
      if (src === "customerTerms") {
        const c = inv.customerId ? customerById.get(inv.customerId) : undefined;
        if (c?.creditPeriodDays != null) return { date: addDays(inv.date, c.creditPeriodDays), from: `${c.name}'s credit period (${c.creditPeriodDays} days)` };
      }
      if (src === "defaultDays") return { date: addDays(inv.date, num(s, "collection.defaultDays")), from: `the default ${num(s, "collection.defaultDays")} days` };
    }
    return null;
  };

  /* 4–5, 7. Pool, sharing and earnings, per salesperson */
  const allocation = str(s, "allocation.method");
  const eligibleOrders = str(s, "allocation.eligibleOrders");
  const minOrder = eligibleOrders === "onlyOrdersAboveMin" ? num(s, "allocation.minOrderAmount") : 0;
  const threshold = num(s, "eligibility.threshold");
  const atLeast = str(s, "eligibility.thresholdComparison") === "atLeast";
  const earning = str(s, "collection.earningBasis");
  const payableWhen = str(s, "collection.payableWhen");
  const unreceived = str(s, "collection.unreceivedPortion");
  const recovery = str(s, "collection.recoveryAfterNil");
  const level = str(s, "rounding.level");
  const method = str(s, "rounding.method") as R.RoundingMethod;
  const precision = str(s, "rounding.precision") as R.RoundingPrecision;
  const rnd = (x: Q) => R.q(R.round(x, method, precision));
  const capOrder = cap(s, "caps.perOrder");
  const capMonth = cap(s, "caps.perEmployeeCategoryMonth");
  const capAll = cap(s, "caps.perEmployeeAllCategoriesMonth");

  const employeesOut: EmployeeResult[] = [];
  const unitsOut: UnitResult[] = [];
  let settled = true;
  const employeeIds = [...new Set(monthUnits.flatMap((u) => (sharesByUnit.get(u.id) ?? []).map((x) => x.employee.id)).concat([...salesQ.keys()]))].sort();

  for (const eid of employeeIds) {
    const e = employeeById.get(eid)!;
    const why: string[] = [...(salesNotes.get(eid) ?? [])];
    const salesExact = salesQ.get(eid) ?? R.ZERO;
    const sales = R.round(salesExact, "halfUp", "paise");
    const qualified = atLeast ? sales >= threshold : sales > threshold;
    why.unshift(`Sales in ${month}: ${rupees(sales)}; threshold ${rupees(threshold)} — ${qualified ? "qualifies" : "doesn't qualify"}.`);
    const { lines, pool } = qualified ? slabPool(sales, threshold, s, cfg.slabs) : { lines: [], pool: R.ZERO };
    if (qualified) why.push(`Incentive for the month: ${rupees(R.round(pool, "halfUp", "paise"))}${lines.length ? ` (${lines.map((l) => `${l.lineCode}: ${l.note}`).join("; ")})` : " (no slab applies)"}.`);

    const shares = monthUnits.flatMap((u) => (sharesByUnit.get(u.id) ?? []).filter((x) => x.employee.id === eid));
    const departedDay = departed.get(eid)?.lastDay ?? null;

    // Collection per share (this salesperson's part of each order).
    interface Coll { sh: Share; collected: Q; credited: { a: Applied; credited: Q; ref: { date: string; from: string } | null; delay: number | null; m: Q | null; note: string; status: ReceiptPiece["status"] }[]; full: boolean }
    const coll: Coll[] = shares.map((sh) => {
      const u = sh.unit;
      const invIds = new Set(u.invoices.map((i) => i.id));
      let collected = R.ZERO;
      let nil = false;
      const credited: Coll["credited"] = [];
      for (const a of applied.filter((x) => invIds.has(x.invoiceId))) {
        const room = R.max(R.ZERO, R.sub(u.collectible, collected));
        const c = R.min(a.amount, room);
        const over = R.sub(a.amount, c);
        if (!R.isZero(over)) credited.push({ a: { ...a, amount: over }, credited: R.ZERO, ref: null, delay: null, m: null, note: "More than the order still owed: earns nothing.", status: "over-collected" });
        if (R.isZero(c)) continue;
        collected = R.add(collected, c);
        const inv = invoiceById.get(a.invoiceId)!;
        const ref = referenceDate(inv);
        let m: Q | null;
        let delay: number | null = null;
        let note: string;
        let status: ReceiptPiece["status"] = "credited";
        if (!ref) {
          if (missingDue === "treatAsOnTime") {
            delay = 0;
            m = R.ppm(stepFor(steps, 0, boundary).multiplierPpm);
            note = "No due date could be found: treated as on time.";
          } else if (missingDue === "holdForReview") {
            m = null;
            status = "held";
            note = "No due date could be found: held for review.";
            held.push({ documentId: a.receiptId, documentNo: a.receiptNo, employeeId: eid, message: `No due date for invoice ${inv.no}: held for review.` });
          } else {
            m = null;
            status = "excluded";
            note = "No due date could be found: left out.";
          }
        } else {
          delay = Math.max(0, daysBetween(ref.date, a.date));
          const st = stepFor(steps, delay, boundary);
          m = R.ppm(st.multiplierPpm);
          note = `${delay} days after ${ref.from} (${ref.date}): ${st.multiplierPpm / 10_000}%.`;
        }
        if (m && recovery === "noRecovery") {
          if (nil) {
            m = R.ZERO;
            note += " The order had already dropped to nil, so it stays nil.";
          } else if (R.isZero(m)) nil = true;
        }
        if (m && departedDay && a.date > departedDay) {
          m = R.ZERO;
          note += ` Received after ${e.name}'s last working day (${departedDay}).`;
        }
        credited.push({ a: { ...a, amount: c }, credited: c, ref, delay, m, note, status });
      }
      const full = R.cmp(u.collectible, R.ZERO) > 0 && R.cmp(collected, u.collectible) >= 0;
      return { sh, collected, credited, full };
    });

    // 5. Sharing the pool.
    const takes = coll.filter((c) => c.sh.unit.valuePaise >= minOrder);
    const weights = new Map<Coll, Q>();
    for (const c of takes) weights.set(c, allocation === "equalPerOrder" ? ONE : allocation === "proportionalToValue" ? R.mul(R.q(c.sh.unit.valuePaise), R.ppm(c.sh.sharePpm)) : R.mul(c.collected, R.ppm(c.sh.sharePpm)));
    const totalWeight = R.sum([...weights.values()]);
    if (qualified) why.push(`Shared between ${takes.length} order${takes.length === 1 ? "" : "s"} ${allocation === "equalPerOrder" ? "equally" : allocation === "proportionalToValue" ? "in proportion to value" : "in proportion to the amount collected"}${minOrder ? ` (orders of at least ${rupees(minOrder)})` : ""}.`);

    let earnedSum = R.ZERO, payableSum = R.ZERO, projectedSum = R.ZERO;
    for (const c of coll) {
      const u = c.sh.unit;
      const w = weights.get(c);
      const allocated = w && !R.isZero(totalWeight) ? R.div(R.mul(pool, w), totalWeight) : R.ZERO;
      const per = R.isZero(u.collectible) ? R.ZERO : R.div(allocated, u.collectible); // incentive per paisa collected
      const uWhy = [...u.explanation];
      if (c.sh.sharePpm !== 1_000_000) uWhy.push(`${e.name}'s share: ${c.sh.sharePpm / 10_000}%.`);
      if (!w) uWhy.push(`Below the minimum order value of ${rupees(minOrder)}: takes no share.`);
      else uWhy.push(`Its share of the month's incentive: ${rupees(R.round(allocated, "halfUp", "paise"))} for collecting ${rupees(R.round(u.collectible, "halfUp", "paise"))}.`);
      const counted = c.credited.filter((x) => x.status === "credited" && x.m);
      const last = counted.length ? counted.reduce((a, b) => (b.a.date > a.a.date || (b.a.date === a.a.date && R.cmp(b.m!, a.m!) < 0) ? b : a)) : null;
      let unitEarned = R.ZERO;
      for (const x of c.credited) {
        let m = x.m;
        if (x.status === "credited" && m && earning === "wholeOrderWorstReceipt") m = last!.m!;
        let amt = x.status === "credited" && m ? R.mul(R.mul(per, x.credited), m) : R.ZERO;
        if (earning === "wholeOrderWeighted" && !c.full) amt = R.ZERO;
        if (level === "perReceipt") amt = rnd(amt);
        unitEarned = R.add(unitEarned, amt);
        pieces.push({
          receiptId: x.a.receiptId,
          receiptNo: x.a.receiptNo,
          receiptDate: x.a.date,
          invoiceId: x.a.invoiceId,
          unitId: u.id,
          employeeId: eid,
          amountPaise: R.round(x.status === "over-collected" ? x.a.amount : x.credited, "halfUp", "paise"),
          referenceDate: x.ref?.date ?? null,
          delayDays: x.delay,
          multiplierPpm: m ? Number((m.n * 1_000_000n) / m.d) : null,
          earnedExact: R.text(amt),
          status: x.status,
          note: `${x.note}${earning === "wholeOrderWorstReceipt" && x.status === "credited" && m !== x.m ? " Earns at the order's latest payment's rate." : ""}${earning === "wholeOrderWeighted" && !c.full ? " Earned only once the order is fully collected." : ""} Applied to ${x.a.how}.`,
        });
      }
      if (capOrder !== null && R.cmp(unitEarned, R.q(capOrder)) > 0) {
        uWhy.push(`Limited to ${rupees(capOrder)} (most one order can earn).`);
        unitEarned = R.q(capOrder);
      }
      if (level === "perOrder") unitEarned = rnd(unitEarned);
      const payable = payableWhen === "asReceived" || c.full ? unitEarned : R.ZERO;
      if (!c.full) uWhy.push(payableWhen === "orderFullyCollected" ? `Collected ${rupees(R.round(c.collected, "halfUp", "paise"))}: payable once fully collected.` : `Collected ${rupees(R.round(c.collected, "halfUp", "paise"))} so far.`);
      // Unreceived amounts, for information.
      const unpaid = R.max(R.ZERO, R.sub(u.collectible, c.collected));
      let projected = R.ZERO;
      if (!R.isZero(unpaid) && w) {
        if (unreceived === "pendingUntilReceived") projected = R.mul(per, unpaid);
        else {
          for (const inv of u.invoices) {
            const out = R.min(invoiceDue.get(inv.id) ?? R.ZERO, unpaid);
            const ref = referenceDate(inv);
            const st = stepFor(steps, ref ? Math.max(0, daysBetween(ref.date, asOf)) : 0, boundary);
            projected = R.add(projected, R.mul(R.mul(per, out), R.ppm(st.multiplierPpm)));
          }
          const uninvoiced = R.max(R.ZERO, R.sub(unpaid, R.sum(u.invoices.map((i) => invoiceDue.get(i.id) ?? R.ZERO))));
          projected = R.add(projected, R.mul(per, uninvoiced));
        }
      }
      // Settled: fully collected, or every invoice past the last step's start.
      const pastLast = u.invoices.length > 0 && u.invoices.every((inv) => {
        const ref = referenceDate(inv);
        return ref !== null && daysBetween(ref.date, asOf) >= lastStepFrom && stepFor(steps, daysBetween(ref.date, asOf), boundary).multiplierPpm === 0;
      });
      if (!c.full && !pastLast) settled = false;
      earnedSum = R.add(earnedSum, unitEarned);
      payableSum = R.add(payableSum, payable);
      projectedSum = R.add(projectedSum, projected);
      unitsOut.push({
        unitId: u.id,
        unitNo: u.no,
        unitType: u.type,
        employeeId: eid,
        sharePpm: c.sh.sharePpm,
        valuePaise: u.valuePaise,
        collectiblePaise: R.round(u.collectible, "halfUp", "paise"),
        collectedPaise: R.round(c.collected, "halfUp", "paise"),
        fullyCollected: c.full,
        takesShare: !!w,
        allocated: R.text(allocated),
        earnedExact: R.text(unitEarned),
        payableExact: R.text(payable),
        explanation: uWhy,
      });
    }

    // 8. Limits and rounding.
    const limits: string[] = [];
    let earned = earnedSum, payableQ = payableSum;
    if (level === "employeeMonthTotal") {
      earned = rnd(earned);
      payableQ = rnd(payableQ);
    }
    const applyCap = (c: number | null, label: string) => {
      if (c === null) return;
      if (R.cmp(earned, R.q(c)) > 0 || R.cmp(payableQ, R.q(c)) > 0) limits.push(`${label}: ${rupees(c)}.`);
      earned = R.min(earned, R.q(c));
      payableQ = R.min(payableQ, R.q(c));
    };
    applyCap(capMonth, "Limited to the most a salesperson can earn from Category A in a month");
    if (capAll !== null) applyCap(Math.max(0, capAll - (input.otherCategoriesPaise?.[eid] ?? 0)), "Limited by the most a salesperson can earn from all categories in a month");
    const earnedPaise = R.round(earned, method, precision);
    const payablePaise = R.round(payableQ, method, precision);
    employeesOut.push({
      employeeId: eid,
      name: e.name,
      salesPaise: sales,
      qualified,
      slabLines: lines,
      pool: R.text(pool),
      ordersSharing: takes.length,
      earnedExact: R.text(earnedSum),
      payableExact: R.text(payableSum),
      earnedPaise,
      payablePaise,
      pendingPaise: earnedPaise - payablePaise,
      projectedPaise: R.round(projectedSum, method, precision),
      limits,
      explanation: why,
    });
  }

  // The receipt pieces that never reached a counted order of a salesperson are still reported (with no employee).
  const credited = new Set(pieces.filter((p) => p.employeeId).map((p) => `${p.receiptId}|${p.invoiceId}`));
  for (const a of applied) {
    if (credited.has(`${a.receiptId}|${a.invoiceId}`)) continue;
    const u = unitOfInvoice.get(a.invoiceId);
    if (u && monthOf(u.monthDate) !== month) continue; // another month's order: that month's calculation reports it
    pieces.push({ receiptId: a.receiptId, receiptNo: a.receiptNo, receiptDate: a.date, invoiceId: a.invoiceId, unitId: u?.id ?? null, employeeId: null, amountPaise: R.round(a.amount, "halfUp", "paise"), referenceDate: null, delayDays: null, multiplierPpm: null, earnedExact: "0", status: "excluded", note: u ? "Its order isn't credited to an eligible salesperson." : "Its invoice belongs to no counted order." });
  }
  // Report only what concerns this month: unattached pieces of receipts this month or on this month's orders.
  const monthUnitIds = new Set(monthUnits.map((u) => u.id));
  const relevant = pieces.filter((p) => p.employeeId || (p.unitId ? monthUnitIds.has(p.unitId) : monthOf(p.receiptDate) === month));

  const order = (p: ReceiptPiece) => `${p.employeeId ?? "~"}|${p.unitId ?? "~"}|${p.receiptDate}|${natural(p.receiptNo)}|${p.receiptId}|${p.invoiceId ?? ""}|${p.status}`;
  return {
    engineVersion: ENGINE_VERSION,
    status: "computed",
    problems: [],
    month: input.month,
    asOf,
    configVersionId: input.configVersion!.id,
    configVersionNo: input.configVersion!.versionNo,
    employees: employeesOut,
    units: byKey(unitsOut, (u) => `${u.employeeId}|${unitById.get(u.unitId)!.monthDate}|${natural(u.unitNo)}|${u.unitId}`),
    pieces: byKey(relevant, order),
    held: byKey(held.filter((h) => !h.documentId || relevant.some((p) => p.receiptId === h.documentId)), (h) => `${h.documentNo}|${h.documentId}|${h.message}`),
    excluded: byKey(excluded, (h) => `${h.documentNo}|${h.documentId}|${h.employeeId}|${h.message}`),
    settled: settled && monthUnits.length > 0,
    settingsUsed: Object.fromEntries(Object.keys(s).sort().map((k) => [k, s[k]])),
  };
}
