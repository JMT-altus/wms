import { requireAdmin } from "@/lib/auth/current";
import { SALES_BH_SCHEME } from "@/lib/incentives";
import { formatInrPaise } from "@/lib/format";
import { getPendingSubmissions } from "@/lib/queries/incentives";
import { VerificationQueue } from "@/components/incentive/verification-queue";
import { RecomputeButton } from "@/components/incentive/recompute-button";

export const dynamic = "force-dynamic";

const CATEGORY_LABELS: Record<string, string> = {
  A: "Sales Slabs", B: "Cross-sell", C: "New Customer",
  D: "Leads & Enquiries", E: "Client Meetings", F: "Reviews & Testimonials", G: "Retention",
};

export default async function IncentiveAdminPage() {
  await requireAdmin();
  const s = SALES_BH_SCHEME;
  const pending = await getPendingSubmissions();

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
