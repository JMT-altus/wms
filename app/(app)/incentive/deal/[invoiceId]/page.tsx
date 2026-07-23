import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/current";
import { getDealDetail } from "@/lib/queries/incentive-deal";
import { formatInrPaise } from "@/lib/format";
import { PageHead } from "@/components/incentive/empty-state";
import { DealActions } from "@/components/incentive/deal-actions";

export const dynamic = "force-dynamic";

const STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  collected: { label: "COLLECTED", bg: "rgba(34,181,99,0.14)", fg: "#15803d" },
  partial: { label: "PARTIAL", bg: "rgba(245,158,11,0.16)", fg: "#b45309" },
  due: { label: "DUE", bg: "rgba(10,108,255,0.10)", fg: "#0a47b3" },
  overdue: { label: "OVERDUE", bg: "rgba(239,68,68,0.14)", fg: "#b91c1c" },
};

const ACTION_LABEL: Record<string, string> = {
  logged_sale: "logged this deal",
  edited_sale: "edited the deal",
  deleted_sale: "deleted the deal",
  recorded_payment: "recorded a payment",
  approved: "approved",
  rejected: "rejected",
};

export default async function DealPage({ params }: { params: Promise<{ invoiceId: string }> }) {
  const { invoiceId } = await params;
  const me = await requireUser();
  const deal = await getDealDetail(invoiceId);
  if (!deal) notFound();
  if (!me.isAdmin && deal.ownerId !== me.id) notFound();
  const st = STATUS[deal.status]!;

  return (
    <main className="mx-auto max-w-[1100px] px-10 max-md:px-4 pt-8 pb-16">
      <Link href={"/incentive/sales" as Route} className="text-[13px] font-semibold text-ink-subtle">‹ Back to My Sales</Link>
      <PageHead
        eyebrow={`DEAL · CATEGORY ${deal.category}${deal.invoiceNo ? ` · ${deal.invoiceNo}` : ""}`}
        title={deal.customer}
        sub={`Owned by ${deal.owner} · booked ${deal.bookedAt}`}
        right={<span className="inline-flex items-center rounded-full px-3.5 py-1.5" style={{ background: st.bg, color: st.fg, fontSize: 11.5, fontWeight: 800, letterSpacing: "0.14em" }}>{st.label}{deal.daysPastTerms > 0 ? ` · ${deal.daysPastTerms}D` : ""}</span>}
      />

      {deal.customerId && (
        <p className="-mt-2 mb-5 text-[13px]"><Link href={`/incentive/customer/${deal.customerId}` as Route} className="font-semibold text-[#0a47b3]">View {deal.customer}&apos;s full history →</Link></p>
      )}

      {/* Stats */}
      <div className="grid grid-cols-4 max-md:grid-cols-2 gap-3 mb-6">
        <Stat label="Invoice value" value={formatInrPaise(deal.valuePaise)} />
        <Stat label="Collected" value={formatInrPaise(deal.collectedPaise)} accent="#15803d" />
        <Stat label="Outstanding" value={formatInrPaise(deal.outstandingPaise)} accent={deal.outstandingPaise > 0 ? "#b45309" : "#15803d"} />
        <Stat label="Incentive decay" value={`×${deal.multiplier.toFixed(2)}`} accent={deal.multiplier < 1 ? "#b45309" : "#15803d"} />
      </div>

      {/* Incentive this deal drives */}
      <section className="rounded-[18px] p-5 mb-6" style={{ background: "radial-gradient(80% 140% at 10% 0%, rgba(10,108,255,0.08), transparent 60%),#fff", border: "1px solid rgba(15,23,42,0.08)" }}>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-display-xs text-ink-strong">Incentive this deal drives</h2>
          <span className="font-bold text-ink-strong text-[18px]" style={{ fontVariantNumeric: "tabular-nums" }}>{formatInrPaise(deal.drivesPaise)}</span>
        </div>
        {deal.drivesLines.length === 0 ? (
          <p className="text-ink-muted text-[13.5px]">No incentive yet — {deal.category === "A" || ["N", "I", "R", "V"].includes(deal.category) ? "contributes to the monthly sales slab once the month is computed." : "collect the invoice to earn it."}</p>
        ) : (
          <div className="grid gap-2">
            {deal.drivesLines.map((l, i) => (
              <div key={i} className="flex items-start gap-3 rounded-[12px] px-4 py-3" style={{ background: "rgba(15,23,42,0.015)" }}>
                <span className="shrink-0 inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-extrabold" style={{ background: "rgba(10,108,255,0.08)", color: "#0a47b3" }}>{l.lineCode}</span>
                <p className="text-[13px] text-ink-muted leading-[1.5] flex-1">{l.explanation}</p>
                <span className="font-bold text-ink-strong text-[14px]" style={{ fontVariantNumeric: "tabular-nums" }}>{formatInrPaise(l.amountPaise)}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="grid grid-cols-2 max-md:grid-cols-1 gap-5 mb-6">
        {/* Timeline */}
        <section className="rounded-[18px] p-5" style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)" }}>
          <h2 className="text-display-xs text-ink-strong mb-4">Timeline</h2>
          <div className="grid gap-3">
            <Ev color="#0a6cff" date={deal.bookedAt} title="Booked" sub={`Category ${deal.category}`} />
            <Ev color="#6366F1" date={deal.invoiceDate} title="Invoiced" sub={`${deal.termsDays}-day terms · due ${deal.dueDate}`} />
            {deal.receipts.map((r, i) => <Ev key={i} color="#22b563" date={r.receivedAt} title="Payment received" sub={formatInrPaise(r.amountPaise)} />)}
            {deal.outstandingPaise > 0 && <Ev color="#b45309" date="now" title={`${formatInrPaise(deal.outstandingPaise)} outstanding`} sub={deal.daysPastTerms > 0 ? `${deal.daysPastTerms} days past terms` : "within terms"} />}
          </div>
        </section>

        {/* Audit */}
        <section className="rounded-[18px] p-5" style={{ background: "#fff", border: "1px solid rgba(15,23,42,0.08)" }}>
          <h2 className="text-display-xs text-ink-strong mb-4">Audit trail</h2>
          {deal.audit.length === 0 ? (
            <p className="text-ink-muted text-[13.5px]">No recorded actions.</p>
          ) : (
            <div className="grid gap-3">
              {deal.audit.map((a, i) => (
                <div key={i} className="flex items-start gap-3">
                  <span className="inline-block size-2 rounded-full mt-1.5 shrink-0" style={{ background: "#94a3b8" }} />
                  <div className="text-[13px] leading-[1.5]">
                    <span className="font-bold text-ink-strong">{a.actor ?? "Someone"}</span> <span className="text-ink-muted">{ACTION_LABEL[a.action] ?? a.action}</span>
                    {typeof a.detail.amountPaise === "number" && <span className="text-ink-muted"> · {formatInrPaise(a.detail.amountPaise as number)}</span>}
                    <div className="text-ink-subtle text-[11.5px] mt-0.5">{a.at.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <h2 className="text-display-xs text-ink-strong mb-3">Manage</h2>
      <DealActions deal={{ invoiceId: deal.invoiceId, outstandingPaise: deal.outstandingPaise, customer: deal.customer, category: deal.category, valueRupees: Math.round(deal.valuePaise / 100), invoiceDate: deal.invoiceDate, termsDays: deal.termsDays }} />
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

function Ev({ color, date, title, sub }: { color: string; date: string; title: string; sub: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="inline-block size-2.5 rounded-full mt-1 shrink-0" style={{ background: color }} />
      <div className="flex-1">
        <div className="flex items-center justify-between gap-2">
          <span className="font-bold text-ink-strong text-[13.5px]">{title}</span>
          <span className="text-ink-subtle text-[12px] font-semibold">{date}</span>
        </div>
        <div className="text-ink-muted text-[12.5px]">{sub}</div>
      </div>
    </div>
  );
}
