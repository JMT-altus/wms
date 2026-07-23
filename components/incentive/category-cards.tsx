"use client";

import { useState } from "react";
import { DetailDrawer } from "./detail-drawer";
import { formatInrPaise } from "@/lib/format";
import type { CategoryMeta, IncentiveLine } from "@/lib/queries/incentives";

export function CategoryCards({ categories, lines }: { categories: CategoryMeta[]; lines: IncentiveLine[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const active = categories.find((c) => c.code === open) ?? null;
  const activeLines = lines.filter((l) => l.category === open);

  return (
    <>
      <div className="grid grid-cols-3 max-md:grid-cols-1 sm:grid-cols-2 gap-4">
        {categories.map((c) => {
          const pct = c.capPaise > 0 ? Math.min(100, (c.earnedPaise / c.capPaise) * 100) : 0;
          const atCap = c.earnedPaise >= c.capPaise && c.capPaise > 0;
          const count = lines.filter((l) => l.category === c.code).length;
          return (
            <button
              key={c.code}
              type="button"
              onClick={() => setOpen(c.code)}
              className="group text-left rounded-[18px] p-5 transition-all duration-300 ease-out hover:-translate-y-1"
              style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)", boxShadow: "0 12px 26px -18px rgba(15,23,42,0.16), inset 0 1px 0 rgba(255,255,255,0.9)" }}
            >
              <div className="flex items-center justify-between">
                <span className="text-[13px] font-bold text-ink-strong"><span className="text-ink-subtle mr-1.5">{c.code}</span>{c.label}</span>
                {atCap
                  ? <span className="text-[10px] font-extrabold tracking-[0.12em] rounded-full px-2 py-0.5" style={{ background: "rgba(34,181,99,0.14)", color: "#15803d" }}>AT CAP</span>
                  : <span className="text-ink-subtle text-[16px] transition-transform group-hover:translate-x-0.5">›</span>}
              </div>
              <div className="mt-3 flex items-baseline gap-1.5">
                <span className="font-bold text-ink-strong text-[22px]" style={{ fontVariantNumeric: "tabular-nums" }}>{formatInrPaise(c.earnedPaise)}</span>
                <span className="text-ink-subtle text-[12.5px] font-semibold">/ {formatInrPaise(c.capPaise)}</span>
              </div>
              <div className="mt-2.5 h-2 rounded-full overflow-hidden" style={{ background: "rgba(15,23,42,0.06)" }}>
                <div className="h-full rounded-full transition-all duration-500" style={{ width: `${pct}%`, background: atCap ? "#22b563" : "linear-gradient(90deg, #0a6cff, #12b6a0)" }} />
              </div>
              <div className="mt-2 text-[11.5px] font-semibold text-ink-subtle">{count > 0 ? `${count} line${count === 1 ? "" : "s"} · tap to view` : "No earnings yet"}</div>
            </button>
          );
        })}
      </div>

      <DetailDrawer open={!!active} onClose={() => setOpen(null)} eyebrow={active ? `CATEGORY ${active.code}` : undefined} title={active?.label ?? ""}>
        {active && (
          <>
            <div className="rounded-[16px] p-5 mb-5" style={{ background: "linear-gradient(135deg,#f4f8ff,#ffffff)", border: "1px solid rgba(15,23,42,0.07)" }}>
              <div className="text-ink-subtle text-[11.5px] font-bold uppercase tracking-[0.14em]">Earned · cap</div>
              <div className="mt-1 flex items-baseline gap-2">
                <span className="font-bold text-ink-strong" style={{ fontFamily: "var(--font-display), sans-serif", fontSize: 34, letterSpacing: "-0.02em", fontVariantNumeric: "tabular-nums" }}>{formatInrPaise(active.earnedPaise)}</span>
                <span className="text-ink-subtle text-[14px] font-semibold">/ {formatInrPaise(active.capPaise)}</span>
              </div>
            </div>
            {activeLines.length === 0 ? (
              <p className="text-ink-muted text-[14px]">No earnings in this category yet this month.</p>
            ) : (
              <div className="grid gap-3">
                {activeLines.map((l, i) => (
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
