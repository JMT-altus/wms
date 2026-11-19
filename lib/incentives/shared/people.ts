import type { EligibilityRow, SettingValue } from "@/lib/incentives/rules-config/spec";
import { monthOf } from "./dates";

/**
 * Whose sale it is (Salesperson Eligibility) — shared by the incentive engines. PURE. The attribution source, history
 * and shared credit, the version's eligibility rows and people who left all come from the published settings.
 */

export interface PersonIn {
  id: string;
  name: string;
  role: string;
  departmentId: string | null;
  isActive: boolean;
}
export interface CustomerRef {
  id: string;
  name: string;
  salesRepId: string | null;
}
export interface RepRow {
  customerId: string;
  employeeId: string;
  from: string;
  to: string | null;
}
export interface AttributionRow {
  documentId: string;
  employeeId: string;
  sharePpm: number;
}
export interface Note {
  documentId: string | null;
  documentNo: string | null;
  employeeId: string | null;
  message: string;
}

/** A unit of credit: the document its attribution is recorded on, its customer, and the days that decide whose it is. */
export interface CreditUnit {
  id: string;
  no: string;
  customerId: string | null;
  /** The day a representative is looked up for (attribution.historical = repAtOrderDate). */
  repDay: string;
  /** The day eligibility and leaving are judged on. */
  day: string;
}

export function makePeople<E extends PersonIn>(args: {
  settings: Readonly<Record<string, SettingValue>>;
  eligibility: readonly EligibilityRow[];
  employees: readonly E[];
  customers: readonly CustomerRef[];
  repHistory: readonly RepRow[];
  attributions: readonly AttributionRow[];
}) {
  const s = args.settings;
  const attrSource = s["attribution.source"] as string;
  const historical = s["attribution.historical"] as string;
  const split = s["attribution.split"] as string;
  const inactive = s["eligibility.inactiveEmployees"] as string;
  const elig = args.eligibility;
  const employeeById = new Map(args.employees.map((e) => [e.id, e]));
  const customerById = new Map(args.customers.map((c) => [c.id, c]));
  const matches = (e: PersonIn, r: EligibilityRow) => (r.subjectType === "employee" ? r.subjectId === e.id : r.subjectType === "department" ? r.subjectId !== null && r.subjectId === e.departmentId : r.role === e.role);
  const covers = (r: EligibilityRow, day: string) => r.effectiveFrom <= day && (r.effectiveTo === null || r.effectiveTo >= day);
  /** Whether the configuration covers the employee on the day, or why not. */
  const eligibleOn = (e: PersonIn, day: string): string | null => {
    if (!elig.some((r) => r.mode === "include" && matches(e, r) && covers(r, day))) return `${e.name} isn't included in Salesperson Eligibility on ${day}.`;
    const ex = elig.find((r) => r.mode === "exclude" && matches(e, r) && covers(r, day));
    if (ex) return `${e.name} is excluded on ${day} (${ex.subjectLabel}).`;
    return null;
  };
  /** A departed employee's last working day: the end of the inclusion that covers them (the WMS records no leaving date elsewhere). */
  const lastDayOf = (e: PersonIn): string | null => {
    const ends = elig.filter((r) => r.mode === "include" && matches(e, r)).map((r) => r.effectiveTo);
    if (!ends.length || ends.some((x) => x === null)) return null;
    return (ends as string[]).sort().at(-1)!;
  };
  const departed = new Map<string, { lastDay: string | null }>();
  for (const e of args.employees) if (!e.isActive) departed.set(e.id, { lastDay: lastDayOf(e) });

  const sharesOf = (u: CreditUnit): { shares: { employeeId: string; sharePpm: number }[] } | { why: string } => {
    if (attrSource === "attributionRecord") {
      const rows = args.attributions.filter((a) => a.documentId === u.id);
      if (!rows.length) return { why: "No salesperson is assigned to it (Incentive Rules attribution)." };
      const total = rows.reduce((a, r) => a + r.sharePpm, 0);
      if (split === "single" && (rows.length !== 1 || rows[0]!.sharePpm !== 1_000_000)) return { why: "Shared credit is set to one salesperson per order, but its assignment names several or less than 100%." };
      if (total !== 1_000_000) return { why: `Its assigned shares add up to ${total / 10_000}%, not 100%.` };
      return { shares: rows.map((r) => ({ employeeId: r.employeeId, sharePpm: r.sharePpm })) };
    }
    if (attrSource === "orderSalesperson") {
      // The salesperson recorded for the Forms order (Incentive Rules → Order Salespeople, linked from the order's page):
      // one person, 100%. Tally's import carries no salesperson, so an order without a record stays unattributed.
      const rows = args.attributions.filter((a) => a.documentId === u.id);
      if (!rows.length) return { why: "No salesperson is recorded for this order yet (Order Salespeople)." };
      if (rows.length !== 1 || rows[0]!.sharePpm !== 1_000_000) return { why: "A salesperson recorded on the order must be one person at 100%; this order's record names several or less." };
      return { shares: [{ employeeId: rows[0]!.employeeId, sharePpm: 1_000_000 }] };
    }
    // customerSalesRep
    const cust = u.customerId ? customerById.get(u.customerId) : undefined;
    if (!cust) return { why: "Its customer isn't in the Customer Master." };
    if (historical === "currentRep") return cust.salesRepId ? { shares: [{ employeeId: cust.salesRepId, sharePpm: 1_000_000 }] } : { why: `${cust.name} has no sales representative.` };
    const rows = args.repHistory.filter((r) => r.customerId === cust.id && r.from <= u.repDay && (r.to === null || r.to >= u.repDay));
    if (!rows.length) return { why: `No representative of ${cust.name} is on record for ${u.repDay}.` };
    if (new Set(rows.map((r) => r.employeeId)).size > 1) return { why: `Several representatives of ${cust.name} are on record for ${u.repDay}.` };
    return { shares: [{ employeeId: rows[0]!.employeeId, sharePpm: 1_000_000 }] };
  };

  /**
   * The unit's eligible salespeople and shares. Every reason someone isn't credited is added to `excluded` when the
   * unit belongs to the month being calculated (`inMonth`). `month` is the calculated month (yyyy-mm).
   */
  const resolve = (u: CreditUnit, inMonth: boolean, month: string, excluded: Note[]): { employee: E; sharePpm: number }[] | null => {
    const r = sharesOf(u);
    if ("why" in r) {
      if (inMonth) excluded.push({ documentId: u.id, documentNo: u.no, employeeId: null, message: `Not credited to anyone: ${r.why}` });
      return null;
    }
    const out: { employee: E; sharePpm: number }[] = [];
    for (const sh of r.shares) {
      const e = employeeById.get(sh.employeeId);
      if (!e) {
        if (inMonth) excluded.push({ documentId: u.id, documentNo: u.no, employeeId: sh.employeeId, message: "Its salesperson is no longer an employee." });
        continue;
      }
      const notEligible = eligibleOn(e, u.day);
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
        const out1 = inactive === "excludeFromMonthLeft" ? month >= monthOf(d.lastDay) : u.day > d.lastDay;
        if (out1) {
          if (inMonth) excluded.push({ documentId: u.id, documentNo: u.no, employeeId: e.id, message: inactive === "excludeFromMonthLeft" ? `${e.name} left in ${monthOf(d.lastDay)}: nothing from that month on.` : `${e.name}'s last working day was ${d.lastDay}.` });
          continue;
        }
      }
      out.push({ employee: e, sharePpm: sh.sharePpm });
    }
    return out;
  };

  return { employeeById, customerById, eligibleOn, departed, sharesOf, resolve };
}
