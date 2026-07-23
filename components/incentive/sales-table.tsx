"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DetailDrawer } from "./detail-drawer";
import { formatInrPaise, formatInrCompactPaise } from "@/lib/format";
import { recordReceipt, editSale, deleteSale } from "@/app/(app)/incentive/actions";
import type { SaleRow } from "@/lib/queries/incentive-views";

const SALE_STATUS: Record<SaleRow["status"], { label: string; bg: string; fg: string }> = {
  collected: { label: "COLLECTED", bg: "rgba(34,181,99,0.14)", fg: "#15803d" },
  partial: { label: "PARTIAL", bg: "rgba(245,158,11,0.16)", fg: "#b45309" },
  due: { label: "DUE", bg: "rgba(10,108,255,0.10)", fg: "#0a47b3" },
  overdue: { label: "OVERDUE", bg: "rgba(239,68,68,0.14)", fg: "#b91c1c" },
};
const FILTERS = [{ id: "all", label: "All" }, { id: "outstanding", label: "Outstanding" }, { id: "collected", label: "Collected" }];
const CATS = ["A", "B", "C", "N", "I", "R", "V"] as const;

const field = "rounded-lg px-3 py-2 text-[14px] w-full";
const fieldStyle = { background: "#fff", border: "1px solid rgba(15,23,42,0.14)" } as const;

export function SalesTable({ sales }: { sales: SaleRow[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState<SaleRow | null>(null);
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = sales
    .filter((s) => (filter === "all" ? true : filter === "collected" ? s.status === "collected" : s.status !== "collected"))
    .filter((s) => (q === "" ? true : s.customer.toLowerCase().includes(q) || (s.invoiceNo ?? "").toLowerCase().includes(q) || s.category.toLowerCase() === q));

  function refresh() { router.refresh(); }
  function close() { setOpen(null); setEditing(false); setMsg(null); }

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="flex items-center gap-2.5 flex-wrap">
          <div className="inline-flex rounded-xl p-1" style={{ background: "rgba(15,23,42,0.05)" }}>
            {FILTERS.map((f) => (
              <button key={f.id} type="button" onClick={() => setFilter(f.id)} className="px-3.5 py-1.5 rounded-lg text-[13px] font-bold transition-colors" style={filter === f.id ? { background: "#fff", color: "#0a47b3", boxShadow: "0 1px 3px rgba(15,23,42,0.12)" } : { color: "#64748b" }}>{f.label}</button>
            ))}
          </div>
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search customer, invoice, category…" className="rounded-xl px-3.5 py-2 text-[13.5px]" style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.14)", minWidth: 220 }} />
        </div>
        <span className="text-ink-subtle text-[12.5px] font-semibold">{filtered.length} of {sales.length}</span>
      </div>

      <div className="rounded-[18px] overflow-hidden" style={{ border: "1px solid rgba(15,23,42,0.08)" }}>
        <div className="grid grid-cols-[1fr_auto_auto_auto] max-md:hidden px-5 py-2.5 text-[11px] font-extrabold uppercase tracking-[0.1em] text-ink-subtle" style={{ background: "rgba(15,23,42,0.02)" }}>
          <span>Customer · Invoice</span><span className="text-right pr-6">Value</span><span className="text-right pr-6">Collection</span><span className="text-right">Decay</span>
        </div>
        {filtered.map((s, i) => {
          const st = SALE_STATUS[s.status];
          return (
            <button key={s.invoiceId} type="button" onClick={() => { setOpen(s); setEditing(false); setMsg(null); }} className="group w-full text-left grid grid-cols-[1fr_auto_auto_auto] max-md:grid-cols-1 gap-y-1 items-center px-5 py-3.5 transition-colors" style={{ background: i % 2 ? "rgba(15,23,42,0.015)" : "#fff", borderTop: "1px solid rgba(15,23,42,0.06)" }}>
              <div className="min-w-0">
                <span className="inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-[10.5px] font-extrabold mr-2" style={{ background: "rgba(10,108,255,0.08)", color: "#0a47b3" }}>{s.category}</span>
                <span className="font-bold text-ink-strong text-[13.5px] group-hover:underline">{s.customer}</span>
                {s.invoiceNo && <span className="text-ink-subtle text-[12.5px] font-semibold"> · {s.invoiceNo}</span>}
                <span className="text-ink-subtle text-[12px]"> · {s.bookedAt}</span>
              </div>
              <span className="text-right pr-6 font-bold text-ink-strong text-[13.5px]" style={{ fontVariantNumeric: "tabular-nums" }}>{formatInrCompactPaise(s.valuePaise)}</span>
              <span className="text-right pr-6"><span className="inline-flex items-center rounded-full px-2.5 py-1 text-[10.5px] font-extrabold" style={{ background: st.bg, color: st.fg }}>{st.label}</span></span>
              <span className="text-right text-[12.5px] font-bold" style={{ color: s.multiplier < 1 ? "#b45309" : "#64748b" }}>×{s.multiplier.toFixed(2)}{s.daysPastTerms > 0 ? ` · ${s.daysPastTerms}d` : ""}</span>
            </button>
          );
        })}
      </div>

      <DetailDrawer open={!!open} onClose={close} eyebrow={open ? `INVOICE · CATEGORY ${open.category}` : undefined} title={open?.customer ?? ""} accent={open?.status === "overdue" ? "#b91c1c" : "#0a6cff"}>
        {open && !editing && (
          <>
            <div className="grid grid-cols-2 gap-3 mb-5">
              <Stat label="Invoice value" value={formatInrPaise(open.valuePaise)} />
              <Stat label="Collected" value={formatInrPaise(open.collectedPaise)} />
              <Stat label="Outstanding" value={formatInrPaise(open.outstandingPaise)} accent={open.outstandingPaise > 0 ? "#b45309" : "#15803d"} />
              <Stat label="Decay multiplier" value={`×${open.multiplier.toFixed(2)}`} accent={open.multiplier < 1 ? "#b45309" : "#15803d"} />
            </div>
            <div className="rounded-[14px] p-4 mb-5 text-[13px] text-ink-muted leading-[1.6]" style={{ background: "rgba(15,23,42,0.02)", border: "1px solid rgba(15,23,42,0.06)" }}>
              {open.invoiceNo ? <b className="text-ink-strong">{open.invoiceNo}</b> : "Invoice"} · booked {open.bookedAt} · {open.termsDays}-day terms · due <b className="text-ink-strong">{open.dueDate}</b>
              {open.daysPastTerms > 0 && <> · <span style={{ color: "#b45309", fontWeight: 700 }}>{open.daysPastTerms} days past terms</span></>}
            </div>

            <h3 className="text-[13px] font-bold text-ink-strong mb-2.5">Collection timeline</h3>
            {open.receipts.length === 0 ? (
              <div className="rounded-[12px] px-4 py-3 text-[13px] font-semibold mb-4" style={{ background: "rgba(239,68,68,0.06)", color: "#b91c1c", border: "1px solid rgba(239,68,68,0.16)" }}>Nothing collected yet — the incentive on this invoice is at risk.</div>
            ) : (
              <div className="grid gap-2 mb-4">
                {open.receipts.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-[12px] px-4 py-2.5" style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)" }}>
                    <span className="inline-block size-2 rounded-full" style={{ background: "#22b563" }} />
                    <span className="text-[13px] font-semibold text-ink-strong flex-1">{r.receivedAt}</span>
                    <span className="text-[13.5px] font-bold text-ink-strong" style={{ fontVariantNumeric: "tabular-nums" }}>{formatInrPaise(r.amountPaise)}</span>
                  </div>
                ))}
              </div>
            )}

            {open.outstandingPaise > 0 && <RecordPayment invoiceId={open.invoiceId} pending={pending} onSubmit={(amount, date) => start(async () => { const res = await recordReceipt({ invoiceId: open.invoiceId, amountRupees: amount, receivedAt: date }); if (res.ok) { setMsg("Payment recorded."); refresh(); close(); } else setMsg(res.error ?? "Failed."); })} />}

            <div className="mt-6 pt-5 flex items-center gap-2" style={{ borderTop: "1px solid rgba(15,23,42,0.08)" }}>
              <button type="button" onClick={() => setEditing(true)} className="rounded-lg px-4 py-2 text-[13px] font-bold" style={{ background: "rgba(15,23,42,0.05)", color: "#334155" }}>Edit</button>
              <button type="button" disabled={pending} onClick={() => { if (confirm("Delete this sale? This removes the order, invoice and receipts.")) start(async () => { const res = await deleteSale({ invoiceId: open.invoiceId }); if (res.ok) { refresh(); close(); } else setMsg(res.error ?? "Failed."); }); }} className="rounded-lg px-4 py-2 text-[13px] font-bold" style={{ background: "rgba(239,68,68,0.1)", color: "#b91c1c" }}>Delete</button>
              {msg && <span className="text-[12.5px] font-semibold text-ink-muted">{msg}</span>}
            </div>
          </>
        )}

        {open && editing && (
          <EditSale sale={open} pending={pending} onCancel={() => setEditing(false)} onSave={(patch) => start(async () => { const res = await editSale({ invoiceId: open.invoiceId, ...patch }); if (res.ok) { refresh(); close(); } else setMsg(res.error ?? "Failed."); })} msg={msg} />
        )}
      </DetailDrawer>
    </>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-[14px] p-4" style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)" }}>
      <div className="text-ink-subtle text-[11px] font-bold uppercase tracking-[0.1em]">{label}</div>
      <div className="mt-1 font-bold text-[18px]" style={{ color: accent ?? "var(--color-ink-strong)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}

function RecordPayment({ invoiceId, pending, onSubmit }: { invoiceId: string; pending: boolean; onSubmit: (amount: number, date: string) => void }) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  void invoiceId;
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSubmit(Number(amount), date); }} className="rounded-[14px] p-4" style={{ background: "linear-gradient(135deg,#effbf7,#ffffff)", border: "1px solid rgba(18,182,160,0.24)" }}>
      <h3 className="text-[13px] font-bold text-ink-strong mb-2.5">Record a payment</h3>
      <div className="flex items-end gap-2 flex-wrap">
        <label className="flex-1 min-w-[120px]"><span className="text-[11.5px] font-bold text-ink-subtle">Amount (₹)</span><input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min={0} className={field} style={fieldStyle} /></label>
        <label className="min-w-[130px]"><span className="text-[11.5px] font-bold text-ink-subtle">Received on</span><input value={date} onChange={(e) => setDate(e.target.value)} type="date" className={field} style={fieldStyle} /></label>
        <button type="submit" disabled={pending} className="rounded-xl px-4 py-2.5 text-white text-[13.5px] font-bold disabled:opacity-60" style={{ background: "linear-gradient(135deg,#12b6a0,#0b7268)" }}>{pending ? "…" : "Record"}</button>
      </div>
    </form>
  );
}

function EditSale({ sale, pending, onSave, onCancel, msg }: { sale: SaleRow; pending: boolean; onSave: (patch: { customerName?: string; categoryCode?: typeof CATS[number]; amountRupees?: number; invoiceDate?: string; termsDays?: number }) => void; onCancel: () => void; msg: string | null }) {
  const [customer, setCustomer] = useState(sale.customer);
  const [cat, setCat] = useState<typeof CATS[number]>(sale.category as typeof CATS[number]);
  const [amount, setAmount] = useState(String(Math.round(sale.valuePaise / 100)));
  const [invDate, setInvDate] = useState(sale.bookedAt);
  const [terms, setTerms] = useState(String(sale.termsDays));
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSave({ customerName: customer, categoryCode: cat, amountRupees: Number(amount), invoiceDate: invDate, termsDays: Number(terms) }); }} className="grid gap-3">
      <h3 className="text-display-xs text-ink-strong mb-1">Edit sale</h3>
      <label><span className="text-[12px] font-bold text-ink-subtle">Customer</span><input value={customer} onChange={(e) => setCustomer(e.target.value)} className={field} style={fieldStyle} /></label>
      <div className="grid grid-cols-2 gap-3">
        <label><span className="text-[12px] font-bold text-ink-subtle">Category</span><select value={cat} onChange={(e) => setCat(e.target.value as typeof CATS[number])} className={field} style={fieldStyle}>{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
        <label><span className="text-[12px] font-bold text-ink-subtle">Amount (₹)</span><input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min={0} className={field} style={fieldStyle} /></label>
        <label><span className="text-[12px] font-bold text-ink-subtle">Invoice date</span><input value={invDate} onChange={(e) => setInvDate(e.target.value)} type="date" className={field} style={fieldStyle} /></label>
        <label><span className="text-[12px] font-bold text-ink-subtle">Terms (days)</span><input value={terms} onChange={(e) => setTerms(e.target.value)} type="number" min={0} className={field} style={fieldStyle} /></label>
      </div>
      <div className="flex items-center gap-2 mt-1">
        <button type="submit" disabled={pending} className="rounded-xl px-5 py-2.5 text-white text-[14px] font-bold disabled:opacity-60" style={{ background: "linear-gradient(135deg, #0A6CFF, #0047B3)" }}>{pending ? "Saving…" : "Save changes"}</button>
        <button type="button" onClick={onCancel} className="rounded-xl px-4 py-2.5 text-[13.5px] font-bold" style={{ background: "rgba(15,23,42,0.05)", color: "#334155" }}>Cancel</button>
        {msg && <span className="text-[12.5px] font-semibold text-ink-muted">{msg}</span>}
      </div>
    </form>
  );
}
