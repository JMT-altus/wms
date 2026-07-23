import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/current";
import { db } from "@/lib/db";
import { employees } from "@/db/schema";
import { getIncentiveSummary, currentPeriodIST, periodLabel } from "@/lib/queries/incentives";
import { getMonthlySales, getMySales, getMyHistory } from "@/lib/queries/incentive-views";
import { getAtRiskInvoices } from "@/lib/queries/incentive-risk";
import { getRepCustomers, getRepAudit } from "@/lib/queries/incentive-admin";
import { formatInrPaise, formatInrCompactPaise } from "@/lib/format";
import { PageHead } from "@/components/incentive/empty-state";

export const dynamic = "force-dynamic";

const ACTION_LABEL: Record<string, string> = { logged_sale: "logged a deal", edited_sale: "edited a deal", deleted_sale: "deleted a deal", recorded_payment: "recorded a payment", approved: "approved a submission", rejected: "rejected a submission", locked: "locked the period", paid: "marked paid", published_scheme: "published a scheme", recomputed: "recomputed" };

export default async function RepProfilePage({ params }: { params: Promise<{ employeeId: string }> }) {
  const { employeeId } = await params;
  await requireAdmin();
  const [emp] = await db.select({ name: employees.name }).from(employees).where(eq(employees.id, employeeId)).limit(1);
  if (!emp) notFound();
  const period = currentPeriodIST();

  const [summary, booked, sales, history, atRisk, custs, audit] = await Promise.all([
    getIncentiveSummary(employeeId, period), getMonthlySales(employeeId, period), getMySales(employeeId),
    getMyHistory(employeeId), getAtRiskInvoices(employeeId), getRepCustomers(employeeId), getRepAudit(employeeId, 15),
  ]);
  const atRiskTotal = atRisk.reduce((s, r) => s + r.atRiskPaise, 0);
  const max = Math.max(...history.map((h) => h.totalPaise), 1);

  return (
    <main className="mx-auto max-w-[1180px] px-10 max-md:px-4 pt-8 pb-16">
      <Link href={"/incentive/admin" as Route} className="text-[13px] font-semibold text-ink-subtle">‹ Back to Control Room</Link>
      <PageHead eyebrow={`REP · ${periodLabel(period)}`} title={emp.name} sub="Full picture — deal book, customers, trend, risk and audit." />

      <div className="grid grid-cols-4 max-md:grid-cols-2 gap-3 mb-6">
        <Stat label="Incentive this month" value={formatInrPaise(summary.totalPaise)} accent="#0a47b3" />
        <Stat label="Booked sales" value={formatInrCompactPaise(booked)} />
        <Stat label="At risk" value={formatInrPaise(atRiskTotal)} accent={atRiskTotal > 0 ? "#b45309" : "#15803d"} />
        <Stat label="Deals" value={String(sales.length)} />
      </div>

      {/* Trend */}
      {history.length > 0 && (
        <section className="rounded-[18px] p-5 mb-6" style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)" }}>
          <h2 className="text-display-xs text-ink-strong mb-4">Incentive trend</h2>
          <div className="flex items-end gap-3" style={{ height: 130 }}>
            {history.slice().reverse().map((h) => (
              <div key={h.period} className="flex-1 flex flex-col items-center justify-end gap-2">
                <span className="text-[10.5px] font-bold text-ink-strong">{h.totalPaise > 0 ? formatInrCompactPaise(h.totalPaise) : ""}</span>
                <div className="w-full rounded-t-lg" style={{ height: `${Math.max(2, (h.totalPaise / max) * 100)}px`, background: "linear-gradient(180deg,#0a6cff,#12b6a0)" }} />
                <span className="text-[10px] font-semibold text-ink-subtle">{periodLabel(h.period).split(" ")[0]}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <div className="grid grid-cols-2 max-md:grid-cols-1 gap-5 mb-6">
        {/* Deal book */}
        <section>
          <h2 className="text-display-xs text-ink-strong mb-3">Deal book</h2>
          {sales.length === 0 ? <p className="text-ink-muted text-[13.5px]">No deals.</p> : (
            <div className="rounded-[16px] overflow-hidden" style={{ border: "1px solid rgba(15,23,42,0.08)" }}>
              {sales.slice(0, 12).map((s, i) => (
                <Link key={s.invoiceId} href={`/incentive/deal/${s.invoiceId}` as Route} className="flex items-center justify-between px-4 py-2.5 hover:bg-[rgba(10,108,255,0.03)]" style={{ background: i % 2 ? "rgba(15,23,42,0.015)" : "#fff", borderTop: i ? "1px solid rgba(15,23,42,0.05)" : undefined }}>
                  <span className="text-[13px] font-semibold text-ink-strong truncate">{s.customer}<span className="text-ink-subtle font-normal"> · {s.category}</span></span>
                  <span className="text-[13px] font-bold text-ink-strong" style={{ fontVariantNumeric: "tabular-nums" }}>{formatInrCompactPaise(s.valuePaise)}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Customers */}
        <section>
          <h2 className="text-display-xs text-ink-strong mb-3">Customers ({custs.length})</h2>
          {custs.length === 0 ? <p className="text-ink-muted text-[13.5px]">No acquired customers.</p> : (
            <div className="rounded-[16px] overflow-hidden" style={{ border: "1px solid rgba(15,23,42,0.08)" }}>
              {custs.slice(0, 12).map((c, i) => (
                <Link key={c.id} href={`/incentive/customer/${c.id}` as Route} className="flex items-center justify-between px-4 py-2.5 hover:bg-[rgba(10,108,255,0.03)]" style={{ background: i % 2 ? "rgba(15,23,42,0.015)" : "#fff", borderTop: i ? "1px solid rgba(15,23,42,0.05)" : undefined }}>
                  <span className="text-[13px] font-semibold text-ink-strong truncate">{c.name}</span>
                  <span className="text-[12.5px] text-ink-subtle font-semibold">{c.deals} deal{c.deals === 1 ? "" : "s"}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>

      {/* Audit */}
      <h2 className="text-display-xs text-ink-strong mb-3">Recent activity</h2>
      {audit.length === 0 ? <p className="text-ink-muted text-[13.5px]">No recorded activity.</p> : (
        <div className="rounded-[16px] p-5 grid gap-3" style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)" }}>
          {audit.map((a, i) => (
            <div key={i} className="flex items-start gap-3 text-[13px]">
              <span className="inline-block size-2 rounded-full mt-1.5 shrink-0" style={{ background: "#94a3b8" }} />
              <div className="leading-[1.5]"><span className="font-bold text-ink-strong">{a.actor ?? "Someone"}</span> <span className="text-ink-muted">{ACTION_LABEL[a.action] ?? a.action}</span>{typeof a.detail.amountPaise === "number" && <span className="text-ink-muted"> · {formatInrPaise(a.detail.amountPaise as number)}</span>}<div className="text-ink-subtle text-[11.5px] mt-0.5">{a.at.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</div></div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-[14px] p-4" style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)" }}>
      <div className="text-ink-subtle text-[11px] font-bold uppercase tracking-[0.1em]">{label}</div>
      <div className="mt-1 font-bold text-[18px]" style={{ color: accent ?? "var(--color-ink-strong)", fontVariantNumeric: "tabular-nums" }}>{value}</div>
    </div>
  );
}
