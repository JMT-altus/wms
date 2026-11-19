"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { fireToast } from "@/lib/toast";
import { recordCategoryCDecision, retireCategoryCDecision } from "@/app/(masters)/master-setup/incentive-rules/calculation/actions";
import { BLUE, BTN, CARD, FIELD, Notice, NotReady, RetireButton, day, rs } from "./calc-ui";
import type { CReviewRow, UnattributedQueue, UnattributedRow } from "@/lib/queries/incentive-c-review";

/**
 * Category C → Review & decisions. Every record the month's calculation HELD — never qualified automatically — with
 * why; an authorised admin LINKS it to what it belongs to, or EXCLUDES it, always with a REQUIRED reason, or retires a
 * decision (also with a reason). A decision applies at the month's next calculation and never awards anything by
 * itself. Without the review permission everything is read-only; the server checks every action again.
 */

const KIND: Record<CReviewRow["caseKind"], { label: string; link: string }> = {
  "order-customer": { label: "Sales Order without a customer", link: "Link to customer" },
  "invoice-order": { label: "Invoice without a Sales Order", link: "Link to Sales Order" },
  "credit-note-invoice": { label: "Credit note without an invoice", link: "Link to invoice" },
  "return-credit-note": { label: "Sales return not on a credit note", link: "Link to credit note" },
  "receipt-customer": { label: "Receipt without a customer, or for another customer", link: "Link to customer" },
  "customer-salesperson": { label: "Nobody can be credited", link: "" },
};

function DecideForm({ row, onDone }: { row: Pick<CReviewRow, "caseKind" | "documentId" | "documentNo" | "targets">; onDone: () => void }) {
  const [decision, setDecision] = React.useState<"link" | "exclude">("link");
  const [target, setTarget] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ok = reason.trim() && (decision === "exclude" || target);
  return (
    <div className="mt-2 flex flex-wrap items-center gap-2" aria-label={`Decide ${row.documentNo}`}>
      <select className={FIELD} value={decision} onChange={(e) => setDecision(e.target.value as "link" | "exclude")} aria-label={`Decision for ${row.documentNo}`}>
        <option value="link">{KIND[row.caseKind].link}</option>
        <option value="exclude">Exclude it</option>
      </select>
      {decision === "link" && (
        <select className={`${FIELD} w-64`} value={target} onChange={(e) => setTarget(e.target.value)} aria-label={`Belongs to (${row.documentNo})`}>
          <option value="">Choose…</option>
          {row.targets.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
        </select>
      )}
      <input className={`${FIELD} w-80`} placeholder="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} aria-label={`Reason for ${row.documentNo}`} maxLength={1000} />
      <button
        type="button"
        className={BTN}
        style={{ background: BLUE }}
        disabled={busy || !ok}
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await recordCategoryCDecision({ documentId: row.documentId, caseKind: row.caseKind, decision, targetId: decision === "link" ? target : null, reason: reason.trim() });
          setBusy(false);
          if (!r.ok) return setError(r.error);
          fireToast({ message: "Decision recorded. It applies at the month's next calculation.", type: "success" });
          setReason("");
          onDone();
        }}
      >
        Record decision
      </button>
      {error && (
        <span role="alert" className="text-[12.5px] font-semibold text-[#B91C1C]">
          {error}
        </span>
      )}
    </div>
  );
}

export function CReview(p: {
  ready: boolean;
  canDecide: boolean;
  programs: { id: string; code: string; name: string }[];
  programId: string | null;
  month: string;
  source: { runId: string; adopted: boolean; asOf: string; configVersionNo: number | null } | null;
  rows: CReviewRow[];
  unattributed?: UnattributedQueue;
  search?: string;
  status?: string;
}) {
  const router = useRouter();
  const go = (patch: Record<string, string>) => {
    const q = new URLSearchParams({ ...(p.programId ? { program: p.programId } : {}), month: p.month.slice(0, 7), ...patch });
    router.push(`/master-setup/incentive-rules/calculation/c-review?${q}` as Route);
  };
  const retire = async (id: string, reason: string) => {
    const r = await retireCategoryCDecision({ id, reason });
    if (!r.ok) fireToast({ message: r.error, type: "error" });
    else fireToast({ message: "Decision retired. The record is held again at the next calculation.", type: "success" });
    router.refresh();
  };
  if (!p.ready) return <NotReady category="C" />;
  const q = (patch: Record<string, string>) => go({ ...(p.search ? { uq: p.search } : {}), ...(p.status ? { us: p.status } : {}), ...patch });
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
        {!p.canDecide && <span className="ml-auto text-[12px] text-ink-subtle">Read-only: deciding needs the “Decide Category C review cases” permission.</span>}
      </div>

      {!p.source ? (
        <Notice tone="info">This month has no Category C calculation yet. Calculate it first (Calculation tab); the records it holds for review appear here.</Notice>
      ) : (
        <p className="text-[12.5px] text-ink-muted">
          From the month&apos;s {p.source.adopted ? "adopted" : "latest"} calculation · configuration version {p.source.configVersionNo} · as of {day(p.source.asOf)}. A held record never qualifies by itself; a decision applies at the next calculation.
        </p>
      )}

      {p.source && (
        <section aria-label="Records held for review" className="rounded-section bg-white p-4" style={CARD}>
          <h2 className="text-[14px] font-bold text-ink-strong">Records held for review ({p.rows.length})</h2>
          {!p.rows.length && <p className="mt-1 text-[12.5px] text-ink-subtle">Nothing is held for review this month.</p>}
          <ul className="mt-2 grid gap-3">
            {p.rows.map((r) => (
              <li key={`${r.caseKind}|${r.documentId}`} className="rounded-lg border border-hairline p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="rounded-pill px-2 py-0.5 text-[11px] font-bold" style={{ background: "#FEF3C7", color: "#92400E" }}>
                    {KIND[r.caseKind].label}
                  </span>
                  <strong className="text-[13px] text-ink-strong">{r.documentNo}</strong>
                </div>
                <p className="mt-1 text-[12.5px] text-ink-muted">{r.message}</p>
                {r.decision ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px]">
                    <span className="font-semibold text-ink-strong">
                      Decided: {r.decision.decision === "link" ? `linked to ${r.decision.targetLabel ?? "the chosen record"}` : "excluded"}
                    </span>
                    <span className="text-ink-muted">
                      — “{r.decision.reason}” ({r.decision.byName}, {day(r.decision.at)})
                    </span>
                    {p.canDecide && <RetireButton label={`Retire the decision on ${r.documentNo}`} onRetire={(reason) => retire(r.decision!.id, reason)} />}
                  </div>
                ) : !r.decidable ? (
                  <p className="mt-2 text-[12.5px]">
                    Resolve it in{" "}
                    <Link href={"/master-setup/incentive-rules/calculation/salespeople" as Route} className="font-semibold underline-offset-2 hover:underline" style={{ color: BLUE }}>
                      Order salespeople
                    </Link>{" "}
                    or{" "}
                    <Link href={"/master-setup/incentive-rules/calculation/representatives" as Route} className="font-semibold underline-offset-2 hover:underline" style={{ color: BLUE }}>
                      Representatives
                    </Link>
                    , then recalculate.
                  </p>
                ) : (
                  p.canDecide && <DecideForm row={r} onDone={() => router.refresh()} />
                )}
                {r.history.length > 0 && (
                  <details className="mt-2 text-[12px] text-ink-muted">
                    <summary className="cursor-pointer">History ({r.history.length})</summary>
                    <ul className="mt-1 grid gap-0.5">
                      {r.history.map((h, i) => (
                        <li key={i}>
                          {day(h.at)} · {h.action === "record" ? "Recorded" : "Retired"} by {h.actorName}
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

      {p.unattributed?.ready && <Unattributed queue={p.unattributed} canDecide={p.canDecide} search={p.search ?? ""} status={p.status ?? "unresolved"} onFilter={q} onRetire={retire} onDone={() => router.refresh()} />}
    </div>
  );
}

const TYPE: Record<string, string> = { "sales-orders": "Sales Order", "sales-invoices": "Sales Invoice", "credit-notes": "Credit Note", "customer-receipts": "Customer Receipt" };
const STATUS: Record<UnattributedRow["status"], { label: string; bg: string; fg: string }> = {
  unresolved: { label: "Unresolved", bg: "#FEF3C7", fg: "#92400E" },
  linked: { label: "Linked", bg: "#DCFCE7", fg: "#166534" },
  excluded: { label: "Excluded", bg: "#F1F5F9", fg: "#334155" },
};

/**
 * Every Forms record with no customer (Sales Orders, Sales Invoices, Credit Notes, Customer Receipts) that nothing it
 * names places, and every invoice naming something that isn't a Sales Order — across all customers, in the range
 * Category C looks at for the month. Decided once, globally, with a reason. While one is unresolved the month can't be
 * submitted. A matching Tally party is shown as a proposal only; nothing is linked automatically.
 */
function Unattributed({ queue, canDecide, search, status, onFilter, onRetire, onDone }: { queue: UnattributedQueue; canDecide: boolean; search: string; status: string; onFilter: (patch: Record<string, string>) => void; onRetire: (id: string, reason: string) => Promise<void>; onDone: () => void }) {
  const [text, setText] = React.useState(search);
  return (
    <section aria-label="Unattributed records" className="rounded-section bg-white p-4" style={CARD}>
      <h2 className="text-[14px] font-bold text-ink-strong">Unattributed records ({queue.counts.unresolved} unresolved)</h2>
      <p className="mt-0.5 text-[12.5px] text-ink-muted">
        Forms records from {day(queue.from)} to {day(queue.to)} that no customer or reference places — for every customer, not only this month&apos;s. While one is unresolved, Category C&apos;s month can&apos;t be submitted. {queue.counts.linked} linked · {queue.counts.excluded} excluded.
      </p>
      <form
        className="mt-2 flex flex-wrap items-end gap-2"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          onFilter({ uq: text.trim() });
        }}
      >
        <input className={`${FIELD} w-64`} placeholder="Number or party" value={text} onChange={(e) => setText(e.target.value)} aria-label="Search unattributed records" />
        <select className={FIELD} value={status} onChange={(e) => onFilter({ us: e.target.value })} aria-label="Status">
          <option value="unresolved">Unresolved</option>
          <option value="linked">Linked</option>
          <option value="excluded">Excluded</option>
          <option value="all">All</option>
        </select>
        <button type="submit" className={BTN} style={{ background: BLUE }}>
          Search
        </button>
      </form>
      {!queue.rows.length && <p className="mt-2 text-[12.5px] text-ink-subtle">Nothing matches.</p>}
      <ul className="mt-2 grid gap-3">
        {queue.rows.map((r) => (
          <li key={r.documentId} className="rounded-lg border border-hairline p-3">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="rounded-pill px-2 py-0.5 text-[11px] font-bold" style={{ background: STATUS[r.status].bg, color: STATUS[r.status].fg }}>
                {STATUS[r.status].label}
              </span>
              <span className="text-[12px] text-ink-subtle">{TYPE[r.documentType] ?? r.documentType}</span>
              <strong className="text-[13px] text-ink-strong">{r.documentNo}</strong>
              <span className="text-[12px] text-ink-muted">
                {day(r.date)} · {r.partyName} · {rs(r.totalPaise)}
              </span>
            </div>
            <p className="mt-1 text-[12.5px] text-ink-muted">{r.message}</p>
            {r.decision ? (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[12.5px]">
                <span className="font-semibold text-ink-strong">Decided: {r.decision.decision === "link" ? "linked" : "excluded"}</span>
                <span className="text-ink-muted">
                  — “{r.decision.reason}” ({r.decision.byName}, {day(r.decision.at)})
                </span>
                {canDecide && <RetireButton label={`Retire the decision on ${r.documentNo}`} onRetire={(reason) => onRetire(r.decision!.id, reason)} />}
              </div>
            ) : (
              canDecide && <DecideForm row={r} onDone={onDone} />
            )}
          </li>
        ))}
      </ul>
      {queue.truncated && <p className="mt-2 text-[12px] text-ink-subtle">Showing the first {queue.rows.length}: search to narrow it down.</p>}
    </section>
  );
}
