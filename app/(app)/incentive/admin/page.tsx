import { requireAdmin } from "@/lib/auth/current";
import { SALES_BH_SCHEME } from "@/lib/incentives";
import { formatInrPaise, formatInrCompactPaise } from "@/lib/format";
import { getPendingSubmissions } from "@/lib/queries/incentives";
import { getCollectionWatchtower } from "@/lib/queries/incentive-risk";
import { listEmployeeOptions } from "@/lib/queries/employees";
import { VerificationQueue } from "@/components/incentive/verification-queue";
import { RecomputeButton } from "@/components/incentive/recompute-button";
import { DataEntry } from "@/components/incentive/data-entry";

export const dynamic = "force-dynamic";

const CATEGORY_LABELS: Record<string, string> = {
  A: "Sales Slabs", B: "Cross-sell", C: "New Customer",
  D: "Leads & Enquiries", E: "Client Meetings", F: "Reviews & Testimonials", G: "Retention",
};

export default async function IncentiveAdminPage() {
  await requireAdmin();
  const s = SALES_BH_SCHEME;
  const [pending, watchtower, employees] = await Promise.all([
    getPendingSubmissions(),
    getCollectionWatchtower(),
    listEmployeeOptions(),
  ]);

  return (
    <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
      <div className="mb-7">
        <div style={{ fontFamily: "var(--font-mono-display), ui-monospace, monospace", fontSize: 12, fontWeight: 800, letterSpacing: "0.24em", color: "#0A6CFF" }}>
          INCENTIVE TRACKER · ADMIN
        </div>
        <h1 className="text-display-md text-ink-strong mt-2">Scheme &amp; Controls</h1>
        <p className="text-ink-muted mt-1 text-[15px]">The active Sales-BH scheme, plus the verification queue. Ingestion and period-close tools are next.</p>
      </div>

      {/* Verification queue */}
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-display-xs text-ink-strong">Verification queue</h2>
        {pending.length > 0 && (
          <span className="text-[11px] font-extrabold tracking-[0.12em] rounded-full px-2 py-0.5" style={{ background: "rgba(245,158,11,0.16)", color: "#b45309" }}>
            {pending.length} PENDING
          </span>
        )}
      </div>
      <div className="mb-4">
        <VerificationQueue items={pending} />
      </div>
      <div className="mb-8">
        <RecomputeButton />
      </div>

      {/* Data ingestion */}
      <h2 className="text-display-xs text-ink-strong mb-3">Record sales &amp; collections</h2>
      <div className="mb-8">
        <DataEntry employees={employees} />
      </div>

      {/* Collection watchtower */}
      <h2 className="text-display-xs text-ink-strong mb-3">Collection watchtower</h2>
      <div className="grid grid-cols-4 max-md:grid-cols-2 gap-3 mb-4">
        {watchtower.buckets.map((b) => (
          <div key={b.key} className="rounded-[16px] p-4" style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)" }}>
            <div className="text-[11.5px] font-bold uppercase tracking-[0.1em] text-ink-subtle">{b.label}</div>
            <div className="mt-1.5 font-bold text-ink-strong text-[19px]" style={{ fontVariantNumeric: "tabular-nums" }}>{formatInrCompactPaise(b.outstandingPaise)}</div>
            <div className="text-ink-subtle text-[12px]">{b.count} invoice{b.count === 1 ? "" : "s"}</div>
          </div>
        ))}
      </div>
      {watchtower.rows.length > 0 && (
        <div className="rounded-[18px] overflow-hidden mb-8" style={{ border: "1px solid rgba(15,23,42,0.08)" }}>
          {watchtower.rows.map((r, i) => (
            <div key={i} className="flex items-center gap-4 px-5 py-3 max-md:flex-wrap" style={{ background: i % 2 ? "rgba(15,23,42,0.015)" : "#fff", borderTop: i ? "1px solid rgba(15,23,42,0.05)" : undefined }}>
              <div className="flex-1 min-w-0">
                <span className="font-bold text-ink-strong text-[13.5px]">{r.customer}</span>
                {r.invoiceNo && <span className="text-ink-subtle text-[12.5px] font-semibold"> · {r.invoiceNo}</span>}
                <span className="text-ink-subtle text-[12.5px]"> · {r.owner}</span>
              </div>
              <span className="shrink-0 text-[12.5px] font-semibold text-ink-muted">{r.daysPastTerms}d past · ×{r.multiplier.toFixed(2)}</span>
              <span className="shrink-0 font-bold text-ink-strong text-[14px]" style={{ fontVariantNumeric: "tabular-nums" }}>{formatInrPaise(r.outstandingPaise)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Active category caps */}
      <h2 className="text-display-xs text-ink-strong mb-3">Category ceilings</h2>
      <div className="grid grid-cols-3 max-md:grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        {(["A", "B", "C", "D", "E", "F"] as const).map((code) => (
          <div key={code} className="rounded-[18px] p-5" style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)" }}>
            <div className="text-[13px] font-bold text-ink-strong"><span className="text-ink-subtle mr-1.5">{code}</span>{CATEGORY_LABELS[code]}</div>
            <div className="mt-2 font-bold text-ink-strong text-[22px]" style={{ fontVariantNumeric: "tabular-nums" }}>{formatInrPaise(s.categoryCaps[code])}</div>
          </div>
        ))}
      </div>

      {/* Scheme summary */}
      <h2 className="text-display-xs text-ink-strong mb-3">Rules</h2>
      <div className="rounded-[18px] p-6 text-[14px] leading-[1.7] text-ink-muted" style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)" }}>
        <p><b className="text-ink-strong">A · Sales slabs</b> — marginal from ₹1 Cr: 0.10% / 0.15% / 0.20% per ₹20 L band, cap {formatInrPaise(s.categoryCaps.A)}.</p>
        <p><b className="text-ink-strong">B · Cross-sell</b> — 1% of the first invoice above ₹1 L, cap {formatInrPaise(s.categoryCaps.B)}.</p>
        <p><b className="text-ink-strong">C · New customer</b> — 1% of first 3 transactions (≥₹2.5 L turnover, fully paid), cap {formatInrPaise(s.categoryCaps.C)}.</p>
        <p><b className="text-ink-strong">D · Leads</b> — ₹250 per 10 profiled leads / per 5 enquiries, cap {formatInrPaise(s.categoryCaps.D)}.</p>
        <p><b className="text-ink-strong">E · Meetings</b> — discretionary ₹250–₹1,000 per high-value meeting, cap {formatInrPaise(s.categoryCaps.E)}.</p>
        <p><b className="text-ink-strong">F · Reviews</b> — Google ₹100 / email ₹100 / letterhead ₹150, doubled when a name is mentioned, cap {formatInrPaise(s.categoryCaps.F)}.</p>
        <p className="mt-2"><b className="text-ink-strong">Collection decay</b> — payment &gt;45 days past terms halves, &gt;75 quarters, &gt;100 voids the incentive. Scheme monthly ceiling {formatInrPaise(s.schemeMonthlyCapPaise)}.</p>
      </div>
    </main>
  );
}
