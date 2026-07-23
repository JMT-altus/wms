"use client";

import { useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { DetailDrawer } from "./detail-drawer";
import { formatInrPaise } from "@/lib/format";
import type { PayoutRow } from "@/lib/queries/incentives";
import type { EmpLedgerLine } from "@/lib/queries/incentive-admin";

export function PayoutTable({ rows, ledgerByEmployee }: { rows: PayoutRow[]; ledgerByEmployee: Record<string, EmpLedgerLine[]> }) {
  const [open, setOpen] = useState<PayoutRow | null>(null);
  const [query, setQuery] = useState("");
  const lines = open ? ledgerByEmployee[open.employeeId] ?? [] : [];
  const q = query.trim().toLowerCase();
  const shown = q === "" ? rows : rows.filter((r) => r.employeeName.toLowerCase().includes(q));

  if (rows.length === 0) return <p className="text-ink-muted text-[13.5px]">No payouts computed yet. Record sales / approve submissions — the ledger updates automatically.</p>;

  return (
    <>
      {rows.length > 6 && (
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search employee…" className="rounded-xl px-3.5 py-2 text-[13.5px] mb-3" style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.14)", minWidth: 220 }} />
      )}
      <div className="rounded-[14px] overflow-hidden" style={{ border: "1px solid rgba(15,23,42,0.07)" }}>
        {shown.map((r, i) => (
          <button
            key={r.employeeId}
            type="button"
            onClick={() => setOpen(r)}
            className="group w-full text-left flex items-center justify-between px-4 py-2.5 transition-colors hover:bg-[rgba(10,108,255,0.04)]"
            style={{ background: i % 2 ? "rgba(15,23,42,0.015)" : "#fff", borderTop: i ? "1px solid rgba(15,23,42,0.05)" : undefined }}
          >
            <span className="text-[13.5px] font-semibold text-ink-strong group-hover:underline">{r.employeeName}</span>
            <span className="flex items-center gap-2">
              <span className="text-[14px] font-bold text-ink-strong" style={{ fontVariantNumeric: "tabular-nums" }}>{formatInrPaise(r.totalPaise)}</span>
              <span className="text-ink-subtle text-[15px] transition-transform group-hover:translate-x-0.5">›</span>
            </span>
          </button>
        ))}
      </div>

      <DetailDrawer open={!!open} onClose={() => setOpen(null)} eyebrow="EMPLOYEE PAYOUT" title={open?.employeeName ?? ""}>
        {open && (
          <>
            <div className="rounded-[16px] p-5 mb-5" style={{ background: "linear-gradient(135deg,#f4f8ff,#ffffff)", border: "1px solid rgba(15,23,42,0.07)" }}>
              <div className="text-ink-subtle text-[11.5px] font-bold uppercase tracking-[0.14em]">Total payable</div>
              <div className="mt-1 font-bold text-ink-strong" style={{ fontFamily: "var(--font-display), sans-serif", fontSize: 34, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{formatInrPaise(open.totalPaise)}</div>
              <Link href={`/incentive/admin/rep/${open.employeeId}` as Route} className="inline-block mt-2 text-[13px] font-semibold text-[#0a47b3]">View full profile →</Link>
            </div>
            {lines.length === 0 ? (
              <p className="text-ink-muted text-[14px]">No ledger lines.</p>
            ) : (
              <div className="grid gap-3">
                {lines.map((l, i) => (
                  <div key={i} className="rounded-[14px] p-4" style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)" }}>
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-extrabold" style={{ background: "rgba(10,108,255,0.08)", color: "#0a47b3" }}>{l.lineCode}</span>
                      <span className="font-bold text-ink-strong text-[15px]" style={{ fontVariantNumeric: "tabular-nums" }}>{formatInrPaise(l.amountPaise)}</span>
                    </div>
                    <p className="text-[13px] text-ink-muted leading-[1.55]">{l.explanation}</p>
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
