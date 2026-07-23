import Link from "next/link";
import type { Route } from "next";
import { requireUser } from "@/lib/auth/current";
import { getIncentiveSummary, currentPeriodIST, periodLabel } from "@/lib/queries/incentives";
import { getAtRiskInvoices, type AtRiskInvoice } from "@/lib/queries/incentive-risk";
import { getMySales, getMyActivity, getMyHistory, getMonthlySales, type ActivityRow, type HistoryRow } from "@/lib/queries/incentive-views";
import { formatInrPaise, formatInrCompactPaise } from "@/lib/format";
import { CR } from "@/lib/incentives";
import { SubmitPanel } from "@/components/incentive/submit-panel";
import { PeriodPicker } from "@/components/incentive/period-picker";
import { CategoryCards } from "@/components/incentive/category-cards";
import { SalesTable } from "@/components/incentive/sales-table";

export const dynamic = "force-dynamic";

type Tab = "overview" | "sales" | "activity" | "history";
const TABS: { id: Tab; label: string }[] = [
  { id: "overview", label: "Overview" },
  { id: "sales", label: "My Sales" },
  { id: "activity", label: "My Activity" },
  { id: "history", label: "History" },
];

const STATUS_CHIP: Record<string, { label: string; bg: string; fg: string }> = {
  open: { label: "PROVISIONAL", bg: "rgba(245,158,11,0.14)", fg: "#b45309" },
  computing: { label: "COMPUTING", bg: "rgba(245,158,11,0.14)", fg: "#b45309" },
  review: { label: "IN REVIEW", bg: "rgba(245,158,11,0.14)", fg: "#b45309" },
  locked: { label: "LOCKED", bg: "rgba(10,108,255,0.12)", fg: "#0a47b3" },
  paid: { label: "PAID", bg: "rgba(34,181,99,0.14)", fg: "#15803d" },
};

function recentPeriods(count = 6): { value: string; label: string }[] {
  const cur = currentPeriodIST();
  const [y, m] = cur.split("-").map(Number);
  return Array.from({ length: count }, (_, i) => {
    const p = new Date(Date.UTC(y!, m! - 1 - i, 1)).toISOString().slice(0, 7);
    return { value: p, label: periodLabel(p) };
  });
}

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function IncentivePage({ searchParams }: PageProps) {
  const me = await requireUser();
  const sp = await searchParams;
  const tab = (typeof sp.tab === "string" && TABS.some((t) => t.id === sp.tab) ? sp.tab : "overview") as Tab;
  const period = typeof sp.period === "string" ? sp.period : currentPeriodIST();

  return (
    <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap mb-5">
        <div>
          <div style={{ fontFamily: "var(--font-mono-display), ui-monospace, monospace", fontSize: 12, fontWeight: 800, letterSpacing: "0.24em", color: "#0A6CFF" }}>
            INCENTIVES · {periodLabel(period)}
          </div>
          <h1 className="text-display-md text-ink-strong mt-2">My Incentives</h1>
        </div>
        <PeriodPicker current={period} options={recentPeriods()} />
      </div>

      {/* Tab nav */}
      <div className="flex items-center gap-1 border-b mb-6" style={{ borderColor: "rgba(15,23,42,0.1)" }}>
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <Link
              key={t.id}
              href={`/incentive?tab=${t.id}&period=${period}` as Route}
              className="px-4 py-2.5 text-[14px] font-bold transition-colors"
              style={{ color: active ? "#0a47b3" : "#64748b", borderBottom: active ? "2.5px solid #0a6cff" : "2.5px solid transparent", marginBottom: -1 }}
            >
              {t.label}
            </Link>
          );
        })}
      </div>

      {tab === "overview" && <OverviewTab employeeId={me.id} period={period} />}
      {tab === "sales" && <SalesTab employeeId={me.id} />}
      {tab === "activity" && <ActivityTab employeeId={me.id} />}
      {tab === "history" && <HistoryTab employeeId={me.id} />}
    </main>
  );
}

// ── Overview ─────────────────────────────────────────────────────────────────
function goGet(salesPaise: number): { headline: string; sub: string } {
  if (salesPaise >= CR(1.6)) return { headline: "Sales slab maxed 🎉", sub: "You've hit the ₹9,000 ceiling on the monthly sales incentive." };
  let target: number, rate: number;
  if (salesPaise < CR(1.0)) { target = CR(1.0); rate = 0; }
  else if (salesPaise < CR(1.2)) { target = CR(1.2); rate = 0.001; }
  else if (salesPaise < CR(1.4)) { target = CR(1.4); rate = 0.0015; }
  else { target = CR(1.6); rate = 0.002; }
  const delta = target - salesPaise;
  if (rate === 0) return { headline: `${formatInrCompactPaise(delta)} to unlock your sales incentive`, sub: `Book ${formatInrCompactPaise(target)} in sales this month to start earning the slab.` };
  const gain = Math.round(delta * rate);
  return { headline: `Book ${formatInrCompactPaise(delta)} more → +${formatInrPaise(gain)}`, sub: `Reach ${formatInrCompactPaise(target)} this month for the ${(rate * 100).toFixed(2)}% band.` };
}

async function OverviewTab({ employeeId, period }: { employeeId: string; period: string }) {
  const [summary, atRisk, monthlySales] = await Promise.all([getIncentiveSummary(employeeId, period), getAtRiskInvoices(employeeId), getMonthlySales(employeeId, period)]);
  const chip = STATUS_CHIP[summary.status] ?? STATUS_CHIP.open!;
  const headroom = Math.max(0, summary.schemeCapPaise - summary.totalPaise);
  const pct = Math.min(100, (summary.totalPaise / summary.schemeCapPaise) * 100);
  const nudge = goGet(monthlySales);

  return (
    <>
      <section
        className="relative overflow-hidden rounded-[24px] p-8 max-md:p-6 mb-6"
        style={{
          background: "radial-gradient(90% 140% at 12% 0%, rgba(10,108,255,0.10), transparent 60%),linear-gradient(135deg, #ffffff 0%, #f4f8ff 100%)",
          border: "1px solid rgba(15,23,42,0.07)",
          boxShadow: "0 30px 60px -30px rgba(10,108,255,0.3), 0 2px 8px rgba(15,23,42,0.05), inset 0 1px 0 rgba(255,255,255,0.9)",
        }}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-ink-subtle text-[12.5px] font-bold uppercase tracking-[0.18em]">Earned this month</div>
            <div className="mt-1" style={{ fontFamily: "var(--font-display), sans-serif", fontWeight: 800, fontSize: 52, lineHeight: 1, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}>
              {formatInrPaise(summary.totalPaise)}
            </div>
          </div>
          <span className="inline-flex items-center rounded-full px-3.5 py-1.5" style={{ background: chip.bg, color: chip.fg, fontSize: 11.5, fontWeight: 800, letterSpacing: "0.14em" }}>{chip.label}</span>
        </div>
        <div className="mt-6">
          <div className="flex justify-between text-[12.5px] font-semibold text-ink-muted mb-1.5">
            <span>Scheme ceiling {formatInrPaise(summary.schemeCapPaise)}</span>
            <span>{formatInrPaise(headroom)} headroom</span>
          </div>
          <div className="h-2.5 rounded-full overflow-hidden" style={{ background: "rgba(15,23,42,0.07)" }}>
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "linear-gradient(90deg, #0a6cff, #12b6a0)" }} />
          </div>
        </div>
      </section>

      {/* Go-Get nudge */}
      <div
        className="rounded-[18px] p-5 mb-7 flex items-center gap-4 flex-wrap"
        style={{ background: "linear-gradient(120deg, #eef4ff 0%, #eafaf6 100%)", border: "1px solid rgba(10,108,255,0.14)" }}
      >
        <span className="grid place-items-center rounded-xl shrink-0" style={{ width: 44, height: 44, background: "linear-gradient(135deg,#0a6cff,#12b6a0)", color: "#fff", fontSize: 20, fontWeight: 800 }}>↗</span>
        <div className="flex-1 min-w-[200px]">
          <div className="font-bold text-ink-strong text-[16px]">{nudge.headline}</div>
          <div className="text-ink-muted text-[13px] mt-0.5">{nudge.sub}</div>
        </div>
        <span className="text-ink-subtle text-[12.5px] font-semibold">This month: {formatInrCompactPaise(monthlySales)} booked</span>
      </div>

      {atRisk.length > 0 && (
        <section className="mb-7">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-display-xs text-ink-strong">At risk</h2>
            <span className="text-[11px] font-extrabold tracking-[0.14em] rounded-full px-2 py-0.5" style={{ background: "rgba(239,68,68,0.12)", color: "#b91c1c" }}>COLLECT TO KEEP</span>
          </div>
          <div className="rounded-[18px] overflow-hidden" style={{ border: "1px solid rgba(239,68,68,0.18)" }}>
            {atRisk.map((r, i) => <AtRiskRow key={r.invoiceId} r={r} first={i === 0} />)}
          </div>
        </section>
      )}

      <h2 className="text-display-xs text-ink-strong mb-3">By category <span className="text-ink-subtle text-[13px] font-semibold">· tap a card to drill in</span></h2>
      <div className="mb-7">
        <CategoryCards categories={summary.categories} lines={summary.lines} />
      </div>

      <h2 className="text-display-xs text-ink-strong mb-3">Breakdown</h2>
      {summary.lines.length === 0 ? (
        <EmptyState title="Nothing computed yet this month." sub="Sales, collections and approved submissions will appear here as they land." />
      ) : (
        <div className="rounded-[18px] overflow-hidden" style={{ border: "1px solid rgba(15,23,42,0.08)" }}>
          {summary.lines.map((l, i) => (
            <div key={`${l.lineCode}-${i}`} className="flex items-start gap-4 px-5 py-4" style={{ background: i % 2 ? "rgba(15,23,42,0.015)" : "#fff", borderTop: i ? "1px solid rgba(15,23,42,0.06)" : undefined }}>
              <span className="shrink-0 inline-flex items-center justify-center rounded-lg px-2.5 py-1 text-[12px] font-extrabold" style={{ background: "rgba(10,108,255,0.08)", color: "#0a47b3", fontVariantNumeric: "tabular-nums", minWidth: 44 }}>{l.lineCode}</span>
              <p className="text-[13.5px] text-ink-muted leading-[1.5] flex-1">{l.explanation}</p>
              <span className="shrink-0 font-bold text-ink-strong text-[15px]" style={{ fontVariantNumeric: "tabular-nums" }}>{formatInrPaise(l.amountPaise)}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── My Sales ─────────────────────────────────────────────────────────────────
async function SalesTab({ employeeId }: { employeeId: string }) {
  const sales = await getMySales(employeeId);
  if (sales.length === 0) return <EmptyState title="No sales recorded to you yet." sub="Your admin records orders and invoices; they'll show here with live collection status. Tap a row for its receipts and decay clock." />;
  return <SalesTable sales={sales} />;
}

// ── My Activity ──────────────────────────────────────────────────────────────
async function ActivityTab({ employeeId }: { employeeId: string }) {
  const activity = await getMyActivity(employeeId);
  const A_STATUS: Record<ActivityRow["status"], { bg: string; fg: string }> = {
    pending: { bg: "rgba(245,158,11,0.16)", fg: "#b45309" },
    approved: { bg: "rgba(34,181,99,0.14)", fg: "#15803d" },
    rejected: { bg: "rgba(239,68,68,0.12)", fg: "#b91c1c" },
  };
  return (
    <>
      <SubmitPanel />
      <h2 className="text-display-xs text-ink-strong mb-3">Submitted</h2>
      {activity.length === 0 ? (
        <EmptyState title="No submissions yet." sub="Log leads, meetings and reviews above — they'll appear here with their review status." />
      ) : (
        <div className="rounded-[18px] overflow-hidden" style={{ border: "1px solid rgba(15,23,42,0.08)" }}>
          {activity.map((a, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3.5" style={{ background: i % 2 ? "rgba(15,23,42,0.015)" : "#fff", borderTop: i ? "1px solid rgba(15,23,42,0.06)" : undefined }}>
              <span className="shrink-0 inline-flex items-center rounded-md px-2 py-1 text-[10.5px] font-extrabold tracking-[0.08em]" style={{ background: "rgba(10,108,255,0.08)", color: "#0a47b3", minWidth: 78, justifyContent: "center" }}>{a.type.toUpperCase()}</span>
              <div className="flex-1 min-w-0"><span className="text-ink-strong text-[13.5px] font-semibold">{a.summary}</span> <span className="text-ink-subtle text-[12px]">· {a.period}</span></div>
              <span className="shrink-0 inline-flex items-center rounded-full px-2.5 py-1 text-[10.5px] font-extrabold" style={{ background: A_STATUS[a.status].bg, color: A_STATUS[a.status].fg }}>{a.status.toUpperCase()}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ── History ──────────────────────────────────────────────────────────────────
async function HistoryTab({ employeeId }: { employeeId: string }) {
  const history = await getMyHistory(employeeId);
  if (history.length === 0) return <EmptyState title="No earnings history yet." sub="Once a month is computed, your monthly totals build up here." />;
  const max = Math.max(...history.map((h) => h.totalPaise), 1);
  return (
    <div className="rounded-[18px] overflow-hidden" style={{ border: "1px solid rgba(15,23,42,0.08)" }}>
      {history.map((h: HistoryRow, i) => (
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
  );
}

// ── shared bits ──────────────────────────────────────────────────────────────
function EmptyState({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="rounded-[18px] p-8 text-center" style={{ background: "#fff", border: "1px dashed rgba(15,23,42,0.14)" }}>
      <p className="text-ink-strong font-semibold text-[17px]">{title}</p>
      <p className="text-ink-muted text-[14px] mt-1">{sub}</p>
    </div>
  );
}

function AtRiskRow({ r, first }: { r: AtRiskInvoice; first: boolean }) {
  const urgent = r.daysToNextStep != null && r.daysToNextStep <= 3;
  const chipBg = urgent ? "rgba(239,68,68,0.14)" : "rgba(245,158,11,0.16)";
  const chipFg = urgent ? "#b91c1c" : "#b45309";
  const countdown = r.daysToNextStep != null ? `${r.nextMultiplier === 0 ? "VOIDS" : "HALVES"} IN ${r.daysToNextStep}D` : "FULLY DECAYED";
  return (
    <div className="flex items-center gap-4 px-5 py-4 max-md:flex-wrap" style={{ background: "#fff", borderTop: first ? undefined : "1px solid rgba(239,68,68,0.10)" }}>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-ink-strong text-[14.5px] truncate">{r.customer ?? "Customer"} {r.invoiceNo ? <span className="text-ink-subtle font-semibold">· {r.invoiceNo}</span> : null}</div>
        <div className="text-ink-muted text-[12.5px] mt-0.5">
          {r.daysPastTerms} days past terms · {formatInrCompactPaise(r.outstandingPaise)} outstanding
          {r.currentMultiplier < 1 && <span className="ml-1.5 font-bold" style={{ color: "#b45309" }}>· incentive now ×{r.currentMultiplier.toFixed(2)}</span>}
        </div>
      </div>
      {r.atRiskPaise > 0 && (
        <div className="text-right shrink-0">
          <div className="font-extrabold text-ink-strong text-[15px]" style={{ fontVariantNumeric: "tabular-nums" }}>≈{formatInrPaise(r.atRiskPaise)}</div>
          <div className="text-ink-subtle text-[10.5px] font-bold uppercase tracking-[0.1em]">at risk</div>
        </div>
      )}
      <span className="shrink-0 inline-flex items-center rounded-full px-3 py-1.5 text-[11px] font-extrabold tracking-[0.1em]" style={{ background: chipBg, color: chipFg, fontVariantNumeric: "tabular-nums" }}>{countdown}</span>
    </div>
  );
}

