"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { customerInvoices, recordReceiptEvent, retireIncentiveInput } from "@/app/(masters)/master-setup/incentive-rules/calculation/input-actions";
import { BLUE, BTN, CARD, FIELD, Notice, NotReady, RetireButton, day, rs } from "./calc-ui";

/**
 * Receipt events: what Tally's import can't say about a Forms Customer Receipt — an allocation to an invoice by hand
 * (a receipt split between invoices, or an on-account receipt applied), a refund, a bounced cheque, a reversal, a hold
 * for review — and which Forms Credit Notes are sales returns. How each one changes Category A is the configuration's
 * choice (Refunds and Adjustments, Partial Payment Rules). Events are never edited: retire one (with a reason) to undo
 * it — e.g. retiring a hold releases the receipt.
 */

type Kind = "allocation" | "refund" | "bounced" | "reversed" | "hold" | "salesReturn";
const KIND_LABEL: Record<Kind, string> = { allocation: "Allocation to an invoice", refund: "Refund", bounced: "Bounced cheque", reversed: "Reversed", hold: "Held for review", salesReturn: "Sales return" };
const RECEIPT_KINDS: Kind[] = ["allocation", "refund", "bounced", "reversed", "hold"];

export interface ReceiptEventsProps {
  ready: boolean;
  canEdit: boolean;
  rows: {
    id: string;
    documentType: "customer-receipts" | "credit-notes";
    documentNo: string;
    documentDate: string;
    customerName: string;
    customerId: string | null;
    totalPaise: number;
    refId: string | null;
    refNo: string | null;
    events: { id: string; kind: Kind; invoiceNo: string | null; amountPaise: number | null; eventDate: string; note: string | null; createdAt: string; createdByName: string | null; retiredAt: string | null; retiredReason: string | null }[];
  }[];
  truncated: boolean;
  filters: { search: string; filter: "all" | "onAccount" | "withEvents" | "held" | "creditNotes" };
}

export function ReceiptEvents(p: ReceiptEventsProps) {
  const router = useRouter();
  const [msg, setMsg] = React.useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [adding, setAdding] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({ kind: "allocation" as Kind, invoiceId: "", amount: "", date: "", note: "" });
  const [invoices, setInvoices] = React.useState<{ id: string; no: string; date: string; totalPaise: number }[]>([]);
  const [busy, setBusy] = React.useState(false);
  const [f, setF] = React.useState(p.filters);
  if (!p.ready) return <NotReady />;

  async function open(row: ReceiptEventsProps["rows"][number]) {
    setAdding(row.id);
    setForm({ kind: row.documentType === "credit-notes" ? "salesReturn" : "allocation", invoiceId: "", amount: "", date: row.documentDate, note: "" });
    setInvoices(row.customerId && row.documentType === "customer-receipts" ? await customerInvoices(row.customerId) : []);
  }
  async function save(documentId: string) {
    const needsAmount = form.kind === "allocation" || form.kind === "refund";
    const amountPaise = needsAmount ? Math.round(Number(form.amount) * 100) : null;
    if (needsAmount && !(amountPaise! > 0)) return setMsg({ tone: "bad", text: "Give an amount of more than ₹0." });
    setBusy(true);
    const r = await recordReceiptEvent({ documentId, kind: form.kind, invoiceId: form.kind === "allocation" ? form.invoiceId || null : null, amountPaise, eventDate: form.date, note: form.note.trim() || null });
    setBusy(false);
    if (!r.ok) return setMsg({ tone: "bad", text: r.error });
    setMsg({ tone: "ok", text: `${KIND_LABEL[form.kind]} recorded.` });
    setAdding(null);
    router.refresh();
  }
  async function retire(id: string, reason: string) {
    const r = await retireIncentiveInput({ entity: "receipt-event", id, reason });
    setMsg(r.ok ? { tone: "ok", text: "Event retired; it stays in the history." } : { tone: "bad", text: r.error });
    if (r.ok) router.refresh();
  }

  return (
    <div className="grid gap-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          router.push(`/master-setup/incentive-rules/calculation/receipts?${new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][])}` as Route);
        }}
      >
        <input className={`${FIELD} w-64`} placeholder="Receipt, invoice or customer" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} aria-label="Search receipts" />
        <select className={FIELD} value={f.filter} onChange={(e) => setF({ ...f, filter: e.target.value as typeof f.filter })} aria-label="Show">
          <option value="all">Receipts and credit notes</option>
          <option value="onAccount">On-account receipts (no invoice)</option>
          <option value="withEvents">With events</option>
          <option value="held">Held for review</option>
          <option value="creditNotes">Credit notes</option>
        </select>
        <button type="submit" className={BTN} style={{ background: BLUE }}>
          Search
        </button>
      </form>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="overflow-x-auto rounded-section bg-white" style={CARD}>
        <table className="w-full text-[12.5px]" style={{ minWidth: 900 }} aria-label="Receipts and their events">
          <thead>
            <tr className="text-left text-ink-subtle">
              {["Document", "Date", "Customer", "Amount", "Against", "Events"].map((h) => (
                <th key={h} className="px-3 py-2 font-semibold">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {!p.rows.length && (
              <tr>
                <td colSpan={6} className="px-3 py-4 text-ink-muted">
                  No Forms receipt or credit note matches.
                </td>
              </tr>
            )}
            {p.rows.map((r) => {
              const active = r.events.filter((e) => !e.retiredAt);
              const retired = r.events.filter((e) => e.retiredAt);
              return (
                <tr key={r.id} className="border-t border-hairline align-top" aria-label={`Document ${r.documentNo}`}>
                  <td className="px-3 py-2 font-semibold">
                    <Link href={`/forms/documents/${r.documentType}/${r.id}` as Route} className="text-[#0B4FB8] underline-offset-2 hover:underline">
                      {r.documentNo}
                    </Link>
                    <span className="block text-[11px] font-normal text-ink-subtle">{r.documentType === "credit-notes" ? "Credit Note" : "Customer Receipt"}</span>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{day(r.documentDate)}</td>
                  <td className="px-3 py-2">{r.customerName}</td>
                  <td className="px-3 py-2 tabular-nums">{rs(r.totalPaise)}</td>
                  <td className="px-3 py-2">{r.refNo ?? (r.documentType === "customer-receipts" ? <span className="font-semibold text-[#B45309]">On account</span> : "—")}</td>
                  <td className="px-3 py-2">
                    <ul className="grid gap-1">
                      {active.map((e) => (
                        <li key={e.id} className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-ink-strong">{KIND_LABEL[e.kind]}</span>
                          {e.invoiceNo && <span>to {e.invoiceNo}</span>}
                          {e.amountPaise !== null && <span className="tabular-nums">{rs(e.amountPaise)}</span>}
                          <span className="text-[11.5px] text-ink-subtle">
                            {day(e.eventDate)} · by {e.createdByName ?? "—"}
                            {e.note ? ` · ${e.note}` : ""}
                          </span>
                          {p.canEdit && <RetireButton label={`${KIND_LABEL[e.kind]} on ${r.documentNo}`} onRetire={(why) => retire(e.id, why)} />}
                        </li>
                      ))}
                    </ul>
                    {!!retired.length && (
                      <details className="mt-1 text-[11.5px] text-ink-subtle">
                        <summary className="cursor-pointer">History ({retired.length} retired)</summary>
                        <ul>
                          {retired.map((e) => (
                            <li key={e.id}>
                              {KIND_LABEL[e.kind]} {e.amountPaise !== null ? rs(e.amountPaise) : ""} {day(e.eventDate)} — retired {day(e.retiredAt)}: {e.retiredReason}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {p.canEdit &&
                      (adding === r.id ? (
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          <select className={FIELD} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Kind })} aria-label={`Event for ${r.documentNo}`}>
                            {(r.documentType === "credit-notes" ? (["salesReturn"] as Kind[]) : RECEIPT_KINDS).map((k) => (
                              <option key={k} value={k}>
                                {KIND_LABEL[k]}
                              </option>
                            ))}
                          </select>
                          {form.kind === "allocation" && (
                            <select className={FIELD} value={form.invoiceId} onChange={(e) => setForm({ ...form, invoiceId: e.target.value })} aria-label={`Invoice for ${r.documentNo}`}>
                              <option value="">Choose an invoice (oldest first)…</option>
                              {invoices.map((i) => (
                                <option key={i.id} value={i.id}>
                                  {i.no} · {day(i.date)} · {rs(i.totalPaise)}
                                </option>
                              ))}
                            </select>
                          )}
                          {(form.kind === "allocation" || form.kind === "refund") && <input className={`${FIELD} w-28`} type="number" min={0.01} step="0.01" placeholder="Amount ₹" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} aria-label={`Amount for ${r.documentNo}`} />}
                          <input type="date" className={FIELD} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} aria-label={`Date for ${r.documentNo}`} />
                          <input className={`${FIELD} w-44`} placeholder={form.kind === "hold" || form.kind === "reversed" || form.kind === "bounced" ? "Why (required)" : "Note (optional)"} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} aria-label={`Note for ${r.documentNo}`} maxLength={1000} />
                          <button type="button" disabled={busy || !form.date} className={BTN} style={{ background: BLUE }} onClick={() => save(r.id)}>
                            Record
                          </button>
                          <button type="button" className="text-[12px] text-ink-muted" onClick={() => setAdding(null)}>
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button type="button" className="mt-1 text-[12px] font-semibold text-[#0B4FB8]" onClick={() => open(r)}>
                          + Add event
                        </button>
                      ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {p.truncated && <p className="text-[12px] text-ink-subtle">Showing the first {p.rows.length}; narrow the search to see others.</p>}
    </div>
  );
}
