import Link from "next/link";
import type { Route } from "next";
import { ChevronRight, History } from "lucide-react";
import type { SalaryMonthTotal } from "@/lib/queries/salary";
import { inr2, type PaymentStatus } from "@/lib/salary/money";
import { monthTitle } from "@/lib/salary/daily-report";
import { ACCENT, BORDER_SOFT, CARD, NAVY, SLATE } from "@/components/attendance/overview/theme";
import { PaymentStatusPill } from "@/components/salary/my/status-pill";

const n = (v: number) => v.toLocaleString("en-IN");

/** A month is paid when every run is disbursed, pending when none is, partly paid in between. */
export const monthPaymentStatus = (m: Pick<SalaryMonthTotal, "runs" | "disbursed">): PaymentStatus => (m.disbursed === 0 ? "pending" : m.disbursed === m.runs ? "paid" : "partial");

/** Every month with salary runs, newest first, with its total net payable; each row opens that month. */
export function PayrollHistoryCard({ history, current }: { history: SalaryMonthTotal[]; current: string }) {
  return (
    <section className="rounded-xl p-6 max-md:p-4" style={CARD} aria-labelledby="ph-title">
      <h2 id="ph-title" className="flex items-center gap-2 text-[11.5px] font-bold uppercase tracking-[0.12em]" style={{ color: SLATE }}>
        <History size={14} aria-hidden style={{ color: ACCENT }} /> History
      </h2>
      {history.length === 0 ? (
        <p className="mt-4 text-[14px]" style={{ color: SLATE }}>
          No salary has been generated yet. Months appear here once their runs exist.
        </p>
      ) : (
        <ul className="mt-3" aria-label="Salary history">
          {history.map((m) => {
            const active = m.month === current;
            return (
              <li key={m.month} style={{ borderTop: `1px solid ${BORDER_SOFT}` }}>
                <Link
                  href={`/salary?month=${m.month}` as Route}
                  scroll={false}
                  aria-current={active ? "page" : undefined}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-[#F6F8FB] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A6CFF]"
                  style={active ? { background: "#F3F6FA" } : undefined}
                >
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold" style={{ color: NAVY }}>
                      {monthTitle(m.month)}
                    </span>
                    <span className="block text-[12px] tabular-nums" style={{ color: SLATE }}>
                      {m.fy} · {n(m.runs)} {m.runs === 1 ? "run" : "runs"} · {n(m.disbursed)} paid
                      {m.imported > 0 ? ` · ${n(m.imported)} imported` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <PaymentStatusPill status={monthPaymentStatus(m)} size="sm" />
                    <span className="text-[14px] font-bold tabular-nums" style={{ color: NAVY }}>
                      {inr2(m.netPayable)}
                    </span>
                    <ChevronRight size={16} aria-hidden style={{ color: SLATE }} />
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
