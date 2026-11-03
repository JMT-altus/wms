import { ListChecks } from "lucide-react";
import type { DayRow } from "@/lib/queries/attendance-status";
import { buildAttendanceReport } from "@/lib/attendance/weekly-report";
import { formatMinutes } from "@/lib/attendance/overview";
import { fmtMonth } from "@/lib/dates";
import { AttendanceWeeklyReport } from "@/components/attendance/dashboard/attendance-weekly-report";
import { ACCENT, CARD, NAVY, SLATE } from "./theme";

/**
 * The employee's Attendance Report for the selected month, below the calendar
 * and Upcoming Holidays: a compact month summary, then the month week by week
 * (each week expands to Date · Day · Status · Check-in · Check-out · Work
 * hours), then the MONTH TOTAL.
 *
 * Built from the very days the calendar is drawn from (same load, same month,
 * same status rules), so the two always agree and follow the month selector.
 * Attendance only: no pay, day values or deductions.
 */
export function AttendanceReport({
  days,
  year,
  month,
  today,
  error,
}: {
  days: readonly DayRow[];
  year: number;
  month: number;
  today: string;
  error?: boolean;
}) {
  const report = error ? null : buildAttendanceReport(days, year, month, today);
  const c = report?.totals.counts;
  const stats: [string, string][] = report
    ? [
        ["Work hours", formatMinutes(report.totals.workedMinutes)],
        ["Present", String(c?.present ?? 0)],
        ["Half days", String(c?.half ?? 0)],
        ["Absent", String(c?.absent ?? 0)],
        ["Holidays", String(c?.holiday ?? 0)],
        ["Weekly offs", String(c?.weekoff ?? 0)],
      ]
    : [];

  return (
    <section className="rounded-xl p-6 max-md:p-4" style={CARD} aria-labelledby="attendance-report-title">
      <div className="flex flex-wrap items-center gap-3">
        <ListChecks size={20} strokeWidth={2} aria-hidden style={{ color: ACCENT }} className="shrink-0" />
        <div className="min-w-0">
          <h2 id="attendance-report-title" className="text-[18px] font-bold tracking-[-0.01em] leading-tight" style={{ color: NAVY }}>
            Attendance Report
          </h2>
          <p className="text-[13px] mt-0.5" style={{ color: SLATE }}>
            {fmtMonth(`${year}-${String(month).padStart(2, "0")}`, "long")} · week by week
          </p>
        </div>
      </div>

      {error || !report ? (
        <p className="text-[15px] py-8 text-center" style={{ color: SLATE }}>
          Couldn&apos;t load this month. Please refresh in a moment.
        </p>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6" aria-label="Month summary">
            {stats.map(([label, value]) => (
              <div key={label} className="rounded-lg px-3 py-2" style={{ background: "#F8FAFD" }}>
                <dt className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: SLATE }}>
                  {label}
                </dt>
                <dd className="mt-0.5 text-[18px] font-extrabold tabular-nums" style={{ color: NAVY }}>
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <div className="mt-4">
            <AttendanceWeeklyReport report={report} today={today} />
          </div>
        </>
      )}
    </section>
  );
}
