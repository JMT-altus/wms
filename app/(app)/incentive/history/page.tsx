import { requireUser } from "@/lib/auth/current";
import { getMyHistory } from "@/lib/queries/incentive-views";
import { periodLabel } from "@/lib/queries/incentives";
import { myCategoryA } from "@/lib/queries/incentive-calc";
import { formatInrPaise } from "@/lib/format";
import { EmptyState, PageHead } from "@/components/incentive/empty-state";

export const dynamic = "force-dynamic";

/**
 * Month by month, three figures that are never added together: Categories B–G (old engine), the new Category A
 * (authoritative — approved and paid months only) and historical Category A (the old engine's own lines, unchanged).
 */
export default async function HistoryPage() {
  const me = await requireUser();
  const [history, categoryA] = await Promise.all([getMyHistory(me.id), myCategoryA(me.id)]);
  const newA = new Map<string, { amount: number; status: string }>();
  for (const m of categoryA.months) {
    const k = m.month.slice(0, 7);
    const prev = newA.get(k);
    newA.set(k, { amount: (prev?.amount ?? 0) + m.amountPaise, status: prev && prev.status !== m.status ? "approved / paid" : m.status });
  }
  const old = new Map(history.map((h) => [h.period, h]));
  const months = [...new Set([...old.keys(), ...newA.keys()])].sort().reverse();
  const otherOf = (p: string) => (old.get(p) ? old.get(p)!.totalPaise - old.get(p)!.categoryAPaise : 0);
  const max = Math.max(...months.map(otherOf), 1);

  return (
    <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
      <PageHead eyebrow="HISTORY" title="History" sub="Your incentive, month by month. Category A is shown on its own and never added to the other categories." />
      {months.length === 0 ? (
        <EmptyState title="No earnings history yet." sub="Once a month is computed, your monthly totals build up here." />
      ) : (
        <div className="rounded-[18px] overflow-hidden" style={{ border: "1px solid rgba(15,23,42,0.08)" }}>
          {months.map((p, i) => {
            const h = old.get(p);
            const a = newA.get(p);
            const other = otherOf(p);
            return (
              <div key={p} className="px-5 py-4" style={{ background: i % 2 ? "rgba(15,23,42,0.015)" : "#fff", borderTop: i ? "1px solid rgba(15,23,42,0.06)" : undefined }} aria-label={`History ${p}`}>
                <div className="flex items-center gap-4">
                  <span className="shrink-0 font-bold text-ink-strong text-[13.5px]" style={{ minWidth: 92 }}>{periodLabel(p)}</span>
                  <div className="flex-1 h-2.5 rounded-full overflow-hidden" style={{ background: "rgba(15,23,42,0.06)" }}>
                    <div className="h-full rounded-full" style={{ width: `${(other / max) * 100}%`, background: "linear-gradient(90deg, #0a6cff, #12b6a0)" }} />
                  </div>
                  {h && <span className="shrink-0 inline-flex items-center rounded-full px-2.5 py-0.5 text-[10px] font-extrabold" style={{ background: "rgba(15,23,42,0.05)", color: "#64748b" }}>{h.status.toUpperCase()}</span>}
                  <span className="shrink-0 text-right" style={{ minWidth: 150 }}>
                    <span className="block text-[11px] font-semibold text-ink-subtle">Categories B–G</span>
                    <span className="font-bold text-ink-strong text-[15px]" style={{ fontVariantNumeric: "tabular-nums" }}>{formatInrPaise(other)}</span>
                  </span>
                </div>
                {(a || (h && h.categoryAPaise > 0)) && (
                  <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px]" style={{ paddingLeft: 108 }}>
                    {a && (
                      <span>
                        <span className="font-semibold text-[#0a47b3]">Category A (new, {a.status}):</span> <strong className="text-ink-strong" style={{ fontVariantNumeric: "tabular-nums" }}>{formatInrPaise(a.amount)}</strong>
                      </span>
                    )}
                    {h && h.categoryAPaise > 0 && (
                      <span className="text-ink-muted">
                        Historical Category A (old engine): <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatInrPaise(h.categoryAPaise)}</span>
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </main>
  );
}
