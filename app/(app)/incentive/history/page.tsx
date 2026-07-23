import { requireUser } from "@/lib/auth/current";
import { getMyHistory } from "@/lib/queries/incentive-views";
import { periodLabel } from "@/lib/queries/incentives";
import { formatInrPaise } from "@/lib/format";
import { EmptyState, PageHead } from "@/components/incentive/empty-state";

export const dynamic = "force-dynamic";

export default async function HistoryPage() {
  const me = await requireUser();
  const history = await getMyHistory(me.id);
  const max = Math.max(...history.map((h) => h.totalPaise), 1);

  return (
    <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
      <PageHead eyebrow="HISTORY" title="History" sub="Your incentive, month by month." />
      {history.length === 0 ? (
        <EmptyState title="No earnings history yet." sub="Once a month is computed, your monthly totals build up here." />
      ) : (
        <div className="rounded-[18px] overflow-hidden" style={{ border: "1px solid rgba(15,23,42,0.08)" }}>
          {history.map((h, i) => (
            <div key={h.period} className="flex items-center gap-4 px-5 py-4" style={{ background: i % 2 ? "rgba(15,23,42,0.015)" : "#fff", borderTop: i ? "1px solid rgba(15,23,42,0.06)" : undefined }}>
              <span className="shrink-0 font-bold text-ink-strong text-[13.5px]" style={{ minWidth: 92 }}>{periodLabel(h.period)}</span>
              <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: "rgba(15,23,42,0.06)" }}>
                <div className="h-full rounded-full" style={{ width: `${(h.totalPaise / max) * 100}%`, background: "linear-gradient(90deg, #0a6cff, #12b6a0)" }} />
              </div>
              <span className="shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-extrabold" style={{ background: "rgba(15,23,42,0.05)", color: "#64748b" }}>{h.status.toUpperCase()}</span>
              <span className="shrink-0 font-bold text-ink-strong text-[15px]" style={{ fontVariantNumeric: "tabular-nums", minWidth: 90, textAlign: "right" }}>{formatInrPaise(h.totalPaise)}</span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
