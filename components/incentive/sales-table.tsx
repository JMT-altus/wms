"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { formatInrCompactPaise } from "@/lib/format";
import type { SaleRow } from "@/lib/queries/incentive-views";

const SALE_STATUS: Record<SaleRow["status"], { label: string; bg: string; fg: string }> = {
  collected: { label: "COLLECTED", bg: "rgba(34,181,99,0.14)", fg: "#15803d" },
  partial: { label: "PARTIAL", bg: "rgba(245,158,11,0.16)", fg: "#b45309" },
  due: { label: "DUE", bg: "rgba(10,108,255,0.10)", fg: "#0a47b3" },
  overdue: { label: "OVERDUE", bg: "rgba(239,68,68,0.14)", fg: "#b91c1c" },
};
const FILTERS = [{ id: "all", label: "All" }, { id: "outstanding", label: "Outstanding" }, { id: "collected", label: "Collected" }];

export function SalesTable({ sales }: { sales: SaleRow[] }) {
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const filtered = sales
    .filter((s) => (filter === "all" ? true : filter === "collected" ? s.status === "collected" : s.status !== "collected"))
    .filter((s) => (q === "" ? true : s.customer.toLowerCase().includes(q) || (s.invoiceNo ?? "").toLowerCase().includes(q) || s.category.toLowerCase() === q));

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
            <Link key={s.invoiceId} href={`/incentive/deal/${s.invoiceId}` as Route} className="group grid grid-cols-[1fr_auto_auto_auto] max-md:grid-cols-1 gap-y-1 items-center px-5 py-3.5 transition-colors hover:bg-[rgba(10,108,255,0.03)]" style={{ background: i % 2 ? "rgba(15,23,42,0.015)" : "#fff", borderTop: "1px solid rgba(15,23,42,0.06)" }}>
              <div className="min-w-0">
                <span className="inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-[10.5px] font-extrabold mr-2" style={{ background: "rgba(10,108,255,0.08)", color: "#0a47b3" }}>{s.category}</span>
                <span className="font-bold text-ink-strong text-[13.5px] group-hover:underline">{s.customer}</span>
                {s.invoiceNo && <span className="text-ink-subtle text-[12.5px] font-semibold"> · {s.invoiceNo}</span>}
                <span className="text-ink-subtle text-[12px]"> · {s.bookedAt}</span>
                {!s.confirmed && <span className="ml-2 inline-flex items-center rounded-full px-2 py-0.5 text-[9.5px] font-extrabold tracking-[0.08em]" style={{ background: "rgba(245,158,11,0.16)", color: "#b45309" }}>PENDING</span>}
              </div>
              <span className="text-right pr-6 font-bold text-ink-strong text-[13.5px]" style={{ fontVariantNumeric: "tabular-nums" }}>{formatInrCompactPaise(s.valuePaise)}</span>
              <span className="text-right pr-6"><span className="inline-flex items-center rounded-full px-2.5 py-1 text-[10.5px] font-extrabold" style={{ background: st.bg, color: st.fg }}>{st.label}</span></span>
              <span className="text-right text-[12.5px] font-bold" style={{ color: s.multiplier < 1 ? "#b45309" : "#64748b" }}>×{s.multiplier.toFixed(2)}{s.daysPastTerms > 0 ? ` · ${s.daysPastTerms}d` : ""}</span>
            </Link>
          );
        })}
      </div>
    </>
  );
}
