"use client";

import Link from "next/link";
import type { Route } from "next";
import { BLUE, CARD, day, rs } from "./calc-ui";

/**
 * Category B: every Sales Order of the month with its qualification — qualified, not qualified or needs review — the
 * automatic outcome beside any manual decision, the qualifying invoice and the evidence (earlier orders, new products
 * and brands, unmatched records, credit notes). Invoices that name no Sales Order are listed for review. Read-only:
 * decisions are made on Review & decisions, by holders of the qualify permission.
 */

export interface BQualificationRow {
  id: string;
  orderNo: string;
  orderDate: string;
  customerName: string | null;
  outcome: "qualified" | "not-qualified" | "needs-review";
  automaticOutcome: "qualified" | "not-qualified" | "needs-review";
  overrideDecision: "qualify" | "exclude" | null;
  invoiceNo: string | null;
  invoiceDate: string | null;
  netTaxablePaise: number | null;
  baseExact: string | null;
  inMonth: boolean;
  pinned: boolean;
  reasons: string[];
  evidence: { earlierOrders?: { no: string; date: string }[]; newProducts?: string[]; newBrands?: string[]; unmatchedLines?: string[]; creditNotes?: { no: string; date: string }[] };
}
export interface BReviewInvoice {
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string;
  reason: string;
}

const OUTCOME: Record<BQualificationRow["outcome"], { label: string; bg: string; fg: string }> = {
  qualified: { label: "Qualified", bg: "#ECFDF5", fg: "#047857" },
  "not-qualified": { label: "Not qualified", bg: "#F1F5F9", fg: "#475569" },
  "needs-review": { label: "Needs review", bg: "#FFFBEB", fg: "#B45309" },
};
/** "n/d" paise → rupees to the paisa, for display only. */
const exact = (x: string | null) => {
  if (!x) return null;
  const [n, d] = x.split("/");
  return Math.round(Number(n) / Number(d ?? "1"));
};

export function OutcomeBadge({ outcome }: { outcome: BQualificationRow["outcome"] }) {
  const o = OUTCOME[outcome];
  return (
    <span className="inline-flex rounded-pill px-2 py-0.5 text-[11.5px] font-bold" style={{ background: o.bg, color: o.fg }}>
      {o.label}
    </span>
  );
}

export function BQualifications({ rows, reviewInvoices, canQualify }: { rows: BQualificationRow[]; reviewInvoices: BReviewInvoice[]; canQualify: boolean }) {
  const review = rows.filter((r) => r.outcome === "needs-review").length + reviewInvoices.length;
  return (
    <section aria-label="Category B qualification" className="rounded-section bg-white p-4" style={CARD}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[14px] font-bold text-ink-strong">Qualification — each Sales Order of the month</h2>
        {review > 0 && (
          <span role="status" className="rounded-pill px-2 py-0.5 text-[11.5px] font-bold" style={{ background: "#FFFBEB", color: "#B45309" }}>
            {review} need{review === 1 ? "s" : ""} review
          </span>
        )}
        {canQualify && (
          <Link href={"/master-setup/incentive-rules/calculation/qualifications" as Route} className="ml-auto text-[12.5px] font-semibold underline-offset-2 hover:underline" style={{ color: BLUE }}>
            Review & decide by hand ↗
          </Link>
        )}
      </div>
      {!rows.length ? (
        <p className="mt-1 text-[12.5px] text-ink-subtle">No Sales Order has an invoice in this month.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[12.5px]" style={{ minWidth: 860 }} aria-label="Qualification">
            <thead>
              <tr className="text-left text-ink-subtle">
                {["Sales Order", "Customer", "Outcome", "Qualifying invoice", "Net taxable", "Before decay", "Evidence"].map((h) => (
                  <th key={h} className="px-2 py-1 font-semibold">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-hairline align-top">
                  <td className="px-2 py-1.5 font-semibold text-ink-strong">
                    {r.orderNo}
                    <span className="block text-[11.5px] font-normal text-ink-muted">{day(r.orderDate)}</span>
                  </td>
                  <td className="px-2 py-1.5">{r.customerName ?? <span className="text-[#B45309]">Not linked</span>}</td>
                  <td className="px-2 py-1.5">
                    <OutcomeBadge outcome={r.outcome} />
                    {r.overrideDecision && <span className="mt-0.5 block text-[11.5px] text-ink-muted">Decided by hand ({r.overrideDecision === "qualify" ? "qualifies" : "doesn't qualify"}); the rules alone: {OUTCOME[r.automaticOutcome].label.toLowerCase()}</span>}
                    {r.pinned && <span className="mt-0.5 block text-[11.5px] text-ink-muted">Paid out: its invoice is fixed</span>}
                  </td>
                  <td className="px-2 py-1.5">{r.invoiceNo ? `${r.invoiceNo} · ${day(r.invoiceDate)}` : "—"}</td>
                  <td className="px-2 py-1.5 tabular-nums">{rs(r.netTaxablePaise)}</td>
                  <td className="px-2 py-1.5 tabular-nums">{rs(exact(r.baseExact))}</td>
                  <td className="px-2 py-1.5 text-ink-muted">
                    <details>
                      <summary className="cursor-pointer text-[12px]">Why</summary>
                      <ul className="list-disc pl-4">
                        {r.reasons.map((x, i) => (
                          <li key={i}>{x}</li>
                        ))}
                      </ul>
                      {!!r.evidence.earlierOrders?.length && <p className="mt-1">Earlier orders: {r.evidence.earlierOrders.map((o) => `${o.no} (${o.date})`).join(", ")}</p>}
                      {!!r.evidence.unmatchedLines?.length && <p className="mt-1 text-[#B45309]">Unmatched: {r.evidence.unmatchedLines.join(", ")}</p>}
                    </details>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!!reviewInvoices.length && (
        <div className="mt-3">
          <h3 className="text-[13px] font-bold text-ink-strong">Invoices with no Sales Order — need review</h3>
          <ul className="mt-1 grid gap-0.5 text-[12.5px] text-ink-muted" aria-label="Invoices needing review">
            {reviewInvoices.map((r) => (
              <li key={r.invoiceId}>
                <strong className="text-ink-strong">{r.invoiceNo}</strong> · {day(r.invoiceDate)} — {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
