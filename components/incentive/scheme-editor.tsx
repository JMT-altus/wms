"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { publishScheme } from "@/app/(app)/incentive/actions";

export interface SchemeValues {
  caps: { A: number; B: number; C: number; D: number; E: number; F: number };
  schemeCap: number;
  rates: { a1: number; a2: number; a3: number };
}

const CAP_LABELS: Record<keyof SchemeValues["caps"], string> = { A: "Sales slabs", B: "Cross-sell", C: "New customer", D: "Leads", E: "Meetings", F: "Reviews" };
const field = "rounded-lg px-3 py-2 text-[14px] w-full";
const fieldStyle = { background: "#fff", border: "1px solid rgba(15,23,42,0.14)" } as const;

export function SchemeEditor({ initial }: { initial: SchemeValues }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [caps, setCaps] = useState(initial.caps);
  const [schemeCap, setSchemeCap] = useState(String(initial.schemeCap));
  const [rates, setRates] = useState(initial.rates);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    start(async () => {
      const res = await publishScheme({
        categoryCaps: caps,
        schemeMonthlyCap: Number(schemeCap),
        slabRates: { a1: Number(rates.a1), a2: Number(rates.a2), a3: Number(rates.a3) },
      });
      if (res.ok) { setMsg({ ok: true, text: "New scheme version published. Recompute a month to apply it." }); router.refresh(); }
      else setMsg({ ok: false, text: res.error ?? "Failed." });
    });
  }

  return (
    <form onSubmit={submit} className="rounded-[18px] p-6" style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)" }}>
      <h3 className="text-[15px] font-bold text-ink-strong mb-4">Category ceilings (₹)</h3>
      <div className="grid grid-cols-3 max-md:grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        {(Object.keys(caps) as (keyof SchemeValues["caps"])[]).map((k) => (
          <label key={k}><span className="text-[12px] font-bold text-ink-subtle"><span className="text-ink-subtle mr-1">{k}</span>{CAP_LABELS[k]}</span>
            <input value={caps[k]} onChange={(e) => setCaps({ ...caps, [k]: Number(e.target.value) })} type="number" min={0} className={field} style={fieldStyle} />
          </label>
        ))}
      </div>

      <h3 className="text-[15px] font-bold text-ink-strong mb-4">Sales slab rates (%)</h3>
      <div className="grid grid-cols-3 max-md:grid-cols-1 gap-3 mb-6">
        <label><span className="text-[12px] font-bold text-ink-subtle">₹1.0–1.2 Cr</span><input value={rates.a1} onChange={(e) => setRates({ ...rates, a1: Number(e.target.value) })} type="number" step="0.01" min={0} className={field} style={fieldStyle} /></label>
        <label><span className="text-[12px] font-bold text-ink-subtle">₹1.2–1.4 Cr</span><input value={rates.a2} onChange={(e) => setRates({ ...rates, a2: Number(e.target.value) })} type="number" step="0.01" min={0} className={field} style={fieldStyle} /></label>
        <label><span className="text-[12px] font-bold text-ink-subtle">₹1.4–1.6 Cr</span><input value={rates.a3} onChange={(e) => setRates({ ...rates, a3: Number(e.target.value) })} type="number" step="0.01" min={0} className={field} style={fieldStyle} /></label>
      </div>

      <h3 className="text-[15px] font-bold text-ink-strong mb-3">Scheme monthly ceiling (₹)</h3>
      <div className="max-w-[240px] mb-6"><input value={schemeCap} onChange={(e) => setSchemeCap(e.target.value)} type="number" min={0} className={field} style={fieldStyle} /></div>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="rounded-xl px-5 py-2.5 text-white text-[14px] font-bold disabled:opacity-60" style={{ background: "linear-gradient(135deg, #6366F1, #4338CA)" }}>{pending ? "Publishing…" : "Publish new version"}</button>
        {msg && <span className="text-[13px] font-semibold" style={{ color: msg.ok ? "#15803d" : "#b91c1c" }}>{msg.text}</span>}
      </div>
    </form>
  );
}
