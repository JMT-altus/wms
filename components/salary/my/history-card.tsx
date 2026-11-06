import Link from "next/link";
import type { Route } from "next";
import { ChevronRight, History } from "lucide-react";
import type { SalaryRunRow } from "@/lib/queries/salary";
import { inr2, paymentStatusOf } from "@/lib/salary/money";
import { monthTitle } from "@/lib/salary/daily-report";
import { BLUE, BLUE_SOFT, BORDER_SOFT, FAINT, NAVY, SECTION_HEAD, SECTION_TITLE, SLATE, SURFACE } from "@/components/salary/ui";
import { PaymentStatusPill } from "./status-pill";

/** Every salary run this employee has, newest first; each row opens that month. */
export function SalaryHistoryCard({ history, current, basePath = "/my-salary", subjectName }: { history: SalaryRunRow[]; current: string; basePath?: string; /** The admin's Employee Salary Report: name the employee instead of "you". */ subjectName?: string }) {
  return (
    <section className="overflow-hidden" style={SURFACE} aria-labelledby="hist-title">
      <div className={SECTION_HEAD}>
        <h2 id="hist-title" className={SECTION_TITLE}>
          <History size={15} aria-hidden style={{ color: BLUE }} /> History
        </h2>
      </div>
      {history.length === 0 ? (
        <p className="px-4 py-3.5 text-[13px]" style={{ color: SLATE }}>
          {subjectName ? `No salary has been generated for ${subjectName} yet.` : "No salary has been generated for you yet."} Months appear here once HR generates them.
        </p>
      ) : (
        <ul aria-label="Salary history">
          {history.map((r, i) => {
            const active = r.month === current;
            return (
              <li key={r.id} style={i > 0 ? { borderTop: `1px solid ${BORDER_SOFT}` } : undefined}>
                <Link
                  href={`${basePath}?month=${r.month}` as Route}
                  scroll={false}
                  aria-current={active ? "page" : undefined}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 transition-colors hover:bg-[#F6F9FF] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-[#0A6CFF]/20"
                  style={active ? { background: BLUE_SOFT, boxShadow: `inset 3px 0 0 ${BLUE}` } : undefined}
                >
                  <span className="min-w-0">
                    <span className="block text-[13.5px] font-semibold" style={{ color: NAVY }}>
                      {monthTitle(r.month)}
                    </span>
                    <span className="block text-[11.5px]" style={{ color: SLATE }}>
                      {r.fy}
                      {r.source !== "generated" ? " · imported" : ""}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <PaymentStatusPill status={paymentStatusOf(r)} size="sm" />
                    <span className="min-w-[96px] text-right text-[13.5px] font-semibold tabular-nums" style={{ color: NAVY }}>
                      {inr2(r.netPayable)}
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
