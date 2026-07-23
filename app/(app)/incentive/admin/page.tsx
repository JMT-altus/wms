import Link from "next/link";
import type { Route } from "next";
import { requireAdmin } from "@/lib/auth/current";
import { SALES_BH_SCHEME } from "@/lib/incentives";
import { formatInrPaise, formatInrCompactPaise } from "@/lib/format";
import { getPendingSubmissions, getPeriodPayout, currentPeriodIST, periodLabel } from "@/lib/queries/incentives";
import { getCollectionWatchtower } from "@/lib/queries/incentive-risk";
import { getLeaderboard, getAdminAnalytics, getPeriodLedgerByEmployee, type LeaderRow } from "@/lib/queries/incentive-admin";
import { listEmployeeOptions } from "@/lib/queries/employees";
import { VerificationQueue } from "@/components/incentive/verification-queue";
import { RecomputeButton } from "@/components/incentive/recompute-button";
import { DataEntry } from "@/components/incentive/data-entry";
import { PeriodControls } from "@/components/incentive/period-controls";
import { PayoutTable } from "@/components/incentive/payout-table";
import { AdminAnalyticsView } from "@/components/incentive/admin-analytics";

export const dynamic = "force-dynamic";

type Tab = "period" | "verify" | "data" | "collections" | "insights" | "scheme";
const TABS: { id: Tab; label: string }[] = [
  { id: "period", label: "Period & Payouts" },
  { id: "verify", label: "Verify" },
  { id: "data", label: "Sales Data" },
  { id: "collections", label: "Collections" },
  { id: "insights", label: "Insights" },
  { id: "scheme", label: "Scheme" },
];

const CATEGORY_LABELS: Record<string, string> = { A: "Sales Slabs", B: "Cross-sell", C: "New Customer", D: "Leads & Enquiries", E: "Client Meetings", F: "Reviews & Testimonials", G: "Retention" };

type PageProps = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function IncentiveAdminPage({ searchParams }: PageProps) {
  await requireAdmin();
  const sp = await searchParams;
  const tab = (typeof sp.tab === "string" && TABS.some((t) => t.id === sp.tab) ? sp.tab : "period") as Tab;
  const period = currentPeriodIST();

  return (
    <main className="mx-auto max-w-[1280px] px-10 max-md:px-4 pt-8 pb-16">
      <div className="mb-5">
        <div style={{ fontFamily: "var(--font-mono-display), ui-monospace, monospace", fontSize: 12, fontWeight: 800, letterSpacing: "0.24em", color: "#0A6CFF" }}>INCENTIVE TRACKER · ADMIN · {periodLabel(period)}</div>
        <h1 className="text-display-md text-ink-strong mt-2">Control Room</h1>
      </div>

      <div className="flex items-center gap-1 border-b mb-6 overflow-x-auto" style={{ borderColor: "rgba(15,23,42,0.1)" }}>
        {TABS.map((t) => {
          const active = t.id === tab;
          return (
            <Link key={t.id} href={`/incentive/admin?tab=${t.id}` as Route} className="px-4 py-2.5 text-[14px] font-bold whitespace-nowrap transition-colors" style={{ color: active ? "#0a47b3" : "#64748b", borderBottom: active ? "2.5px solid #0a6cff" : "2.5px solid transparent", marginBottom: -1 }}>{t.label}</Link>
          );
        })}
      </div>

      {tab === "period" && <PeriodTab period={period} />}
      {tab === "verify" && <VerifyTab />}
      {tab === "data" && <DataTab />}
      {tab === "collections" && <CollectionsTab />}
      {tab === "insights" && <InsightsTab period={period} />}
      {tab === "scheme" && <SchemeTab />}
    </main>
  );
}

async function PeriodTab({ period }: { period: string }) {
  const [payout, ledgerByEmployee, leaders] = await Promise.all([getPeriodPayout(period), getPeriodLedgerByEmployee(period), getLeaderboard(period)]);
  return (
    <>
      <div className="rounded-[18px] p-5 mb-6" style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)" }}>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
          <div>
            <h2 className="text-display-xs text-ink-strong">Payout · {periodLabel(period)}</h2>
            <p className="text-ink-muted text-[13px] mt-0.5">Total <b className="text-ink-strong">{formatInrPaise(payout.grandTotalPaise)}</b> · {payout.rows.length} employee{payout.rows.length === 1 ? "" : "s"} · tap a row to drill in</p>
          </div>
          <PeriodControls status={payout.status} />
        </div>
        <PayoutTable rows={payout.rows} ledgerByEmployee={ledgerByEmployee} />
      </div>

      <h2 className="text-display-xs text-ink-strong mb-1">Leaderboard</h2>
      <p className="text-ink-muted text-[13px] mb-3">Ranked on qualifying activity — collections closed &amp; new customers won, not pay.</p>
      <Leaderboard leaders={leaders} />
    </>
  );
}

function Leaderboard({ leaders }: { leaders: LeaderRow[] }) {
  if (leaders.length === 0) return <p className="text-ink-muted text-[13.5px]">No activity yet this month.</p>;
  const medal = ["🥇", "🥈", "🥉"];
  return (
    <div className="rounded-[18px] overflow-hidden" style={{ border: "1px solid rgba(15,23,42,0.08)" }}>
      <div className="grid grid-cols-[auto_1fr_auto_auto_auto] max-md:hidden px-5 py-2.5 text-[11px] font-extrabold uppercase tracking-[0.1em] text-ink-subtle" style={{ background: "rgba(15,23,42,0.02)" }}>
        <span style={{ width: 30 }}>#</span><span>Employee</span><span className="text-right pr-6">Collected</span><span className="text-right pr-6">New cust.</span><span className="text-right">Incentive</span>
      </div>
      {leaders.map((l, i) => (
        <div key={l.employeeId} className="grid grid-cols-[auto_1fr_auto_auto_auto] max-md:grid-cols-2 gap-y-1 items-center px-5 py-3" style={{ background: i % 2 ? "rgba(15,23,42,0.015)" : "#fff", borderTop: i ? "1px solid rgba(15,23,42,0.06)" : undefined }}>
          <span className="text-[15px]" style={{ width: 30 }}>{medal[i] ?? <span className="text-ink-subtle text-[13px] font-bold">{i + 1}</span>}</span>
          <span className="font-bold text-ink-strong text-[13.5px]">{l.name}</span>
          <span className="text-right pr-6 font-bold text-ink-strong text-[13.5px]" style={{ fontVariantNumeric: "tabular-nums" }}>{formatInrCompactPaise(l.collectedPaise)}</span>
          <span className="text-right pr-6 text-[13.5px] font-semibold text-ink-muted">{l.newCustomers}</span>
          <span className="text-right text-[13.5px] font-bold" style={{ color: "#0a47b3", fontVariantNumeric: "tabular-nums" }}>{formatInrPaise(l.incentivePaise)}</span>
        </div>
      ))}
    </div>
  );
}

async function VerifyTab() {
  const pending = await getPendingSubmissions();
  return (
    <>
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-display-xs text-ink-strong">Verification queue</h2>
        {pending.length > 0 && <span className="text-[11px] font-extrabold tracking-[0.12em] rounded-full px-2 py-0.5" style={{ background: "rgba(245,158,11,0.16)", color: "#b45309" }}>{pending.length} PENDING</span>}
      </div>
      <div className="mb-4"><VerificationQueue items={pending} /></div>
      <RecomputeButton />
    </>
  );
}

async function DataTab() {
  const employees = await listEmployeeOptions();
  return (
    <>
      <h2 className="text-display-xs text-ink-strong mb-3">Record sales &amp; collections</h2>
      <DataEntry employees={employees} />
    </>
  );
}

async function CollectionsTab() {
  const watchtower = await getCollectionWatchtower();
  return (
    <>
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
        <div className="rounded-[18px] overflow-hidden" style={{ border: "1px solid rgba(15,23,42,0.08)" }}>
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
    </>
  );
}

async function InsightsTab({ period }: { period: string }) {
  const a = await getAdminAnalytics(period);
  return (
    <>
      <h2 className="text-display-xs text-ink-strong mb-4">Insights</h2>
      <AdminAnalyticsView a={a} />
    </>
  );
}

function SchemeTab() {
  const s = SALES_BH_SCHEME;
  return (
    <>
      <h2 className="text-display-xs text-ink-strong mb-3">Category ceilings</h2>
      <div className="grid grid-cols-3 max-md:grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
        {(["A", "B", "C", "D", "E", "F"] as const).map((code) => (
          <div key={code} className="rounded-[18px] p-5" style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)" }}>
            <div className="text-[13px] font-bold text-ink-strong"><span className="text-ink-subtle mr-1.5">{code}</span>{CATEGORY_LABELS[code]}</div>
            <div className="mt-2 font-bold text-ink-strong text-[22px]" style={{ fontVariantNumeric: "tabular-nums" }}>{formatInrPaise(s.categoryCaps[code])}</div>
          </div>
        ))}
      </div>
      <h2 className="text-display-xs text-ink-strong mb-3">Rules</h2>
      <div className="rounded-[18px] p-6 text-[14px] leading-[1.7] text-ink-muted" style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)" }}>
        <p><b className="text-ink-strong">A · Sales slabs</b> — marginal from ₹1 Cr: 0.10% / 0.15% / 0.20% per ₹20 L band, cap {formatInrPaise(s.categoryCaps.A)}.</p>
        <p><b className="text-ink-strong">B · Cross-sell</b> — 1% of the first invoice above ₹1 L, cap {formatInrPaise(s.categoryCaps.B)}.</p>
        <p><b className="text-ink-strong">C · New customer</b> — 1% of first 3 transactions (≥₹2.5 L turnover, fully paid), cap {formatInrPaise(s.categoryCaps.C)}.</p>
        <p><b className="text-ink-strong">D · Leads</b> — ₹250 per 10 profiled leads / per 5 enquiries, cap {formatInrPaise(s.categoryCaps.D)}.</p>
        <p><b className="text-ink-strong">E · Meetings</b> — discretionary ₹250–₹1,000, cap {formatInrPaise(s.categoryCaps.E)}.</p>
        <p><b className="text-ink-strong">F · Reviews</b> — Google ₹100 / email ₹100 / letterhead ₹150, doubled when a name is mentioned, cap {formatInrPaise(s.categoryCaps.F)}.</p>
        <p className="mt-2"><b className="text-ink-strong">Collection decay</b> — &gt;45 days halves, &gt;75 quarters, &gt;100 voids. Scheme ceiling {formatInrPaise(s.schemeMonthlyCapPaise)}.</p>
      </div>
    </>
  );
}
