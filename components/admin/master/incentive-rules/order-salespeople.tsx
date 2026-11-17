"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import { recordOrderSalesperson, retireIncentiveInput } from "@/app/(masters)/master-setup/incentive-rules/calculation/input-actions";
import { BLUE, BTN, CARD, FIELD, Notice, NotReady, RetireButton, day, pct, rs } from "./calc-ui";

/**
 * Order salespeople: which salesperson(s) a Forms Sales Order is credited to, for Category A when its configuration
 * says the sale is "a salesperson recorded on the order" or "assigned per order". Orders are Forms' own records; this
 * screen only links them to employees. A record is never edited: retire it (with a reason) and record a new one; the
 * retired rows stay listed. Eligibility and one-vs-shared credit are checked against the published configuration.
 */

export interface OrderSalespeopleProps {
  ready: boolean;
  canEdit: boolean;
  rows: {
    id: string;
    documentNo: string;
    documentDate: string;
    customerName: string;
    totalPaise: number;
    cancelled: boolean;
    status: "none" | "partial" | "complete";
    attributions: { id: string; employeeName: string; sharePpm: number; note: string | null; createdAt: string; createdByName: string | null }[];
    retired: { id: string; employeeName: string; sharePpm: number; retiredAt: string; retiredReason: string | null }[];
  }[];
  truncated: boolean;
  employees: { id: string; name: string }[];
  filters: { search: string; filter: "all" | "missing" | "attributed"; from: string; to: string };
  focus: string | null;
}

const STATUS: Record<OrderSalespeopleProps["rows"][number]["status"], { label: string; color: string; bg: string }> = {
  none: { label: "Needs a salesperson", color: "#B45309", bg: "#FFFBEB" },
  partial: { label: "Shares below 100%", color: "#B45309", bg: "#FFFBEB" },
  complete: { label: "Attributed", color: "#047857", bg: "#ECFDF5" },
};

export function OrderSalespeople(p: OrderSalespeopleProps) {
  const router = useRouter();
  const [msg, setMsg] = React.useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [adding, setAdding] = React.useState<string | null>(p.focus);
  const [form, setForm] = React.useState({ employeeId: "", share: "100", note: "" });
  const [busy, setBusy] = React.useState(false);
  const [f, setF] = React.useState(p.filters);
  const apply = (next = f) => router.push(`/master-setup/incentive-rules/calculation/salespeople?${new URLSearchParams(Object.entries(next).filter(([, v]) => v) as [string, string][])}` as Route);

  if (!p.ready) return <NotReady />;
  async function save(documentId: string) {
    const share = Number(form.share);
    if (!form.employeeId || !Number.isFinite(share)) return setMsg({ tone: "bad", text: "Choose a salesperson and a share." });
    setBusy(true);
    const r = await recordOrderSalesperson({ documentId, employeeId: form.employeeId, sharePpm: Math.round(share * 10_000), note: form.note.trim() || null });
    setBusy(false);
    if (!r.ok) return setMsg({ tone: "bad", text: r.error });
    setMsg({ tone: "ok", text: "Salesperson recorded." });
    setAdding(null);
    setForm({ employeeId: "", share: "100", note: "" });
    router.refresh();
  }
  async function retire(id: string, reason: string) {
    const r = await retireIncentiveInput({ entity: "attribution", id, reason });
    setMsg(r.ok ? { tone: "ok", text: "Record retired; it stays in the history." } : { tone: "bad", text: r.error });
    if (r.ok) router.refresh();
  }

  return (
    <div className="grid gap-3">
      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <input className={`${FIELD} w-64`} placeholder="Order number or customer" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} aria-label="Search orders" />
        <select className={FIELD} value={f.filter} onChange={(e) => setF({ ...f, filter: e.target.value as typeof f.filter })} aria-label="Show">
          <option value="all">All orders</option>
          <option value="missing">Needing a salesperson</option>
          <option value="attributed">With a salesperson</option>
        </select>
        <label className="text-[12px] text-ink-muted">
          From <input type="date" className={FIELD} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="From date" />
        </label>
        <label className="text-[12px] text-ink-muted">
          To <input type="date" className={FIELD} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="To date" />
        </label>
        <button type="submit" className={BTN} style={{ background: BLUE }}>
          Search
        </button>
      </form>
      {msg && <Notice tone={msg.tone}>{msg.text}</Notice>}
      <div className="overflow-x-auto rounded-section bg-white" style={CARD}>
        <table className="w-full text-[12.5px]" style={{ minWidth: 860 }} aria-label="Sales Orders and their salespeople">
          <thead>
            <tr className="text-left text-ink-subtle">
              {["Order", "Date", "Customer", "Amount", "Status", "Salespeople"].map((h) => (
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
                  No Forms Sales Order matches.
                </td>
              </tr>
            )}
            {p.rows.map((o) => {
              const st = STATUS[o.status];
              const used = o.attributions.reduce((s, a) => s + a.sharePpm, 0);
              return (
                <tr key={o.id} className="border-t border-hairline align-top" aria-label={`Order ${o.documentNo}`}>
                  <td className="px-3 py-2 font-semibold">
                    <Link href={`/forms/documents/sales-orders/${o.id}` as Route} className="text-[#0B4FB8] underline-offset-2 hover:underline">
                      {o.documentNo}
                    </Link>
                    {o.cancelled && <span className="ml-1 text-[11px] font-bold text-[#B91C1C]">Cancelled</span>}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">{day(o.documentDate)}</td>
                  <td className="px-3 py-2">{o.customerName}</td>
                  <td className="px-3 py-2 tabular-nums">{rs(o.totalPaise)}</td>
                  <td className="px-3 py-2">
                    <span className="rounded px-1.5 py-0.5 text-[11.5px] font-bold" style={{ color: st.color, background: st.bg }}>
                      {st.label}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <ul className="grid gap-1">
                      {o.attributions.map((a) => (
                        <li key={a.id} className="flex flex-wrap items-center gap-2">
                          <span className="font-semibold text-ink-strong">{a.employeeName}</span>
                          <span className="tabular-nums">{pct(a.sharePpm)}</span>
                          <span className="text-[11.5px] text-ink-subtle">
                            by {a.createdByName ?? "—"} · {day(a.createdAt)}
                            {a.note ? ` · ${a.note}` : ""}
                          </span>
                          {p.canEdit && <RetireButton label={`${a.employeeName} on ${o.documentNo}`} onRetire={(why) => retire(a.id, why)} />}
                        </li>
                      ))}
                    </ul>
                    {!!o.retired.length && (
                      <details className="mt-1 text-[11.5px] text-ink-subtle">
                        <summary className="cursor-pointer">History ({o.retired.length} retired)</summary>
                        <ul>
                          {o.retired.map((r) => (
                            <li key={r.id}>
                              {r.employeeName} {pct(r.sharePpm)} — retired {day(r.retiredAt)}: {r.retiredReason}
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {p.canEdit && used < 1_000_000 && (adding === o.id ? (
                      <div className="mt-1 flex flex-wrap items-center gap-1">
                        <select className={FIELD} value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })} aria-label={`Salesperson for ${o.documentNo}`}>
                          <option value="">Choose a salesperson…</option>
                          {p.employees.map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.name}
                            </option>
                          ))}
                        </select>
                        <input className={`${FIELD} w-20`} type="number" min={0.0001} max={100} step="any" value={form.share} onChange={(e) => setForm({ ...form, share: e.target.value })} aria-label={`Share % for ${o.documentNo}`} />
                        <span className="text-[12px]">%</span>
                        <input className={`${FIELD} w-48`} placeholder="Note (optional)" value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} aria-label={`Note for ${o.documentNo}`} maxLength={1000} />
                        <button type="button" disabled={busy} className={BTN} style={{ background: BLUE }} onClick={() => save(o.id)}>
                          Record
                        </button>
                        <button type="button" className="text-[12px] text-ink-muted" onClick={() => setAdding(null)}>
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button type="button" className="mt-1 text-[12px] font-semibold text-[#0B4FB8]" onClick={() => (setAdding(o.id), setForm({ employeeId: "", share: String((1_000_000 - used) / 10_000), note: "" }))}>
                        + Add salesperson
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
