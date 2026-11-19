import { CATEGORY_LABEL, type IncentiveConfig, type SettingValue } from "@/lib/incentives/rules-config/spec";
import { checkConfig, isDay, isMonthStart, pct, rupees } from "@/lib/incentives/rules-config/validate";
import * as R from "@/lib/incentives/category-a/rational";
import type { Q } from "@/lib/incentives/category-a/rational";
import type { CreditNoteIn, InvoiceIn, Note, ReceiptPiece, UnitResult } from "@/lib/incentives/category-a/types";
import { byKey, daysBetween, docKey, monthEnd, monthOf, monthsBefore, natural } from "@/lib/incentives/shared/dates";
import { makeReferenceDate, stepFor } from "@/lib/incentives/shared/delay";
import { applyReceipts, type Applied } from "@/lib/incentives/shared/receipts";
import { makePeople } from "@/lib/incentives/shared/people";
import { allCategoriesAllowance } from "@/lib/incentives/shared/all-categories";
import { ENGINE_VERSION_B, type CategoryBInput, type CategoryBResult, type EmployeeResultB, type OrderBIn, type Outcome, type QualificationResult } from "./types";

/**
 * Category B ("Old Customer – New Product / New Brand") — the calculation. PURE: the same input always gives the same
 * result, whatever order the input lists things in. Every value it uses is a setting of the published Category B
 * version in force for the month; with a missing, invalid or unpublished version nothing is calculated and the result
 * says why ("blocked").
 *
 * The confirmed rules, and where each value comes from:
 *   1. Orders left out: the version's "Orders left out", and cancelled orders always.
 *   2. Existing customer: at least one earlier eligible Sales Order of the same Customer Master customer within
 *      "Existing customer: months looked back" before the order. "Earlier" is the document order: date, then voucher
 *      number in natural order, then id (the import has no time of day), so an order is never its own history.
 *   3. New product OR new brand: a line whose matched Product Master product, or that product's brand, isn't on the
 *      customer's earlier eligible orders within the novelty window. A new product qualifies even without a brand. An
 *      unmatched line is never treated as new: when an unmatched record could change the outcome, the order needs an
 *      admin's review. A party not linked to the Customer Master needs review too.
 *   4. The qualifying invoice: the FIRST individual invoice of the order (in document order) whose WHOLE taxable value,
 *      after the credit notes counted against it, is at least the minimum. Invoices are never added together. Once per
 *      order. Its date places the order's Category B in its month.
 *   5. Credit notes (and sales returns, as "Sales returns" says) before the order's Category B is paid out are part of
 *      the reassessment: an invoice that falls below the minimum stops qualifying and the next invoice that meets it may
 *      qualify. After payout the qualifying invoice stays fixed (`earned`): the reduced value gives a smaller amount, and
 *      below the minimum nothing — the difference is recovered in later months by the period workflow (settle.ts).
 *   6. An authorised manual decision (qualify / exclude) replaces the automatic eligibility; the amount still comes from
 *      the qualifying invoice and payment still needs full collection. Cancelled orders stay left out.
 *   7. Amount: the rate × the net taxable value, within "Most one Sales Order can earn" BEFORE collection decay.
 *   8. Collection: the qualifying invoice's receipts, applied by Category A's rules, each at its own delay with the
 *      version's delay steps; payable only once the invoice is fully collected.
 *   9. Attribution, eligibility, people who left, rounding, the monthly limit and the shared all-categories limit, as
 *      the version says.
 */

type S = Record<string, SettingValue>;
const str = (s: S, k: string) => s[k] as string;
const num = (s: S, k: string) => s[k] as number;
const list = (s: S, k: string) => (s[k] as string[] | undefined) ?? [];
const cap = (s: S, k: string): number | null => (s[k] === "none" ? null : (s[k] as number));
const uniq = (xs: string[]) => [...new Set(xs)];
const normBrand = (b: string | null) => (b && b.trim() ? b.trim().toLowerCase() : null);

function blocked(input: CategoryBInput, problems: string[]): CategoryBResult {
  return { engineVersion: ENGINE_VERSION_B, status: "blocked", problems, month: input.month, asOf: input.asOf, configVersionId: input.configVersion?.id ?? null, configVersionNo: input.configVersion?.versionNo ?? null, employees: [], units: [], pieces: [], held: [], excluded: [], qualifications: [], reviewInvoices: [], settled: false, settingsUsed: input.config?.settings ?? {} };
}

/** Why the configuration can't be used for this month, or nothing. */
export function configProblemsB(input: CategoryBInput): string[] {
  const out: string[] = [];
  if (!isMonthStart(input.month)) out.push(`${input.month} isn't the first day of a month.`);
  if (!isDay(input.asOf)) out.push(`${input.asOf} isn't a date.`);
  const v = input.configVersion;
  if (!v || !input.config) {
    out.push(`No published Category B (${CATEGORY_LABEL.B}) configuration is in force for ${input.month.slice(0, 7)}. Publish one in Admin & Master Setup → Incentive Rules.`);
    return out;
  }
  if (v.status !== "published") out.push(`Configuration version ${v.versionNo} is ${v.status}, not published: only a published version can be used.`);
  if (!v.effectiveFrom || v.effectiveFrom > input.month || (v.effectiveTo !== null && v.effectiveTo < monthEnd(input.month)))
    out.push(`Configuration version ${v.versionNo} isn't in force for the whole of ${input.month.slice(0, 7)} (${v.effectiveFrom ?? "no start"} – ${v.effectiveTo ?? "open"}).`);
  const { problems, missing } = checkConfig(input.config, { roles: input.roles, category: "B" });
  for (const p of problems) out.push(`Configuration problem: ${p.message}`);
  for (const m of missing) out.push(`Configuration incomplete: ${m.message}`);
  if (!problems.length && input.config.settings["period.unit"] !== "calendarMonth") out.push("Only a calendar-month calculation period is supported.");
  if (input.allCategories?.problem) out.push(input.allCategories.problem);
  return out;
}

interface Evaluated {
  q: QualificationResult;
  order: OrderBIn;
  invoice: InvoiceIn | null;
  /** Rate × net taxable within the per-order limit (before collection decay). */
  base: Q;
}

export function calculateCategoryB(input: CategoryBInput): CategoryBResult {
  const problems = configProblemsB(input);
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
  const orderById = new Map(orders.map((o) => [o.id, o]));
  const invoiceById = new Map(invoices.map((i) => [i.id, i]));
  const customerById = new Map(input.customers.map((c) => [c.id, c]));
  const productById = new Map(input.products.map((p) => [p.id, p]));
  const invoicesOfOrder = new Map<string, InvoiceIn[]>();
  for (const inv of invoices) if (inv.orderId) invoicesOfOrder.set(inv.orderId, [...(invoicesOfOrder.get(inv.orderId) ?? []), inv]);

  // Credit notes and sales returns ("Sales returns": as a credit note, or ignored).
  const returnIds = new Set(events.filter((e) => e.kind === "salesReturn").map((e) => e.documentId));
  const returnsCount = str(s, "b.salesReturns") === "asCreditNote";
  const counts = (cn: CreditNoteIn) => !returnIds.has(cn.id) || returnsCount;
  const cnWord = (cn: CreditNoteIn) => (returnIds.has(cn.id) ? "Sales return" : "Credit note");
  const cnsOf = (invoiceId: string) => creditNotes.filter((cn) => cn.invoiceId === invoiceId && counts(cn));
  const netTaxable = (inv: InvoiceIn): { net: number | null; missing: string | null } => {
    if (inv.taxablePaise === null) return { net: null, missing: `Invoice ${inv.no} has no taxable value.` };
    let net = inv.taxablePaise;
    for (const cn of cnsOf(inv.id)) {
      if (cn.taxablePaise === null) return { net: null, missing: `${cnWord(cn)} ${cn.no} against invoice ${inv.no} has no taxable value.` };
      net -= cn.taxablePaise;
    }
    return { net: Math.max(0, net), missing: null };
  };

  const leftOutFlags = new Set([...list(s, "basis.voucherFilter"), "cancelled"]);
  const leftOut = (o: OrderBIn) => (["cancelled", "optional", "postDated"] as const).filter((k) => o.states[k] && leftOutFlags.has(k));
  const existingMonths = num(s, "b.existingLookbackMonths");
  const noveltyMonths = str(s, "b.noveltyWindow") === "own" ? num(s, "b.noveltyLookbackMonths") : existingMonths;
  const minAmount = num(s, "b.minAmount");
  const ratePpm = num(s, "b.ratePpm");
  const capOrder = cap(s, "caps.perOrder");
  const earnedBy = new Map(input.earned.map((e) => [e.orderId, e]));
  const overrideBy = new Map(input.overrides.map((o) => [o.orderId, o]));

  /* 1–7. Each order: qualification, qualifying invoice and amount. */
  const evaluate = (o: OrderBIn): Evaluated => {
    const reasons: string[] = [];
    const evidence: QualificationResult["evidence"] = { earlierOrders: [], newProducts: [], newBrands: [], unmatchedLines: [], unmatchedHistoryLines: [], creditNotes: [], invoicesConsidered: [] };
    const cust = o.customerId ? customerById.get(o.customerId) : undefined;
    const out = leftOut(o);
    const ov = overrideBy.get(o.id) ?? null;
    const base0 = { orderId: o.id, orderNo: o.no, orderDate: o.date, customerId: o.customerId, customerName: cust?.name ?? null, override: ov ? { id: ov.id, decision: ov.decision, reason: ov.reason, byId: ov.byId, byName: ov.byName } : null, evidence };
    if (out.length) {
      reasons.push(`Left out: the order is ${out.join(", ")} (Orders left out; cancelled orders are always left out of Category B).`);
      if (ov) reasons.push(`A manual decision (${ov.decision}) doesn't bring back an order that is left out.`);
      return { q: { ...base0, automatic: "not-qualified", outcome: "not-qualified", invoiceId: null, invoiceNo: null, invoiceDate: null, invoiceMonth: null, taxablePaise: null, netTaxablePaise: null, baseExact: null, inMonth: false, pinned: false, reasons }, order: o, invoice: null, base: R.ZERO };
    }

    // Existing customer and new product / brand.
    let elig: Outcome;
    const prior = (months: number, same: (h: OrderBIn) => boolean) => orders.filter((h) => same(h) && h.id !== o.id && docKey(h) < docKey(o) && h.date >= monthsBefore(o.date, months) && !leftOut(h).length);
    if (!cust) {
      elig = "needs-review";
      reasons.push(o.customerId ? "Its customer isn't in the Customer Master: needs an admin's review." : "The order's party isn't linked to the Customer Master, so its earlier orders can't be found: needs an admin's review (link it, or decide by hand).");
    } else {
      const earlier = prior(existingMonths, (h) => h.customerId === cust.id);
      evidence.earlierOrders = earlier.map((h) => ({ id: h.id, no: h.no, date: h.date }));
      if (!earlier.length) {
        const unlinked = prior(existingMonths, (h) => !h.customerId && h.partyKey === o.partyKey);
        if (unlinked.length) {
          elig = "needs-review";
          reasons.push(`No earlier order of ${cust.name} in the ${existingMonths} months before ${o.date}, but earlier order${unlinked.length === 1 ? "" : "s"} of the same party ${unlinked.map((h) => h.no).join(", ")} ${unlinked.length === 1 ? "isn't" : "aren't"} linked to the Customer Master: needs an admin's review.`);
        } else {
          elig = "not-qualified";
          reasons.push(`Not an existing customer: no earlier eligible Sales Order of ${cust.name} in the ${existingMonths} months before ${o.date}.`);
        }
      } else {
        const last = earlier[earlier.length - 1]!;
        reasons.push(`Existing customer: ${earlier.length} earlier Sales Order${earlier.length === 1 ? "" : "s"} in the ${existingMonths} months before ${o.date} (latest ${last.no} of ${last.date}).`);
        const hist = prior(noveltyMonths, (h) => h.customerId === cust.id);
        const histLines = hist.flatMap((h) => h.lines);
        const unmatchedHist = histLines.filter((l) => !l.productId || !productById.has(l.productId));
        const histProducts = new Set(histLines.filter((l) => l.productId && productById.has(l.productId)).map((l) => l.productId!));
        const histBrands = new Set([...histProducts].map((id) => normBrand(productById.get(id)!.brand)).filter((b): b is string => b !== null));
        const histNoBrand = [...histProducts].some((id) => normBrand(productById.get(id)!.brand) === null);
        evidence.unmatchedHistoryLines = uniq(unmatchedHist.map((l) => l.item ?? "(no item name)"));
        const newProducts: string[] = [], newBrands: string[] = [], uncertain: string[] = [], unmatched: string[] = [];
        for (const l of o.lines) {
          const p = l.productId ? productById.get(l.productId) : undefined;
          if (!p) {
            unmatched.push(l.item ?? "(no item name)");
            continue;
          }
          const productNew = !histProducts.has(p.id);
          const brand = normBrand(p.brand);
          const brandNew = brand !== null && !histBrands.has(brand);
          if (productNew && !unmatchedHist.length) newProducts.push(p.name);
          else if (productNew) uncertain.push(`${p.name} is new unless one of the earlier unmatched lines was it`);
          if (brandNew && !unmatchedHist.length && !histNoBrand) newBrands.push(p.brand!.trim());
          else if (brandNew) uncertain.push(`brand ${p.brand!.trim()} is new unless an earlier unmatched line, or an earlier product with no brand, had it`);
        }
        evidence.newProducts = uniq(newProducts);
        evidence.newBrands = uniq(newBrands);
        evidence.unmatchedLines = uniq(unmatched);
        if (!o.lines.length) {
          elig = "needs-review";
          reasons.push("The order has no item lines, so its products can't be compared: needs an admin's review.");
        } else if (newProducts.length || newBrands.length) {
          elig = "qualified";
          reasons.push(`New ${[evidence.newProducts.length ? `product${evidence.newProducts.length === 1 ? "" : "s"} ${evidence.newProducts.join(", ")}` : "", evidence.newBrands.length ? `brand${evidence.newBrands.length === 1 ? "" : "s"} ${evidence.newBrands.join(", ")}` : ""].filter(Boolean).join(" and ")}: not on ${cust.name}'s orders in the ${noveltyMonths} months before.`);
        } else if (uncertain.length || unmatched.length) {
          elig = "needs-review";
          if (unmatched.length) reasons.push(`Not matched to the Product Master: ${evidence.unmatchedLines.join(", ")}. An unmatched product is never treated as new: needs an admin's review.`);
          if (uncertain.length) reasons.push(`Can't be decided automatically: ${uniq(uncertain).join("; ")}. Needs an admin's review.`);
        } else {
          elig = "not-qualified";
          reasons.push(`No new product or brand: every product and brand on it was on ${cust.name}'s orders in the ${noveltyMonths} months before.`);
        }
      }
    }

    // The qualifying invoice: the first individual invoice meeting the minimum (fixed once paid out).
    const invs = invoicesOfOrder.get(o.id) ?? [];
    const pin = earnedBy.get(o.id);
    let invoice: InvoiceIn | null = null;
    let invoiceIssue: string | null = null;
    let pinned = false;
    if (pin && invoiceById.has(pin.invoiceId)) {
      invoice = invoiceById.get(pin.invoiceId)!;
      pinned = true;
      const t = netTaxable(invoice);
      evidence.invoicesConsidered.push({ id: invoice.id, no: invoice.no, date: invoice.date, taxablePaise: invoice.taxablePaise, netTaxablePaise: t.net });
      if (t.missing) invoiceIssue = `${t.missing} It can't be reassessed: needs an admin's review.`;
    } else {
      for (const inv of invs) {
        const t = netTaxable(inv);
        evidence.invoicesConsidered.push({ id: inv.id, no: inv.no, date: inv.date, taxablePaise: inv.taxablePaise, netTaxablePaise: t.net });
        if (t.missing) {
          invoiceIssue = `${t.missing} It can't be compared with the minimum: needs an admin's review.`;
          break;
        }
        if (t.net! >= minAmount) {
          invoice = inv;
          break;
        }
      }
    }
    if (invoice) evidence.creditNotes = cnsOf(invoice.id).map((cn) => ({ id: cn.id, no: cn.no, date: cn.date, taxablePaise: cn.taxablePaise, salesReturn: returnIds.has(cn.id) }));
    const decide = (eligibility: Outcome): Outcome => (eligibility !== "qualified" ? eligibility : invoiceIssue ? "needs-review" : invoice ? "qualified" : "not-qualified");
    const automatic = decide(elig);
    const outcome: Outcome = ov ? (ov.decision === "exclude" ? "not-qualified" : decide("qualified")) : automatic;

    if (ov) reasons.push(`Decided by hand by ${ov.byName}: ${ov.decision === "qualify" ? "qualifies" : "doesn't qualify"} — “${ov.reason}” (the rules alone give: ${automatic.replace("-", " ")}).`);
    const net = invoice ? netTaxable(invoice).net : null;
    if (invoiceIssue) reasons.push(invoiceIssue);
    else if (invoice) {
      const cns = evidence.creditNotes;
      reasons.push(`${pinned ? "Paid-out" : "Qualifying"} invoice ${invoice.no} of ${invoice.date}: taxable ${rupees(invoice.taxablePaise ?? 0)}${cns.length ? `, ${rupees(net ?? 0)} after ${cns.map((c) => `${c.salesReturn ? "sales return" : "credit note"} ${c.no}`).join(", ")}` : ""}${pinned ? "" : ` — at least ${rupees(minAmount)}`}.`);
      if (pin) reasons.push(`Its Category B was paid out with this invoice (${pin.month.slice(0, 7)}): it stays the qualifying invoice; a later credit note or return is recovered from later months.`);
    } else if (outcome !== "needs-review" && (elig === "qualified" || ov?.decision === "qualify")) {
      reasons.push(invs.length ? `No individual invoice with a taxable value of at least ${rupees(minAmount)} (after credit notes) yet; invoices are never added together.` : "Not invoiced yet: the qualifying invoice's date decides the month.");
    }

    let base = R.ZERO;
    if (outcome === "qualified" && invoice && net !== null) {
      if (pinned && net < minAmount) reasons.push(`After credit notes its taxable value is ${rupees(net)}, below the minimum of ${rupees(minAmount)}: the whole Category B paid on it is recovered.`);
      else {
        base = R.mul(R.q(net), R.ppm(ratePpm));
        let note = `Incentive: ${pct(ratePpm)} of ${rupees(net)} = ${rupees(R.round(base, "halfUp", "paise"))}`;
        if (capOrder !== null && R.cmp(base, R.q(capOrder)) > 0) {
          base = R.q(capOrder);
          note += `, limited to ${rupees(capOrder)} (most one Sales Order can earn), before collection decay`;
        }
        reasons.push(`${note}.`);
      }
    }
    const inMonth = outcome === "qualified" && !!invoice && monthOf(invoice.date) === month;
    return {
      q: { ...base0, automatic, outcome, invoiceId: invoice?.id ?? null, invoiceNo: invoice?.no ?? null, invoiceDate: invoice?.date ?? null, invoiceMonth: invoice ? `${monthOf(invoice.date)}-01` : null, taxablePaise: invoice?.taxablePaise ?? null, netTaxablePaise: net, baseExact: invoice && outcome === "qualified" ? R.text(base) : null, inMonth, pinned, reasons },
      order: o,
      invoice,
      base,
    };
  };

  // The orders this month concerns: their qualifying invoice is in the month, or (with none) one of their invoices is.
  const reported: Evaluated[] = [];
  for (const o of orders) {
    const invs = invoicesOfOrder.get(o.id) ?? [];
    if (!invs.some((i) => monthOf(i.date) === month) && !(earnedBy.get(o.id)?.month.slice(0, 7) === month)) continue;
    const e = evaluate(o);
    if (e.invoice ? monthOf(e.invoice.date) === month : true) reported.push(e);
  }
  // Invoices of the month with no Sales Order: never qualified automatically, never ignored — they need review.
  const reviewInvoices = invoices
    .filter((i) => monthOf(i.date) === month && (!i.orderId || !orderById.has(i.orderId)))
    .map((i) => ({ invoiceId: i.id, invoiceNo: i.no, invoiceDate: i.date, customerId: i.customerId, reason: `${i.orderId ? "The Sales Order it names isn't in Forms" : "It names no Sales Order"}, so whether it is Category B can't be evaluated (taxable ${i.taxablePaise === null ? "unknown" : rupees(i.taxablePaise)}): needs an admin's review.` }));
  for (const r of reviewInvoices) excluded.push({ documentId: r.invoiceId, documentNo: r.invoiceNo, employeeId: null, message: r.reason });

  /* 8. Receipts applied to invoices, by Category A's rules. */
  const credited = reported.filter((e) => e.q.inMonth);
  const creditedInvoices = new Set(credited.map((e) => e.invoice!.id));
  const invoiceDue = new Map<string, Q>();
  for (const inv of invoices) {
    let due = R.q(inv.totalPaise);
    for (const cn of cnsOf(inv.id)) due = R.sub(due, R.q(cn.totalPaise));
    invoiceDue.set(inv.id, R.max(R.ZERO, due));
  }
  const collectibleOf = new Map([...invoiceDue.entries()].map(([k, v]) => [k, v]));
  const { applied, pieces } = applyReceipts({ settings: s, receipts, events, invoices, invoiceById, invoiceDue, unitIdOfInvoice: (id) => (creditedInvoices.has(id) ? id : null), held }) as { applied: Applied[]; pieces: ReceiptPiece[] };
  const missingDue = str(s, "collection.missingDueDate");
  const boundary = str(s, "collection.stepBoundary");
  const referenceDate = makeReferenceDate(s, (id) => orderById.get(id), (id) => customerById.get(id));

  /* 9. Whose sale, and what each salesperson earns. */
  const people = makePeople({ settings: s, eligibility: cfg.eligibility, employees: input.employees, customers: input.customers, repHistory: input.repHistory, attributions: input.attributions });
  interface Share { e: Evaluated; employeeId: string; sharePpm: number }
  const shares: Share[] = [];
  for (const e of credited) {
    const r = people.resolve({ id: e.order.id, no: e.order.no, customerId: e.order.customerId, repDay: e.order.date, day: e.invoice!.date }, true, month, excluded);
    if (!r) continue;
    for (const x of r) shares.push({ e, employeeId: x.employee.id, sharePpm: x.sharePpm });
  }
  const earning = str(s, "collection.earningBasis");
  const unreceived = str(s, "collection.unreceivedPortion");
  const recovery = str(s, "collection.recoveryAfterNil");
  const level = str(s, "rounding.level");
  const method = str(s, "rounding.method") as R.RoundingMethod;
  const precision = str(s, "rounding.precision") as R.RoundingPrecision;
  const rnd = (x: Q) => R.q(R.round(x, method, precision));
  const capMonth = cap(s, "caps.perEmployeeCategoryMonth");
  const capAll = cap(s, "caps.perEmployeeAllCategoriesMonth");

  const employeesOut: EmployeeResultB[] = [];
  const unitsOut: UnitResult[] = [];
  let settled = true;
  for (const eid of [...new Set(shares.map((x) => x.employeeId))].sort()) {
    const emp = people.employeeById.get(eid)!;
    const mine = shares.filter((x) => x.employeeId === eid);
    const departedDay = people.departed.get(eid)?.lastDay ?? null;
    const why: string[] = [];
    let earnedSum = R.ZERO, payableSum = R.ZERO, projectedSum = R.ZERO, baseSum = R.ZERO, salesSum = R.ZERO;
    for (const sh of mine) {
      const inv = sh.e.invoice!;
      const collectible = collectibleOf.get(inv.id) ?? R.ZERO;
      const unitBase = R.mul(sh.e.base, R.ppm(sh.sharePpm));
      baseSum = R.add(baseSum, unitBase);
      salesSum = R.add(salesSum, R.mul(R.q(sh.e.q.netTaxablePaise ?? 0), R.ppm(sh.sharePpm)));
      const per = R.isZero(collectible) ? R.ZERO : R.div(unitBase, collectible);
      const uWhy = [`Sales Order ${sh.e.order.no}: ${sh.e.q.reasons.join(" ")}`];
      if (sh.sharePpm !== 1_000_000) uWhy.push(`${emp.name}'s share: ${sh.sharePpm / 10_000}%.`);
      let collected = R.ZERO;
      let nil = false;
      const items: { a: Applied; credited: Q; ref: { date: string; from: string } | null; delay: number | null; m: Q | null; note: string; status: ReceiptPiece["status"] }[] = [];
      for (const a of applied.filter((x) => x.invoiceId === inv.id)) {
        const room = R.max(R.ZERO, R.sub(collectible, collected));
        const c = R.min(a.amount, room);
        const over = R.sub(a.amount, c);
        if (!R.isZero(over)) items.push({ a: { ...a, amount: over }, credited: R.ZERO, ref: null, delay: null, m: null, note: "More than the invoice still owed: earns nothing.", status: "over-collected" });
        if (R.isZero(c)) continue;
        collected = R.add(collected, c);
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
            note += " The invoice had already dropped to nil, so it stays nil.";
          } else if (R.isZero(m)) nil = true;
        }
        if (m && departedDay && a.date > departedDay) {
          m = R.ZERO;
          note += ` Received after ${emp.name}'s last working day (${departedDay}).`;
        }
        items.push({ a: { ...a, amount: c }, credited: c, ref, delay, m, note, status });
      }
      const full = R.cmp(collectible, R.ZERO) > 0 && R.cmp(collected, collectible) >= 0;
      const counted = items.filter((x) => x.status === "credited" && x.m);
      const last = counted.length ? counted.reduce((a, b) => (b.a.date > a.a.date || (b.a.date === a.a.date && R.cmp(b.m!, a.m!) < 0) ? b : a)) : null;
      let unitEarned = R.ZERO;
      for (const x of items) {
        let m = x.m;
        if (x.status === "credited" && m && earning === "wholeOrderWorstReceipt") m = last!.m!;
        let amt = x.status === "credited" && m ? R.mul(R.mul(per, x.credited), m) : R.ZERO;
        if (earning === "wholeOrderWeighted" && !full) amt = R.ZERO;
        if (level === "perReceipt") amt = rnd(amt);
        unitEarned = R.add(unitEarned, amt);
        pieces.push({
          receiptId: x.a.receiptId,
          receiptNo: x.a.receiptNo,
          receiptDate: x.a.date,
          invoiceId: x.a.invoiceId,
          unitId: inv.id,
          employeeId: eid,
          amountPaise: R.round(x.status === "over-collected" ? x.a.amount : x.credited, "halfUp", "paise"),
          referenceDate: x.ref?.date ?? null,
          delayDays: x.delay,
          multiplierPpm: m ? Number((m.n * 1_000_000n) / m.d) : null,
          earnedExact: R.text(amt),
          status: x.status,
          note: `${x.note}${earning === "wholeOrderWorstReceipt" && x.status === "credited" && m !== x.m ? " Earns at the invoice's latest payment's rate." : ""}${earning === "wholeOrderWeighted" && !full ? " Earned only once the invoice is fully collected." : ""} Applied to ${x.a.how}.`,
        });
      }
      if (level === "perOrder") unitEarned = rnd(unitEarned);
      // Confirmed decision: only a fully collected invoice is payable.
      const payable = full ? unitEarned : R.ZERO;
      if (!full) uWhy.push(`Collected ${rupees(R.round(collected, "halfUp", "paise"))} of ${rupees(R.round(collectible, "halfUp", "paise"))}: payable once the invoice is fully collected.`);
      const unpaid = R.max(R.ZERO, R.sub(collectible, collected));
      let projected = R.ZERO;
      if (!R.isZero(unpaid)) {
        if (unreceived === "pendingUntilReceived") projected = R.mul(per, unpaid);
        else {
          const ref = referenceDate(inv);
          const st = stepFor(steps, ref ? Math.max(0, daysBetween(ref.date, asOf)) : 0, boundary);
          projected = R.mul(R.mul(per, unpaid), R.ppm(st.multiplierPpm));
        }
      }
      const ref = referenceDate(inv);
      const pastLast = ref !== null && daysBetween(ref.date, asOf) >= lastStepFrom && stepFor(steps, daysBetween(ref.date, asOf), boundary).multiplierPpm === 0;
      if (!full && !pastLast) settled = false;
      earnedSum = R.add(earnedSum, unitEarned);
      payableSum = R.add(payableSum, payable);
      projectedSum = R.add(projectedSum, projected);
      unitsOut.push({ unitId: inv.id, unitNo: inv.no, unitType: "sales-invoices", employeeId: eid, sharePpm: sh.sharePpm, valuePaise: sh.e.q.netTaxablePaise ?? 0, collectiblePaise: R.round(collectible, "halfUp", "paise"), collectedPaise: R.round(collected, "halfUp", "paise"), fullyCollected: full, takesShare: true, allocated: R.text(unitBase), earnedExact: R.text(unitEarned), payableExact: R.text(payable), explanation: uWhy });
    }
    why.push(`${mine.length} Sales Order${mine.length === 1 ? "" : "s"} credited with Category B in ${month}: ${rupees(R.round(baseSum, "halfUp", "paise"))} before collection decay.`);
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
    applyCap(capMonth, "Limited to the most a salesperson can earn from Category B in a month");
    let before: number | undefined;
    if (input.allCategories) {
      before = R.round(earned, method, precision);
      const a = allCategoriesAllowance({ capPaise: input.allCategories.capPaise, policy: input.allCategories.policy, order: input.allCategories.order, own: "B", ownPrePaise: before, others: input.allCategories.others[eid] ?? [] });
      if (a.allowedPaise < before) {
        earned = R.min(earned, R.q(a.allowedPaise));
        payableQ = R.min(payableQ, R.q(a.allowedPaise));
        if (a.note) limits.push(a.note);
      }
    } else applyCap(capAll, "Limited by the most a salesperson can earn from all categories in a month");
    const earnedPaise = R.round(earned, method, precision);
    const payablePaise = R.round(payableQ, method, precision);
    employeesOut.push({ employeeId: eid, name: emp.name, salesPaise: R.round(salesSum, "halfUp", "paise"), qualified: true, ordersCredited: mine.length, baseExact: R.text(baseSum), earnedExact: R.text(earnedSum), payableExact: R.text(payableSum), earnedPaise, payablePaise, pendingPaise: earnedPaise - payablePaise, projectedPaise: R.round(projectedSum, method, precision), ...(before !== undefined ? { beforeAllCategoriesPaise: before } : {}), limits, explanation: why });
  }

  const relevant = pieces.filter((p) => p.employeeId || (p.invoiceId !== null && creditedInvoices.has(p.invoiceId)));
  const order = (p: ReceiptPiece) => `${p.employeeId ?? "~"}|${p.unitId ?? "~"}|${p.receiptDate}|${natural(p.receiptNo)}|${p.receiptId}|${p.invoiceId ?? ""}|${p.status}`;
  return {
    engineVersion: ENGINE_VERSION_B,
    status: "computed",
    problems: [],
    month: input.month,
    asOf,
    configVersionId: input.configVersion!.id,
    configVersionNo: input.configVersion!.versionNo,
    employees: employeesOut,
    units: byKey(unitsOut, (u) => `${u.employeeId}|${invoiceById.get(u.unitId)!.date}|${natural(u.unitNo)}|${u.unitId}`),
    pieces: byKey(relevant, order),
    held: byKey(held.filter((h) => !h.documentId || relevant.some((p) => p.receiptId === h.documentId)), (h) => `${h.documentNo}|${h.documentId}|${h.message}`),
    excluded: byKey(excluded, (h) => `${h.documentNo}|${h.documentId}|${h.employeeId}|${h.message}`),
    qualifications: byKey(reported.map((e) => e.q), (q) => `${q.orderDate}|${natural(q.orderNo)}|${q.orderId}`),
    reviewInvoices: byKey(reviewInvoices, (r) => `${r.invoiceDate}|${natural(r.invoiceNo)}|${r.invoiceId}`),
    settled: settled && credited.length > 0,
    settingsUsed: Object.fromEntries(Object.keys(s).sort().map((k) => [k, s[k]])),
  };
}
