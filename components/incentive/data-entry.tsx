"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordSale, recordReceipt } from "@/app/(app)/incentive/actions";
import type { EmployeeOption } from "@/lib/queries/employees";

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
const lbl = "block";
const lblText = "text-[12px] font-bold text-ink-subtle";

export function DataEntry({ employees }: { employees: EmployeeOption[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const today = "";

  // Sale form state
  const [customer, setCustomer] = useState("");
  const [owner, setOwner] = useState(employees[0]?.id ?? "");
  const [cat, setCat] = useState<(typeof CATS)[number]["code"]>("A");
  const [amount, setAmount] = useState("");
  const [invNo, setInvNo] = useState("");
  const [invDate, setInvDate] = useState(today);
  const [terms, setTerms] = useState("30");
  const [isNew, setIsNew] = useState(false);
  const [paid, setPaid] = useState("");
  const [paidDate, setPaidDate] = useState(today);

  // Receipt form state
  const [rInvNo, setRInvNo] = useState("");
  const [rAmount, setRAmount] = useState("");
  const [rDate, setRDate] = useState(today);

  function go(fn: () => Promise<{ ok: boolean; error?: string }>, success: string) {
    setMsg(null);
    start(async () => {
      const res = await fn();
      if (res.ok) { setMsg({ ok: true, text: success }); router.refresh(); }
      else setMsg({ ok: false, text: res.error ?? "Something went wrong." });
    });
  }

  return (
    <div className="grid grid-cols-3 max-lg:grid-cols-1 gap-4">
      {/* Record a sale */}
      <section className="col-span-2 max-lg:col-span-1 rounded-[18px] p-5" style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)" }}>
        <h3 className="text-[15px] font-bold text-ink-strong mb-3">Record a sale</h3>
        <form
          onSubmit={(e) => { e.preventDefault(); go(() => recordSale({ customerName: customer, ownerEmployeeId: owner, categoryCode: cat, amountRupees: Number(amount), invoiceNo: invNo, invoiceDate: invDate, termsDays: Number(terms), isNewCustomer: isNew, paidAmountRupees: Number(paid) || 0, paidDate }), "Sale recorded."); }}
          className="grid grid-cols-2 gap-3"
        >
          <label className={`${lbl} col-span-2`}><span className={lblText}>Customer</span><input value={customer} onChange={(e) => setCustomer(e.target.value)} className={field} style={fieldStyle} placeholder="Customer name" /></label>
          <label className={lbl}><span className={lblText}>Owner</span>
            <select value={owner} onChange={(e) => setOwner(e.target.value)} className={field} style={fieldStyle}>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </label>
          <label className={lbl}><span className={lblText}>Category</span>
            <select value={cat} onChange={(e) => setCat(e.target.value as typeof cat)} className={field} style={fieldStyle}>
              {CATS.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
            </select>
          </label>
          <label className={lbl}><span className={lblText}>Amount (₹)</span><input value={amount} onChange={(e) => setAmount(e.target.value)} type="number" min={0} className={field} style={fieldStyle} placeholder="e.g. 1500000" /></label>
          <label className={lbl}><span className={lblText}>Invoice #</span><input value={invNo} onChange={(e) => setInvNo(e.target.value)} className={field} style={fieldStyle} placeholder="INV-1234" /></label>
          <label className={lbl}><span className={lblText}>Invoice date</span><input value={invDate} onChange={(e) => setInvDate(e.target.value)} type="date" className={field} style={fieldStyle} /></label>
          <label className={lbl}><span className={lblText}>Terms (days)</span><input value={terms} onChange={(e) => setTerms(e.target.value)} type="number" min={0} className={field} style={fieldStyle} /></label>
          <label className={lbl}><span className={lblText}>Paid now (₹)</span><input value={paid} onChange={(e) => setPaid(e.target.value)} type="number" min={0} className={field} style={fieldStyle} placeholder="0" /></label>
          <label className={lbl}><span className={lblText}>Paid date</span><input value={paidDate} onChange={(e) => setPaidDate(e.target.value)} type="date" className={field} style={fieldStyle} /></label>
          <label className="col-span-2 flex items-center gap-2 text-[13px] font-semibold text-ink-muted"><input type="checkbox" checked={isNew} onChange={(e) => setIsNew(e.target.checked)} /> New customer (credit acquisition to owner)</label>
          <div className="col-span-2"><button type="submit" disabled={pending} className="rounded-xl px-5 py-2.5 text-white text-[14px] font-bold disabled:opacity-60" style={{ background: "linear-gradient(135deg, #0A6CFF, #0047B3)" }}>{pending ? "Saving…" : "Record sale"}</button></div>
        </form>
      </section>

      {/* Record a collection */}
      <section className="rounded-[18px] p-5" style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)" }}>
        <h3 className="text-[15px] font-bold text-ink-strong mb-3">Record a collection</h3>
        <form
          onSubmit={(e) => { e.preventDefault(); go(() => recordReceipt({ invoiceNo: rInvNo, amountRupees: Number(rAmount), receivedAt: rDate }), "Collection recorded."); }}
          className="grid gap-3"
        >
          <label className={lbl}><span className={lblText}>Invoice #</span><input value={rInvNo} onChange={(e) => setRInvNo(e.target.value)} className={field} style={fieldStyle} placeholder="INV-1234" /></label>
          <label className={lbl}><span className={lblText}>Amount received (₹)</span><input value={rAmount} onChange={(e) => setRAmount(e.target.value)} type="number" min={0} className={field} style={fieldStyle} /></label>
          <label className={lbl}><span className={lblText}>Received on</span><input value={rDate} onChange={(e) => setRDate(e.target.value)} type="date" className={field} style={fieldStyle} /></label>
          <button type="submit" disabled={pending} className="rounded-xl px-5 py-2.5 text-white text-[14px] font-bold disabled:opacity-60" style={{ background: "linear-gradient(135deg, #12b6a0, #0b7268)" }}>{pending ? "Saving…" : "Record collection"}</button>
        </form>
      </section>

      {msg && <p className="col-span-3 max-lg:col-span-1 text-[13px] font-semibold" style={{ color: msg.ok ? "#15803d" : "#b91c1c" }}>{msg.text}</p>}
    </div>
  );
}
