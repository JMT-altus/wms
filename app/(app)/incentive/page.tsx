import { requireUser } from "@/lib/auth/current";
import { getIncentiveSummary, currentPeriodIST, periodLabel, type CategoryMeta } from "@/lib/queries/incentives";
import { getAtRiskInvoices, type AtRiskInvoice } from "@/lib/queries/incentive-risk";
import { formatInrPaise, formatInrCompactPaise } from "@/lib/format";
import { SubmitPanel } from "@/components/incentive/submit-panel";

export const dynamic = "force-dynamic";

const STATUS_CHIP: Record<string, { label: string; bg: string; fg: string }> = {
  open:      { label: "PROVISIONAL", bg: "rgba(245,158,11,0.14)", fg: "#b45309" },
  computing: { label: "COMPUTING",   bg: "rgba(245,158,11,0.14)", fg: "#b45309" },
  review:    { label: "IN REVIEW",   bg: "rgba(245,158,11,0.14)", fg: "#b45309" },
  locked:    { label: "LOCKED",      bg: "rgba(10,108,255,0.12)", fg: "#0a47b3" },
  paid:      { label: "PAID",        bg: "rgba(34,181,99,0.14)",  fg: "#15803d" },
};

export default async function IncentivePage() {
  const me = await requireUser();
  const period = currentPeriodIST();
  const [summary, atRisk] = await Promise.all([
    getIncentiveSummary(me.id, period),
    getAtRiskInvoices(me.id),
  ]);
  const chip = STATUS_CHIP[summary.status] ?? STATUS_CHIP.open!;
  const headroom = Math.max(0, summary.schemeCapPaise - summary.totalPaise);
  const pct = Math.min(100, (summary.totalPaise / summary.schemeCapPaise) * 100);

  return (
    <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
      {/* Header */}
      <div className="mb-7">
        <div
          style={{
            fontFamily: "var(--font-mono-display), ui-monospace, monospace",
            fontSize: 12,
            fontWeight: 800,
            letterSpacing: "0.24em",
            color: "#0A6CFF",
          }}
        >
          INCENTIVES · {periodLabel(period)}
        </div>
        <h1 className="text-display-md text-ink-strong mt-2">My Incentives</h1>
        <p className="text-ink-muted mt-1 text-[15px]">
          What you&apos;ve earned this month, and how close you are to the ceiling.
        </p>
      </div>

      {/* Earnings hero */}
      <section
        className="relative overflow-hidden rounded-[24px] p-8 max-md:p-6 mb-6"
        style={{
          background:
            "radial-gradient(90% 140% at 12% 0%, rgba(10,108,255,0.10), transparent 60%)," +
            "linear-gradient(135deg, #ffffff 0%, #f4f8ff 100%)",
          border: "1px solid rgba(15,23,42,0.07)",
          boxShadow: "0 30px 60px -30px rgba(10,108,255,0.3), 0 2px 8px rgba(15,23,42,0.05), inset 0 1px 0 rgba(255,255,255,0.9)",
        }}
      >
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <div className="text-ink-subtle text-[12.5px] font-bold uppercase tracking-[0.18em]">Earned this month</div>
            <div
              className="mt-1"
              style={{ fontFamily: "var(--font-display), sans-serif", fontWeight: 800, fontSize: 52, lineHeight: 1, letterSpacing: "-0.03em", fontVariantNumeric: "tabular-nums" }}
            >
              {formatInrPaise(summary.totalPaise)}
            </div>
          </div>
          <span
            className="inline-flex items-center rounded-full px-3.5 py-1.5"
            style={{ background: chip.bg, color: chip.fg, fontSize: 11.5, fontWeight: 800, letterSpacing: "0.14em" }}
          >
            {chip.label}
          </span>
        </div>

        {/* Headroom bar to the scheme ceiling */}
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

      {/* At-risk panel — collection decay countdown */}
      {atRisk.length > 0 && (
        <section className="mb-7">
          <div className="flex items-center gap-2 mb-3">
            <h2 className="text-display-xs text-ink-strong">At risk</h2>
            <span className="text-[11px] font-extrabold tracking-[0.14em] rounded-full px-2 py-0.5" style={{ background: "rgba(239,68,68,0.12)", color: "#b91c1c" }}>
              COLLECT TO KEEP
            </span>
          </div>
          <div className="rounded-[18px] overflow-hidden" style={{ border: "1px solid rgba(239,68,68,0.18)" }}>
            {atRisk.map((r, i) => (
              <AtRiskRow key={r.invoiceId} r={r} first={i === 0} />
            ))}
          </div>
        </section>
      )}

      {/* Category rail */}
      <div className="grid grid-cols-3 max-md:grid-cols-1 sm:grid-cols-2 gap-4 mb-7">
        {summary.categories.map((c) => (
          <CategoryCard key={c.code} c={c} />
        ))}
      </div>

      {/* Log activity */}
      <SubmitPanel />

      {/* Ledger */}
      <h2 className="text-display-xs text-ink-strong mb-3">Breakdown</h2>
      {summary.lines.length === 0 ? (
        <div
          className="rounded-[18px] p-8 text-center"
          style={{ background: "#fff", border: "1px dashed rgba(15,23,42,0.14)" }}
        >
          <p className="text-ink-strong font-semibold text-[17px]">Nothing computed yet this month.</p>
          <p className="text-ink-muted text-[14px] mt-1">
            Sales, collections and approved submissions will appear here as they land.
          </p>
        </div>
      ) : (
        <div className="rounded-[18px] overflow-hidden" style={{ border: "1px solid rgba(15,23,42,0.08)" }}>
          {summary.lines.map((l, i) => (
            <div
              key={`${l.lineCode}-${i}`}
              className="flex items-start gap-4 px-5 py-4"
              style={{ background: i % 2 ? "rgba(15,23,42,0.015)" : "#fff", borderTop: i ? "1px solid rgba(15,23,42,0.06)" : undefined }}
            >
              <span
                className="shrink-0 inline-flex items-center justify-center rounded-lg px-2.5 py-1 text-[12px] font-extrabold"
                style={{ background: "rgba(10,108,255,0.08)", color: "#0a47b3", fontVariantNumeric: "tabular-nums", minWidth: 44 }}
              >
                {l.lineCode}
              </span>
              <p className="text-[13.5px] text-ink-muted leading-[1.5] flex-1">{l.explanation}</p>
              <span
                className="shrink-0 font-bold text-ink-strong text-[15px]"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {formatInrPaise(l.amountPaise)}
              </span>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function AtRiskRow({ r, first }: { r: AtRiskInvoice; first: boolean }) {
  const urgent = r.daysToNextStep != null && r.daysToNextStep <= 3;
  const chipBg = urgent ? "rgba(239,68,68,0.14)" : "rgba(245,158,11,0.16)";
  const chipFg = urgent ? "#b91c1c" : "#b45309";
  const countdown =
    r.daysToNextStep != null
      ? `${r.nextMultiplier === 0 ? "VOIDS" : "HALVES"} IN ${r.daysToNextStep}D`
      : "FULLY DECAYED";
  return (
    <div
      className="flex items-center gap-4 px-5 py-4 max-md:flex-wrap"
      style={{ background: "#fff", borderTop: first ? undefined : "1px solid rgba(239,68,68,0.10)" }}
    >
      <div className="flex-1 min-w-0">
        <div className="font-bold text-ink-strong text-[14.5px] truncate">
          {r.customer ?? "Customer"} {r.invoiceNo ? <span className="text-ink-subtle font-semibold">· {r.invoiceNo}</span> : null}
        </div>
        <div className="text-ink-muted text-[12.5px] mt-0.5">
          {r.daysPastTerms} days past terms · {formatInrCompactPaise(r.outstandingPaise)} outstanding
          {r.currentMultiplier < 1 && (
            <span className="ml-1.5 font-bold" style={{ color: "#b45309" }}>· incentive now ×{r.currentMultiplier.toFixed(2)}</span>
          )}
        </div>
      </div>
      {r.atRiskPaise > 0 && (
        <div className="text-right shrink-0">
          <div className="font-extrabold text-ink-strong text-[15px]" style={{ fontVariantNumeric: "tabular-nums" }}>
            ≈{formatInrPaise(r.atRiskPaise)}
          </div>
          <div className="text-ink-subtle text-[10.5px] font-bold uppercase tracking-[0.1em]">at risk</div>
        </div>
      )}
      <span
        className="shrink-0 inline-flex items-center rounded-full px-3 py-1.5 text-[11px] font-extrabold tracking-[0.1em]"
        style={{ background: chipBg, color: chipFg, fontVariantNumeric: "tabular-nums" }}
      >
        {countdown}
      </span>
    </div>
  );
}

function CategoryCard({ c }: { c: CategoryMeta }) {
  const pct = c.capPaise > 0 ? Math.min(100, (c.earnedPaise / c.capPaise) * 100) : 0;
  const atCap = c.earnedPaise >= c.capPaise && c.capPaise > 0;
  return (
    <div
      className="rounded-[18px] p-5"
      style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)", boxShadow: "0 12px 26px -18px rgba(15,23,42,0.16), inset 0 1px 0 rgba(255,255,255,0.9)" }}
    >
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-bold text-ink-strong">
          <span className="text-ink-subtle mr-1.5">{c.code}</span>
          {c.label}
        </span>
        {atCap && (
          <span className="text-[10px] font-extrabold tracking-[0.12em] rounded-full px-2 py-0.5" style={{ background: "rgba(34,181,99,0.14)", color: "#15803d" }}>
            AT CAP
          </span>
        )}
      </div>
      <div className="mt-3 flex items-baseline gap-1.5">
        <span className="font-bold text-ink-strong text-[22px]" style={{ fontVariantNumeric: "tabular-nums" }}>
          {formatInrPaise(c.earnedPaise)}
        </span>
        <span className="text-ink-subtle text-[12.5px] font-semibold">/ {formatInrPaise(c.capPaise)}</span>
      </div>
      <div className="mt-2.5 h-2 rounded-full overflow-hidden" style={{ background: "rgba(15,23,42,0.06)" }}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: atCap ? "#22b563" : "linear-gradient(90deg, #0a6cff, #12b6a0)" }} />
      </div>
    </div>
  );
}
