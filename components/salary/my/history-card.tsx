import Link from "next/link";
import type { Route } from "next";
import { ChevronRight, History } from "lucide-react";
import type { SalaryRunRow } from "@/lib/queries/salary";
import { inr2, paymentStatusOf } from "@/lib/salary/money";
import { monthTitle } from "@/lib/salary/daily-report";
import { ACCENT, BORDER_SOFT, CARD, NAVY, SLATE } from "@/components/attendance/overview/theme";
import { PaymentStatusPill } from "./status-pill";

/** Every salary run this employee has, newest first; each row opens that month. */
export function SalaryHistoryCard({ history, current, basePath = "/my-salary" }: { history: SalaryRunRow[]; current: string; basePath?: string }) {
  return (
    <section className="rounded-xl p-6 max-md:p-4" style={CARD} aria-labelledby="hist-title">
      <h2 id="hist-title" className="flex items-center gap-2 text-[11.5px] font-bold uppercase tracking-[0.12em]" style={{ color: SLATE }}>
        <History size={14} aria-hidden style={{ color: ACCENT }} /> History
      </h2>
      {history.length === 0 ? (
        <p className="mt-4 text-[14px]" style={{ color: SLATE }}>
          No salary has been generated for you yet. Months appear here once HR generates them.
        </p>
      ) : (
        <ul className="mt-3" aria-label="Salary history">
          {history.map((r) => {
            const active = r.month === current;
            return (
              <li key={r.id} style={{ borderTop: `1px solid ${BORDER_SOFT}` }}>
                <Link
                  href={`${basePath}?month=${r.month}` as Route}
                  scroll={false}
                  aria-current={active ? "page" : undefined}
                  className="flex items-center justify-between gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-[#F6F8FB] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A6CFF]"
                  style={active ? { background: "#F3F6FA" } : undefined}
                >
                  <span className="min-w-0">
                    <span className="block text-[14px] font-semibold" style={{ color: NAVY }}>
                      {monthTitle(r.month)}
                    </span>
                    <span className="block text-[12px]" style={{ color: SLATE }}>
                      {r.fy}
                      {r.source !== "generated" ? " · imported" : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <PaymentStatusPill status={paymentStatusOf(r)} size="sm" />
                    <span className="text-[14px] font-bold tabular-nums" style={{ color: NAVY }}>
                      {inr2(r.netPayable)}
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
