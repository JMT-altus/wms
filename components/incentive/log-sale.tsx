"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordSale } from "@/app/(app)/incentive/actions";

const CATS: { code: "A" | "B" | "C" | "N" | "I" | "R" | "V"; label: string }[] = [
  { code: "A", label: "A · Major sale" },
  { code: "B", label: "B · Cross-sell (new product/brand)" },
  { code: "C", label: "C · New customer" },
  { code: "N", label: "N · New (lead)" },
  { code: "I", label: "I · Reference" },
  { code: "R", label: "R · Referral" },
  { code: "V", label: "V · High-value meeting" },
];

const field = "rounded-lg px-3 py-2 text-[14px] w-full";
const fieldStyle = { background: "#fff", border: "1px solid rgba(15,23,42,0.14)" } as const;
const lblText = "text-[12px] font-bold text-ink-subtle";

export function LogSale() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const [customer, setCustomer] = useState("");
  const [cat, setCat] = useState<(typeof CATS)[number]["code"]>("A");
  const [amount, setAmount] = useState("");
  const [invNo, setInvNo] = useState("");
  const [invDate, setInvDate] = useState("");
  const [terms, setTerms] = useState("30");
  const [isNew, setIsNew] = useState(false);
  const [paid, setPaid] = useState("");
  const [paidDate, setPaidDate] = useState("");

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    start(async () => {
      const res = await recordSale({ customerName: customer, categoryCode: cat, amountRupees: Number(amount), invoiceNo: invNo, invoiceDate: invDate, termsDays: Number(terms), isNewCustomer: isNew, paidAmountRupees: Number(paid) || 0, paidDate });
      if (res.ok) {
        setMsg({ ok: true, text: "Sale logged." });
        setCustomer(""); setAmount(""); setInvNo(""); setInvDate(""); setPaid(""); setPaidDate(""); setIsNew(false);
        router.refresh();
      } else setMsg({ ok: false, text: res.error ?? "Something went wrong." });
    });
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="rounded-xl px-5 py-2.5 text-white text-[14px] font-bold" style={{ background: "linear-gradient(135deg, #0A6CFF, #0047B3)", boxShadow: "0 10px 22px -10px rgba(10,108,255,0.5)" }}>
        + Log a sale
      </button>
    );
  }

  return (
    <section className="rounded-[18px] p-5 mb-5" style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)", boxShadow: "0 12px 26px -18px rgba(15,23,42,0.16)" }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-[15px] font-bold text-ink-strong">Log a sale</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-ink-subtle text-[13px] font-semibold">Close</button>
      </div>
      <form onSubmit={submit} className="grid grid-cols-3 max-md:grid-cols-1 gap-3">
        <label className="col-span-1 max-md:col-span-1"><span className={lblText}>Customer</span><input value={customer} onChange={(e) => setCustomer(e.target.value)} className={field} style={fieldStyle} placeholder="Customer name" /></label>
        <label><span className={lblText}>Category</span>
          <select value={cat} onChange={(e) => setCat(e.target.value as typeof cat)} className={field} style={fieldStyle}>{CATS.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}</select>
        </label>
        <label><span className={lblText}>Amount (₹)</span><input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min={0} className={field} style={fieldStyle} placeholder="e.g. 1500000" /></label>
        <label><span className={lblText}>Invoice #</span><input value={invNo} onChange={(e) => setInvNo(e.target.value)} className={field} style={fieldStyle} placeholder="INV-1234" /></label>
        <label><span className={lblText}>Invoice date</span><input value={invDate} onChange={(e) => setInvDate(e.target.value)} type="date" className={field} style={fieldStyle} /></label>
        <label><span className={lblText}>Terms (days)</span><input value={terms} onChange={(e) => setTerms(e.target.value)} type="number" min={0} className={field} style={fieldStyle} /></label>
        <label><span className={lblText}>Paid now (₹)</span><input value={paid} onChange={(e) => setPaid(e.target.value)} type="number" min={0} className={field} style={fieldStyle} placeholder="0" /></label>
        <label><span className={lblText}>Paid date</span><input value={paidDate} onChange={(e) => setPaidDate(e.target.value)} type="date" className={field} style={fieldStyle} /></label>
        <label className="flex items-center gap-2 text-[13px] font-semibold text-ink-muted pt-5"><input type="checkbox" checked={isNew} onChange={(e) => setIsNew(e.target.checked)} /> New customer</label>
        <div className="col-span-3 max-md:col-span-1 flex items-center gap-3">
          <button type="submit" disabled={pending} className="rounded-xl px-5 py-2.5 text-white text-[14px] font-bold disabled:opacity-60" style={{ background: "linear-gradient(135deg, #0A6CFF, #0047B3)" }}>{pending ? "Saving…" : "Log sale"}</button>
          {msg && <span className="text-[13px] font-semibold" style={{ color: msg.ok ? "#15803d" : "#b91c1c" }}>{msg.text}</span>}
        </div>
      </form>
    </section>
  );
}
