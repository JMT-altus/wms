import Link from "next/link";
import type { Route } from "next";
import { ChevronRight, History } from "lucide-react";
import type { SalaryMonthTotal } from "@/lib/queries/salary";
import { inr2, type PaymentStatus } from "@/lib/salary/money";
import { monthTitle } from "@/lib/salary/daily-report";
import { BLUE, BLUE_SOFT, BORDER_SOFT, FAINT, NAVY, SECTION_HEAD, SECTION_TITLE, SLATE, SURFACE } from "@/components/salary/ui";
import { PaymentStatusPill } from "@/components/salary/my/status-pill";

const n = (v: number) => v.toLocaleString("en-IN");

/** A month is paid when every run is disbursed, pending when none is, partly paid in between. */
export const monthPaymentStatus = (m: Pick<SalaryMonthTotal, "runs" | "disbursed">): PaymentStatus => (m.disbursed === 0 ? "pending" : m.disbursed === m.runs ? "paid" : "partial");

/** Every month with salary runs, newest first, with its total net payable; each row opens that month. */
export function PayrollHistoryCard({ history, current }: { history: SalaryMonthTotal[]; current: string }) {
  return (
    <section className="overflow-hidden" style={SURFACE} aria-labelledby="ph-title">
      <div className={SECTION_HEAD}>
        <h2 id="ph-title" className={SECTION_TITLE}>
          <History size={15} aria-hidden style={{ color: BLUE }} /> History
        </h2>
      </div>
      {history.length === 0 ? (
        <p className="px-4 py-3.5 text-[13px]" style={{ color: SLATE }}>
          No salary has been generated yet. Months appear here once their runs exist.
        </p>
      ) : (
        <ul aria-label="Salary history">
          {history.map((m, i) => {
            const active = m.month === current;
            return (
              <li key={m.month} style={i > 0 ? { borderTop: `1px solid ${BORDER_SOFT}` } : undefined}>
                <Link
                  href={`/salary?month=${m.month}` as Route}
                  scroll={false}
                  aria-current={active ? "page" : undefined}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-[#F6F9FF] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-[#0A6CFF]/20"
                  style={active ? { background: BLUE_SOFT, boxShadow: `inset 3px 0 0 ${BLUE}` } : undefined}
                >
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-semibold" style={{ color: NAVY }}>
                      {monthTitle(m.month)}
                    </span>
                    <span className="block text-[11.5px] tabular-nums" style={{ color: SLATE }}>
                      {m.fy} · {n(m.runs)} {m.runs === 1 ? "run" : "runs"} · {n(m.disbursed)} paid
                      {m.imported > 0 ? ` · ${n(m.imported)} imported` : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <PaymentStatusPill status={monthPaymentStatus(m)} size="sm" />
                    <span className="min-w-[110px] text-right text-[13.5px] font-semibold tabular-nums" style={{ color: NAVY }}>
                      {inr2(m.netPayable)}
                    </span>
                    <ChevronRight size={15} aria-hidden style={{ color: FAINT }} />
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
