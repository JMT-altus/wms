"use client";

import { useState } from "react";
import { DetailDrawer } from "./detail-drawer";
import { formatInrPaise, formatInrCompactPaise } from "@/lib/format";
import type { SaleRow } from "@/lib/queries/incentive-views";

const SALE_STATUS: Record<SaleRow["status"], { label: string; bg: string; fg: string }> = {
  collected: { label: "COLLECTED", bg: "rgba(34,181,99,0.14)", fg: "#15803d" },
  partial: { label: "PARTIAL", bg: "rgba(245,158,11,0.16)", fg: "#b45309" },
  due: { label: "DUE", bg: "rgba(10,108,255,0.10)", fg: "#0a47b3" },
  overdue: { label: "OVERDUE", bg: "rgba(239,68,68,0.14)", fg: "#b91c1c" },
};

const FILTERS: { id: string; label: string }[] = [
  { id: "all", label: "All" },
  { id: "outstanding", label: "Outstanding" },
  { id: "collected", label: "Collected" },
];

export function SalesTable({ sales }: { sales: SaleRow[] }) {
  const [filter, setFilter] = useState("all");
  const [open, setOpen] = useState<SaleRow | null>(null);
  const filtered = sales.filter((s) => (filter === "all" ? true : filter === "collected" ? s.status === "collected" : s.status !== "collected"));

  return (
    <>
      <div className="flex items-center justify-between gap-3 flex-wrap mb-3">
        <div className="inline-flex rounded-xl p-1" style={{ background: "rgba(15,23,42,0.05)" }}>
          {FILTERS.map((f) => (
            <button key={f.id} type="button" onClick={() => setFilter(f.id)} className="px-3.5 py-1.5 rounded-lg text-[13px] font-bold transition-colors" style={filter === f.id ? { background: "#fff", color: "#0a47b3", boxShadow: "0 1px 3px rgba(15,23,42,0.12)" } : { color: "#64748b" }}>{f.label}</button>
          ))}
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
            <button key={s.invoiceId} type="button" onClick={() => setOpen(s)} className="group w-full text-left grid grid-cols-[1fr_auto_auto_auto] max-md:grid-cols-1 gap-y-1 items-center px-5 py-3.5 transition-colors" style={{ background: i % 2 ? "rgba(15,23,42,0.015)" : "#fff", borderTop: "1px solid rgba(15,23,42,0.06)" }}>
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

      <DetailDrawer open={!!open} onClose={() => setOpen(null)} eyebrow={open ? `INVOICE · CATEGORY ${open.category}` : undefined} title={open?.customer ?? ""} accent={open?.status === "overdue" ? "#b91c1c" : "#0a6cff"}>
        {open && (
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
              <div className="rounded-[12px] px-4 py-3 text-[13px] font-semibold" style={{ background: "rgba(239,68,68,0.06)", color: "#b91c1c", border: "1px solid rgba(239,68,68,0.16)" }}>
                Nothing collected yet — the incentive on this invoice is at risk.
              </div>
            ) : (
              <div className="grid gap-2">
                {open.receipts.map((r, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-[12px] px-4 py-2.5" style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)" }}>
                    <span className="inline-block size-2 rounded-full" style={{ background: "#22b563" }} />
                    <span className="text-[13px] font-semibold text-ink-strong flex-1">{r.receivedAt}</span>
                    <span className="text-[13.5px] font-bold text-ink-strong" style={{ fontVariantNumeric: "tabular-nums" }}>{formatInrPaise(r.amountPaise)}</span>
                  </div>
                ))}
              </div>
            )}
          </>
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
