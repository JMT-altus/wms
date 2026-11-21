"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { fireToast } from "@/lib/toast";
import { recordCategoryBDecision, recordCategoryBInvoiceReview, retireCategoryBDecision, retireCategoryBInvoiceReview } from "@/app/(masters)/master-setup/incentive-rules/calculation/actions";
import { BLUE, BTN, BTN_PLAIN, CARD, FIELD, Notice, NotReady, RetireButton, day, rs } from "./calc-ui";
import { OutcomeBadge } from "./b-qualifications";
import type { InvoiceReview, ReviewRow } from "@/lib/queries/incentive-b-qualify";

/** Record that an invoice with no Sales Order isn't a Category B sale, with the reason (0140). */
function InvoiceReviewForm({ invoiceId, invoiceNo, onDone }: { invoiceId: string; invoiceNo: string; onDone: () => void }) {
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-2" aria-label={`Review ${invoiceNo}`}>
      <input className={`${FIELD} w-80`} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label={`Reason for ${invoiceNo}`} maxLength={1000} />
      <button
        type="button"
        className={BTN}
        style={{ background: BLUE }}
        disabled={busy || !reason.trim()}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await recordCategoryBInvoiceReview({ invoiceId, reason: reason.trim() });
          setBusy(false);
          if (!r.ok) return setError(r.error);
          fireToast({ message: "Recorded: not a Category B sale.", type: "success" });
          setReason("");
          onDone();
        }}
      >
        Not a Category B sale
      </button>
      {error && <span role="alert" className="text-[12.5px] font-semibold text-[#B91C1C]">{error}</span>}
    </div>
  );
}

/**
 * Category B → Review & decisions. The month's orders needing review (or every order), each with its evidence and
 * reasons; an authorised admin decides one by hand — qualifies or doesn't — with a REQUIRED reason, or retires a
 * decision (also with a reason). Decisions apply at the month's next calculation; the automatic outcome stays beside
 * them. Without the qualify permission everything is read-only. The server checks every action again.
 */

interface Found {
  id: string;
  no: string;
  date: string;
  customerName: string;
  override: { id: string; decision: "qualify" | "exclude"; reason: string; byName: string } | null;
}

const exact = (x: string | null) => {
  if (!x) return null;
  const [n, d] = x.split("/");
  return Math.round(Number(n) / Number(d ?? "1"));
};

function DecideForm({ orderId, orderNo, onDone }: { orderId: string; orderNo: string; onDone: () => void }) {
  const [decision, setDecision] = React.useState<"qualify" | "exclude">("qualify");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" aria-label={`Decide ${orderNo}`}>
      <select className={FIELD} value={decision} onChange={(e) => setDecision(e.target.value as "qualify" | "exclude")} aria-label={`Decision for ${orderNo}`}>
        <option value="qualify">Qualifies for Category B</option>
        <option value="exclude">Doesn&apos;t qualify</option>
      </select>
      <input className={`${FIELD} w-80`} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label={`Reason for ${orderNo}`} maxLength={1000} />
      <button
        type="button"
        className={BTN}
        style={{ background: BLUE }}
        disabled={busy || !reason.trim()}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await recordCategoryBDecision({ orderId, decision, reason: reason.trim() });
          setBusy(false);
          if (!r.ok) return setError(r.error);
          fireToast({ message: "Decision recorded. It applies at the month's next calculation.", type: "success" });
          setReason("");
          onDone();
        }}
      >
        Record decision
      </button>
      {error && <span role="alert" className="text-[12.5px] font-semibold text-[#B91C1C]">{error}</span>}
    </div>
  );
}

export function BReview(p: {
  ready: boolean;
  canDecide: boolean;
  programs: { id: string; code: string; name: string }[];
  programId: string | null;
  month: string;
  all: boolean;
  search: string;
  source: { runId: string; adopted: boolean; asOf: string; configVersionNo: number | null } | null;
  rows: ReviewRow[];
  reviewInvoices: { invoiceId: string; invoiceNo: string; invoiceDate: string; reason: string }[];
  /** 0140: whether invoice reviews can be recorded, and every review of the listed invoices. */
  invoiceReviewsReady?: boolean;
  invoiceReviews?: InvoiceReview[];
  found: Found[];
}) {
  const invoiceReviewsReady = p.invoiceReviewsReady ?? false;
  const invoiceReviews = p.invoiceReviews ?? [];
  const router = useRouter();
  const [search, setSearch] = React.useState(p.search);
  const go = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams({ ...(p.programId ? { program: p.programId } : {}), month: p.month.slice(0, 7), ...(p.all ? { all: "1" } : {}), ...(p.search ? { q: p.search } : {}) });
    for (const [k, v] of Object.entries(patch)) if (v === null) q.delete(k);
    else q.set(k, v);
    router.push(`/master-setup/incentive-rules/calculation/qualifications?${q}` as Route);
  };
  const retire = async (id: string, reason: string) => {
    const r = await retireCategoryBDecision({ id, reason });
    if (!r.ok) fireToast({ message: r.error, type: "error" });
    else fireToast({ message: "Decision retired. The order returns to its automatic outcome at the next calculation.", type: "success" });
    router.refresh();
  };
  const retireInvoice = async (id: string, reason: string) => {
    const r = await retireCategoryBInvoiceReview({ id, reason });
    if (!r.ok) fireToast({ message: r.error, type: "error" });
    else fireToast({ message: "Review retired. The invoice needs review again before the month goes ahead.", type: "success" });
    router.refresh();
  };
  if (!p.ready) return <NotReady category="B" />;
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
          Programme
          <select className={FIELD} value={p.programId ?? ""} onChange={(e) => go({ program: e.target.value })} aria-label="Programme">
            {p.programs.map((x) => (
              <option key={x.id} value={x.id}>
                {x.code} · {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 text-[12px] font-semibold text-ink-muted">
          Month
          <input type="month" className={FIELD} value={p.month.slice(0, 7)} onChange={(e) => e.target.value && go({ month: e.target.value })} aria-label="Month" />
        </label>
        <label className="inline-flex items-center gap-1.5 text-[12.5px] text-ink-muted">
          <input type="checkbox" checked={p.all} onChange={(e) => go({ all: e.target.checked ? "1" : null })} /> Every order of the month (not only review cases)
        </label>
        {!p.canDecide && <span className="ml-auto text-[12px] text-ink-subtle">Read-only: deciding needs the “Decide Category B qualification” permission.</span>}
      </div>

      {!p.source ? (
        <Notice tone="info">This month has no Category B calculation yet. Calculate it first (Calculation tab); review cases appear here.</Notice>
      ) : (
        <p className="text-[12.5px] text-ink-muted">
          From the month&apos;s {p.source.adopted ? "adopted" : "latest"} calculation · configuration version {p.source.configVersionNo} · as of {day(p.source.asOf)}. A decision applies at the next calculation.
        </p>
      )}

      {p.source && (
        <section aria-label="Orders to review" className="rounded-section bg-white p-4" style={CARD}>
          <h2 className="text-[14px] font-bold text-ink-strong">{p.all ? "Every order of the month" : "Orders that need review"} ({p.rows.length})</h2>
          {!p.rows.length && <p className="mt-1 text-[12.5px] text-ink-subtle">Nothing needs review this month.</p>}
          <ul className="mt-2 grid gap-3">
            {p.rows.map((r) => (
              <li key={r.orderId ?? r.orderNo} className="rounded-lg p-3 text-[12.5px]" style={{ border: "1px solid var(--color-hairline)" }}>
                <div className="flex flex-wrap items-center gap-2">
                  <strong className="text-[13px] text-ink-strong">{r.orderNo}</strong>
                  <span className="text-ink-muted">{day(r.orderDate)} · {r.customerName ?? "customer not linked"}</span>
                  <OutcomeBadge outcome={r.outcome} />
                  {r.outcome !== r.automatic && <span className="text-ink-muted">(the rules alone: {r.automatic.replace("-", " ")})</span>}
                  {r.invoiceNo && <span className="text-ink-muted">· invoice {r.invoiceNo} · {rs(r.netTaxablePaise)} taxable{r.baseExact ? ` · ${rs(exact(r.baseExact))} before decay` : ""}</span>}
                </div>
                <ul className="mt-1 list-disc pl-5 text-ink-muted">
                  {r.reasons.map((x, i) => (
                    <li key={i}>{x}</li>
                  ))}
                </ul>
                {r.override ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg px-2 py-1.5" style={{ background: "#F5F3FF" }}>
                    <span>
                      Decided by hand by <strong>{r.override.byName}</strong> on {day(r.override.at)}: <strong>{r.override.decision === "qualify" ? "qualifies" : "doesn't qualify"}</strong> — “{r.override.reason}”
                    </span>
                    {p.canDecide && <RetireButton label={`decision on ${r.orderNo}`} onRetire={(why) => retire(r.override!.id, why)} />}
                  </div>
                ) : (
                  p.canDecide && r.orderId && <DecideForm orderId={r.orderId} orderNo={r.orderNo} onDone={() => router.refresh()} />
                )}
                {!!r.history.length && (
                  <details className="mt-1 text-ink-muted">
                    <summary className="cursor-pointer text-[12px]">Decision history ({r.history.length})</summary>
                    <ul className="mt-1 grid gap-0.5" aria-label={`History of ${r.orderNo}`}>
                      {r.history.map((h, i) => (
                        <li key={i}>
                          {day(h.at)} · {h.actorName} · {h.action === "record" ? `recorded (${h.decision === "qualify" ? "qualifies" : "doesn't qualify"})` : "retired"}
                          {h.note ? ` — “${h.note}”` : ""}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {!!p.reviewInvoices.length && (
        <section aria-label="Invoices with no Sales Order" className="rounded-section bg-white p-4 text-[12.5px]" style={CARD}>
          <h2 className="text-[14px] font-bold text-ink-strong">Invoices with no Sales Order ({p.reviewInvoices.length})</h2>
          <p className="mt-0.5 text-ink-muted">
            They can&apos;t be evaluated for Category B. Link each to its Sales Order in Forms and recalculate — or, if it isn&apos;t a Category B sale, record that with the reason. Until every one is decided, the month isn&apos;t submitted, approved or paid. Whoever decides one never approves the month.
          </p>
          {!invoiceReviewsReady && <p className="mt-1 text-[12px] font-semibold text-[#B45309]">Recording a review needs database update 0140; until then, correct the Sales Order link in Forms and recalculate.</p>}
          <ul className="mt-1 grid gap-2 text-ink-muted">
            {p.reviewInvoices.map((r) => {
              const mine = invoiceReviews.filter((x) => x.invoiceId === r.invoiceId);
              const active = mine.find((x) => !x.retiredAt) ?? null;
              return (
                <li key={r.invoiceId} aria-label={`Invoice ${r.invoiceNo}`}>
                  <strong className="text-ink-strong">{r.invoiceNo}</strong> · {day(r.invoiceDate)} — {r.reason}
                  {active ? (
                    <span className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px]">
                      <span className="font-semibold text-[#047857]">Reviewed: not a Category B sale</span> — {active.reason} ({active.byName}, {day(active.at)})
                      {p.canDecide && <RetireButton label={`review of ${r.invoiceNo}`} onRetire={(why) => retireInvoice(active.id, why)} />}
                    </span>
                  ) : (
                    <span className="mt-0.5 block text-[12px] font-semibold text-[#B45309]">Needs review</span>
                  )}
                  {mine.some((x) => x.retiredAt) && (
                    <details className="mt-0.5 text-[11.5px]">
                      <summary className="cursor-pointer">History ({mine.length})</summary>
                      <ul>
                        {mine.map((x) => (
                          <li key={x.id}>
                            Not Category B — {x.reason} ({x.byName}, {day(x.at)}){x.retiredAt ? `; retired ${day(x.retiredAt)}: ${x.retiredReason}` : ""}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {!active && p.canDecide && invoiceReviewsReady && <InvoiceReviewForm invoiceId={r.invoiceId} invoiceNo={r.invoiceNo} onDone={() => router.refresh()} />}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {p.canDecide && (
        <section aria-label="Decide any Sales Order" className="rounded-section bg-white p-4 text-[12.5px]" style={CARD}>
          <h2 className="text-[14px] font-bold text-ink-strong">Decide another Sales Order</h2>
          <form
            className="mt-2 flex flex-wrap items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              go({ q: search.trim() || null });
            }}
          >
            <input className={`${FIELD} w-72`} placeholder="Sales Order number or party" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Find a Sales Order" />
            <button type="submit" className={BTN_PLAIN}>
              Find
            </button>
          </form>
          {p.search && !p.found.length && <p className="mt-1 text-ink-subtle">No Sales Order matches “{p.search}”.</p>}
          <ul className="mt-2 grid gap-2">
            {p.found.map((f) => (
              <li key={f.id}>
                <strong className="text-ink-strong">{f.no}</strong> · {day(f.date)} · {f.customerName}
                {f.override ? (
                  <span className="ml-2 text-ink-muted">
                    already decided by {f.override.byName}: {f.override.decision === "qualify" ? "qualifies" : "doesn't qualify"} — “{f.override.reason}”
                  </span>
                ) : (
                  <DecideForm orderId={f.id} orderNo={f.no} onDone={() => router.refresh()} />
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
