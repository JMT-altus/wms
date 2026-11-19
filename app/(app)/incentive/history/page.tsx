import { requireUser } from "@/lib/auth/current";
import { getMyHistory } from "@/lib/queries/incentive-views";
import { periodLabel } from "@/lib/queries/incentives";
import { myCategoryA, myCategoryB, type MyCategoryAMonth } from "@/lib/queries/incentive-calc";
import { authoritativeCategories } from "@/lib/incentives/load";
import { formatInrPaise } from "@/lib/format";
import { EmptyState, PageHead } from "@/components/incentive/empty-state";

export const dynamic = "force-dynamic";

/**
 * Month by month, figures that are never added together: the old engine's other categories, the new Category A and
 * Category B (authoritative — approved and paid months only) and the old engine's historical Category A and, from
 * Category B's cut-over month on, historical Category B (its own lines, unchanged).
 */
const byMonth = (list: MyCategoryAMonth[]) => {
  const out = new Map<string, { amount: number; status: string }>();
  for (const m of list) {
    const k = m.month.slice(0, 7);
    const prev = out.get(k);
    out.set(k, { amount: (prev?.amount ?? 0) + m.amountPaise, status: prev && prev.status !== m.status ? "approved / paid" : m.status });
  }
  return out;
};

export default async function HistoryPage() {
  const me = await requireUser();
  const X = ["C", "D", "E", "F", "G"] as const;
  const [history, categoryA, categoryB, ...extra] = await Promise.all([getMyHistory(me.id), myCategoryA(me.id), myCategoryB(me.id), ...X.map((c) => myCategoryA(me.id, undefined, c))]);
  const newA = byMonth(categoryA.months);
  const newBm = byMonth(categoryB.months);
  const newX = X.map((c, i) => ({ c, by: byMonth(extra[i]!.months) }));
  const old = new Map(history.map((h) => [h.period, h]));
  const months = [...new Set([...old.keys(), ...newA.keys(), ...newBm.keys(), ...newX.flatMap((x) => [...x.by.keys()])])].sort().reverse();
  // From each category's cut-over month, the old engine's lines for it are historical: kept apart, never added.
  const cut = new Map(await Promise.all(months.map(async (p) => [p, await authoritativeCategories(p)] as const)));
  const bAuthoritative = new Map(months.map((p) => [p, cut.get(p)!.has("B")] as const));
  const historicalOf = (p: string) => Object.entries(old.get(p)?.byCategory ?? {}).filter(([c]) => c !== "A" && c !== "B" && cut.get(p)!.has(c));
  const otherOf = (p: string) => (old.get(p) ? old.get(p)!.totalPaise - old.get(p)!.categoryAPaise - (bAuthoritative.get(p) ? old.get(p)!.categoryBPaise : 0) - historicalOf(p).reduce((s, [, v]) => s + v, 0) : 0);
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
            const b = newBm.get(p);
            const oldB = bAuthoritative.get(p) && h ? h.categoryBPaise : 0;
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
                    <span className="block text-[11px] font-semibold text-ink-subtle">{bAuthoritative.get(p) || historicalOf(p).length ? "Other categories (old engine)" : "Categories B–G"}</span>
                    <span className="font-bold text-ink-strong text-[15px]" style={{ fontVariantNumeric: "tabular-nums" }}>{formatInrPaise(other)}</span>
                  </span>
                </div>
                {(a || b || oldB > 0 || (h && h.categoryAPaise > 0) || newX.some((x) => x.by.get(p)) || historicalOf(p).length > 0) && (
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
                    {b && (
                      <span>
                        <span className="font-semibold text-[#0a47b3]">Category B (new, {b.status}):</span> <strong className="text-ink-strong" style={{ fontVariantNumeric: "tabular-nums" }}>{formatInrPaise(b.amount)}</strong>
                      </span>
                    )}
                    {newX.filter((x) => x.by.get(p)).map((x) => (
                      <span key={x.c}>
                        <span className="font-semibold text-[#0a47b3]">Category {x.c} (new, {x.by.get(p)!.status}):</span> <strong className="text-ink-strong" style={{ fontVariantNumeric: "tabular-nums" }}>{formatInrPaise(x.by.get(p)!.amount)}</strong>
                      </span>
                    ))}
                    {historicalOf(p).map(([c, v]) => (
                      <span key={c} className="text-ink-muted">
                        Historical Category {c} (old engine): <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatInrPaise(v)}</span>
                      </span>
                    ))}
                    {oldB > 0 && (
                      <span className="text-ink-muted">
                        Historical Category B (old engine): <span style={{ fontVariantNumeric: "tabular-nums" }}>{formatInrPaise(oldB)}</span>
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
