import Link from "next/link";
import type { Route } from "next";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/current";
import { getCustomerDetail } from "@/lib/queries/incentive-customer";
import { formatInrPaise, formatInrCompactPaise } from "@/lib/format";
import { PageHead } from "@/components/incentive/empty-state";

export const dynamic = "force-dynamic";

const SALE_STATUS: Record<string, { label: string; bg: string; fg: string }> = {
  collected: { label: "COLLECTED", bg: "rgba(34,181,99,0.14)", fg: "#15803d" },
  partial: { label: "PARTIAL", bg: "rgba(245,158,11,0.16)", fg: "#b45309" },
  due: { label: "DUE", bg: "rgba(10,108,255,0.10)", fg: "#0a47b3" },
  overdue: { label: "OVERDUE", bg: "rgba(239,68,68,0.14)", fg: "#b91c1c" },
};

export default async function CustomerPage({ params }: { params: Promise<{ customerId: string }> }) {
  const { customerId } = await params;
  const me = await requireUser();
  const c = await getCustomerDetail(customerId);
  if (!c) notFound();

  const reliability = c.avgDaysLate == null ? "No collection history" : c.avgDaysLate <= 5 ? "Reliable" : c.avgDaysLate <= 30 ? "Usually on time" : c.avgDaysLate <= 60 ? "Often late" : "Chronically late";
  const relColor = c.avgDaysLate == null ? "#64748b" : c.avgDaysLate <= 5 ? "#15803d" : c.avgDaysLate <= 30 ? "#0a47b3" : c.avgDaysLate <= 60 ? "#b45309" : "#b91c1c";

  return (
    <main className="mx-auto max-w-[1100px] px-10 max-md:px-4 pt-8 pb-16">
      <Link href={"/incentive/sales" as Route} className="text-[13px] font-semibold text-ink-subtle">‹ Back</Link>
      <PageHead
        eyebrow={`CUSTOMER${c.isNewCustomer ? " · NEW" : ""}`}
        title={c.name}
        sub={c.owner ? `Owned by ${c.owner}${c.firstTransactionAt ? ` · first deal ${c.firstTransactionAt}` : ""}` : "Unassigned"}
        right={<span className="inline-flex items-center rounded-full px-3.5 py-1.5" style={{ background: `${relColor}22`, color: relColor, fontSize: 11.5, fontWeight: 800, letterSpacing: "0.1em" }}>{reliability.toUpperCase()}{c.avgDaysLate != null ? ` · ${c.avgDaysLate}D AVG` : ""}</span>}
      />

      <div className="grid grid-cols-4 max-md:grid-cols-2 gap-3 mb-6">
        <Stat label="Lifetime business" value={formatInrCompactPaise(c.lifetimePaise)} />
        <Stat label="Deals" value={String(c.dealCount)} />
        <Stat label="Outstanding" value={formatInrPaise(c.outstandingPaise)} accent={c.outstandingPaise > 0 ? "#b45309" : "#15803d"} />
        <Stat label="Incentive generated" value={formatInrPaise(c.incentiveGeneratedPaise)} accent="#0a47b3" />
      </div>

      <div className="grid grid-cols-2 max-md:grid-cols-1 gap-3 mb-7">
        <Stat label="Collected" value={formatInrPaise(c.collectedPaise)} accent="#15803d" />
        <Stat label="FY turnover (for C eligibility)" value={formatInrPaise(c.fyTurnoverPaise)} />
      </div>

      <h2 className="text-display-xs text-ink-strong mb-3">Deals</h2>
      {c.deals.length === 0 ? (
        <p className="text-ink-muted text-[14px]">No deals recorded for this customer.</p>
      ) : (
        <div className="rounded-[18px] overflow-hidden" style={{ border: "1px solid rgba(15,23,42,0.08)" }}>
          {c.deals.map((d, i) => {
            const st = SALE_STATUS[d.status]!;
            return (
              <Link key={d.invoiceId} href={`/incentive/deal/${d.invoiceId}` as Route} className="group grid grid-cols-[1fr_auto_auto_auto] max-md:grid-cols-1 gap-y-1 items-center px-5 py-3.5 transition-colors hover:bg-[rgba(10,108,255,0.03)]" style={{ background: i % 2 ? "rgba(15,23,42,0.015)" : "#fff", borderTop: "1px solid rgba(15,23,42,0.06)" }}>
                <div className="min-w-0">
                  <span className="inline-flex items-center justify-center rounded-md px-1.5 py-0.5 text-[10.5px] font-extrabold mr-2" style={{ background: "rgba(10,108,255,0.08)", color: "#0a47b3" }}>{d.category}</span>
                  <span className="font-bold text-ink-strong text-[13.5px] group-hover:underline">{d.invoiceNo ?? "Invoice"}</span>
                  <span className="text-ink-subtle text-[12px]"> · {d.bookedAt}</span>
                </div>
                <span className="text-right pr-6 font-bold text-ink-strong text-[13.5px]" style={{ fontVariantNumeric: "tabular-nums" }}>{formatInrCompactPaise(d.valuePaise)}</span>
                <span className="text-right pr-6"><span className="inline-flex items-center rounded-full px-2.5 py-1 text-[10.5px] font-extrabold" style={{ background: st.bg, color: st.fg }}>{st.label}</span></span>
                <span className="text-right text-[12.5px] font-bold" style={{ color: d.multiplier < 1 ? "#b45309" : "#64748b" }}>×{d.multiplier.toFixed(2)}</span>
              </Link>
            );
          })}
        </div>
      )}
      {me.isAdmin && c.ownerId && <p className="mt-4 text-[13px]"><Link href={`/incentive/admin/rep/${c.ownerId}` as Route} className="font-semibold text-[#0a47b3]">View owning rep →</Link></p>}
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
