import { formatInrPaise, formatInrCompactPaise } from "@/lib/format";
import { periodLabel } from "@/lib/queries/incentives";
import type { AdminAnalytics } from "@/lib/queries/incentive-admin";

const CAT_LABEL: Record<string, string> = { A: "Sales slabs", B: "Cross-sell", C: "New customer", D: "Leads", E: "Meetings", F: "Reviews" };

export function AdminAnalyticsView({ a }: { a: AdminAnalytics }) {
  const monthMax = Math.max(...a.byMonth.map((m) => m.totalPaise), 1);
  const catMax = Math.max(...a.byCategory.map((c) => c.totalPaise), 1);

  return (
    <div className="grid grid-cols-2 max-md:grid-cols-1 gap-5">
      {/* KPI row */}
      <div className="col-span-2 grid grid-cols-3 max-md:grid-cols-1 gap-4">
        <Kpi label="Incentive this month" value={formatInrPaise(a.totalIncentivePaise)} />
        <Kpi label="Collected this month" value={formatInrCompactPaise(a.totalCollectedPaise)} />
        <Kpi label="Cost of incentive" value={`${a.costPct.toFixed(2)}%`} accent="#6366F1" hint="incentive ÷ collections" />
      </div>

      {/* Earnings trend */}
      <section className="rounded-[18px] p-5" style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)" }}>
        <h3 className="text-[14px] font-bold text-ink-strong mb-4">Payout trend</h3>
        <div className="flex items-end gap-3" style={{ height: 160 }}>
          {a.byMonth.map((m) => (
            <div key={m.period} className="flex-1 flex flex-col items-center justify-end gap-2">
              <span className="text-[11px] font-bold text-ink-strong" style={{ fontVariantNumeric: "tabular-nums" }}>{m.totalPaise > 0 ? formatInrCompactPaise(m.totalPaise) : ""}</span>
              <div className="w-full rounded-t-lg" style={{ height: `${Math.max(2, (m.totalPaise / monthMax) * 130)}px`, background: "linear-gradient(180deg, #0a6cff, #12b6a0)" }} />
              <span className="text-[10.5px] font-semibold text-ink-subtle">{periodLabel(m.period).split(" ")[0]}</span>
            </div>
          ))}
        </div>
      </section>

      {/* Category mix */}
      <section className="rounded-[18px] p-5" style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)" }}>
        <h3 className="text-[14px] font-bold text-ink-strong mb-4">Category mix</h3>
        <div className="grid gap-2.5">
          {a.byCategory.map((c) => (
            <div key={c.category} className="flex items-center gap-3">
              <span className="text-[12px] font-bold text-ink-strong shrink-0" style={{ width: 92 }}><span className="text-ink-subtle mr-1">{c.category}</span>{CAT_LABEL[c.category]}</span>
              <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ background: "rgba(15,23,42,0.06)" }}>
                <div className="h-full rounded-full" style={{ width: `${(c.totalPaise / catMax) * 100}%`, background: "linear-gradient(90deg,#0a6cff,#12b6a0)" }} />
              </div>
              <span className="text-[12.5px] font-bold text-ink-strong shrink-0" style={{ fontVariantNumeric: "tabular-nums", width: 70, textAlign: "right" }}>{formatInrPaise(c.totalPaise)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Kpi({ label, value, accent, hint }: { label: string; value: string; accent?: string; hint?: string }) {
  return (
    <div className="rounded-[18px] p-5" style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)", boxShadow: "0 12px 26px -18px rgba(15,23,42,0.14)" }}>
      <div className="text-ink-subtle text-[11.5px] font-bold uppercase tracking-[0.12em]">{label}</div>
      <div className="mt-1.5 font-bold" style={{ fontFamily: "var(--font-display), sans-serif", fontSize: 30, letterSpacing: "-0.02em", color: accent ?? "var(--color-ink-strong)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
      {hint && <div className="text-ink-subtle text-[11.5px] mt-0.5">{hint}</div>}
    </div>
  );
}
