"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { recordReceipt, editSale, deleteSale } from "@/app/(app)/incentive/actions";

const CATS = ["A", "B", "C", "N", "I", "R", "V"] as const;
const field = "rounded-lg px-3 py-2 text-[14px] w-full";
const fieldStyle = { background: "#fff", border: "1px solid rgba(15,23,42,0.14)" } as const;

export function DealActions({ deal }: { deal: { invoiceId: string; outstandingPaise: number; customer: string; category: string; valueRupees: number; invoiceDate: string; termsDays: number } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [editing, setEditing] = useState(false);

  // payment
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState("");
  // edit
  const [customer, setCustomer] = useState(deal.customer);
  const [cat, setCat] = useState<typeof CATS[number]>(deal.category as typeof CATS[number]);
  const [amt, setAmt] = useState(String(deal.valueRupees));
  const [invDate, setInvDate] = useState(deal.invoiceDate);
  const [terms, setTerms] = useState(String(deal.termsDays));

  return (
    <div className="grid gap-4">
      {deal.outstandingPaise > 0 && (
        <form onSubmit={(e) => { e.preventDefault(); setMsg(null); start(async () => { const r = await recordReceipt({ invoiceId: deal.invoiceId, amountRupees: Number(amount), receivedAt: date }); if (r.ok) { setMsg({ ok: true, text: "Payment recorded." }); setAmount(""); router.refresh(); } else setMsg({ ok: false, text: r.error ?? "Failed." }); }); }} className="rounded-[14px] p-4" style={{ background: "linear-gradient(135deg,#effbf7,#ffffff)", border: "1px solid rgba(18,182,160,0.24)" }}>
          <h3 className="text-[13px] font-bold text-ink-strong mb-2.5">Record a payment</h3>
          <div className="flex items-end gap-2 flex-wrap">
            <label className="flex-1 min-w-[120px]"><span className="text-[11.5px] font-bold text-ink-subtle">Amount (₹)</span><input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min={0} className={field} style={fieldStyle} /></label>
            <label className="min-w-[130px]"><span className="text-[11.5px] font-bold text-ink-subtle">Received on</span><input value={date} onChange={(e) => setDate(e.target.value)} type="date" className={field} style={fieldStyle} /></label>
            <button type="submit" disabled={pending} className="rounded-xl px-4 py-2.5 text-white text-[13.5px] font-bold disabled:opacity-60" style={{ background: "linear-gradient(135deg,#12b6a0,#0b7268)" }}>{pending ? "…" : "Record"}</button>
          </div>
        </form>
      )}

      {!editing ? (
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setEditing(true)} className="rounded-lg px-4 py-2 text-[13px] font-bold" style={{ background: "rgba(15,23,42,0.05)", color: "#334155" }}>Edit deal</button>
          <button type="button" disabled={pending} onClick={() => { if (confirm("Delete this deal? Removes the order, invoice and receipts.")) start(async () => { const r = await deleteSale({ invoiceId: deal.invoiceId }); if (r.ok) router.push("/incentive/sales" as Route); else setMsg({ ok: false, text: r.error ?? "Failed." }); }); }} className="rounded-lg px-4 py-2 text-[13px] font-bold" style={{ background: "rgba(239,68,68,0.1)", color: "#b91c1c" }}>Delete</button>
          {msg && <span className="text-[12.5px] font-semibold" style={{ color: msg.ok ? "#15803d" : "#b91c1c" }}>{msg.text}</span>}
        </div>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); setMsg(null); start(async () => { const r = await editSale({ invoiceId: deal.invoiceId, customerName: customer, categoryCode: cat, amountRupees: Number(amt), invoiceDate: invDate, termsDays: Number(terms) }); if (r.ok) { setEditing(false); router.refresh(); } else setMsg({ ok: false, text: r.error ?? "Failed." }); }); }} className="rounded-[14px] p-4 grid gap-3" style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.1)" }}>
          <h3 className="text-[14px] font-bold text-ink-strong">Edit deal</h3>
          <label><span className="text-[12px] font-bold text-ink-subtle">Customer</span><input value={customer} onChange={(e) => setCustomer(e.target.value)} className={field} style={fieldStyle} /></label>
          <div className="grid grid-cols-2 gap-3">
            <label><span className="text-[12px] font-bold text-ink-subtle">Category</span><select value={cat} onChange={(e) => setCat(e.target.value as typeof CATS[number])} className={field} style={fieldStyle}>{CATS.map((c) => <option key={c} value={c}>{c}</option>)}</select></label>
            <label><span className="text-[12px] font-bold text-ink-subtle">Amount (₹)</span><input value={amt} onChange={(e) => setAmt(e.target.value)} type="number" min={0} className={field} style={fieldStyle} /></label>
            <label><span className="text-[12px] font-bold text-ink-subtle">Invoice date</span><input value={invDate} onChange={(e) => setInvDate(e.target.value)} type="date" className={field} style={fieldStyle} /></label>
            <label><span className="text-[12px] font-bold text-ink-subtle">Terms (days)</span><input value={terms} onChange={(e) => setTerms(e.target.value)} type="number" min={0} className={field} style={fieldStyle} /></label>
          </div>
          <div className="flex items-center gap-2">
            <button type="submit" disabled={pending} className="rounded-xl px-5 py-2.5 text-white text-[14px] font-bold disabled:opacity-60" style={{ background: "linear-gradient(135deg, #0A6CFF, #0047B3)" }}>{pending ? "Saving…" : "Save changes"}</button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-xl px-4 py-2.5 text-[13.5px] font-bold" style={{ background: "rgba(15,23,42,0.05)", color: "#334155" }}>Cancel</button>
            {msg && <span className="text-[12.5px] font-semibold" style={{ color: msg.ok ? "#15803d" : "#b91c1c" }}>{msg.text}</span>}
          </div>
        </form>
      )}
    </div>
  );
}
