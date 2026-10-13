import type { ReactNode } from "react";
import {
  BarChart3,
  CalendarCheck,
  Clock,
  Gauge,
  Hourglass,
  IndianRupee,
  ShieldCheck,
} from "lucide-react";
import {
  formatDays,
  formatMinutes,
  type OverviewKpis,
} from "@/lib/attendance/overview";
import { ACCENT, BORDER, BORDER_SOFT, CARD, NAVY, SLATE, TONE, type Tone } from "./theme";

/**
 * "How am I doing?" — the six KPI figures for the selected month.
 *
 * One surface, six cells separated by thin rules: no box around each metric.
 * Presentational only — every figure arrives already computed (see
 * `computeOverview`, which states the rule behind each one). The month and year
 * controls come in as `selector`, so this stays a server component.
 */
export function AttendanceOverview({
  kpis,
  selector,
  rangeLabel,
  notStarted,
  error,
}: {
  kpis: OverviewKpis | null;
  /** The month + year dropdowns. */
  selector: ReactNode;
  /** "1 Oct – 9 Oct 2026" — the dates the figures cover. */
  rangeLabel?: string;
  /** The selected month is still in the future: nothing to report yet. */
  notStarted?: boolean;
  /** Set when the figures could not be loaded; the cards are replaced by this. */
  error?: boolean;
}) {
  return (
    <section className="rounded-xl p-6 max-md:p-4" style={CARD} aria-label="Attendance overview">
      <div className="flex items-center justify-between gap-x-4 gap-y-3 flex-wrap mb-5">
        <div className="flex items-center gap-3 min-w-0">
          <BarChart3 size={20} strokeWidth={2} aria-hidden style={{ color: ACCENT }} className="shrink-0" />
          <div className="min-w-0">
            <h2 className="text-[18px] font-bold tracking-[-0.01em] leading-tight" style={{ color: NAVY }}>
              Attendance Overview
            </h2>
            <p className="text-[13px] mt-0.5" style={{ color: SLATE }}>
              How am I doing?
              {rangeLabel && (
                <span className="ml-2 tabular-nums" style={{ color: SLATE }}>
                  · {rangeLabel}
                </span>
              )}
            </p>
          </div>
        </div>
        {selector}
      </div>

      {error || !kpis ? (
        <p className="text-[15px] py-8 text-center" style={{ color: SLATE }}>
          Couldn&apos;t load your attendance figures. Please refresh in a moment.
        </p>
      ) : (
        <>
          {notStarted && (
            <p className="mb-4 text-[13px]" style={{ color: SLATE }}>
              This month hasn&apos;t started yet — figures appear as its days pass.
            </p>
          )}
          <KpiGrid kpis={kpis} />
        </>
      )}
    </section>
  );
}

function KpiGrid({ kpis }: { kpis: OverviewKpis }) {
  const b = kpis.lostBreakdown;
  const lostParts = [
    b.absent > 0 && `${formatDays(b.absent)} absent`,
    b.unpaidLeave > 0 && `${formatDays(b.unpaidLeave)} unpaid leave`,
    b.halfDayShortfall > 0 && `${formatDays(b.halfDayShortfall)} half-day`,
    b.lateDeduction > 0 && `${formatDays(b.lateDeduction)} late`,
  ].filter(Boolean) as string[];

  const noWorkingDays = kpis.expectedDays === 0;
  const hoursFill = kpis.expectedMinutes > 0 ? kpis.workedMinutes / kpis.expectedMinutes : null;
  const daysFill = kpis.expectedDays > 0 ? kpis.effectiveDays / kpis.expectedDays : null;

  return (
    // `gap-px` over a hairline background draws the separators: the cells are
    // white, so only the gaps show, and nothing has an outline of its own.
    <div
      className="grid auto-rows-fr grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-px rounded-lg overflow-hidden"
      style={{ background: BORDER, border: `1px solid ${BORDER}` }}
    >
      <Kpi
        icon={<IndianRupee size={16} strokeWidth={2} />}
        status={kpis.lostDays > 0 ? "coral" : null}
        label="Salary Lost"
        value={`${formatDays(kpis.lostDays)} ${kpis.lostDays === 1 ? "day" : "days"}`}
        sub={lostParts.length > 0 ? lostParts.join(" · ") : "Nothing lost in this period"}
        title="Absent + unpaid-leave days + ½ per half day + the late deduction (½ day per 3 un-waived lates in the month)."
      />
      <Kpi
        icon={<Clock size={16} strokeWidth={2} />}
        status={null}
        label="Hours Worked"
        value={formatMinutes(kpis.workedMinutes)}
        sub={noWorkingDays ? "No working days yet" : `Actual ${formatMinutes(kpis.workedMinutes)} / Expected ${formatMinutes(kpis.expectedMinutes)}`}
        fill={hoursFill}
      />
      <Kpi
        icon={<Gauge size={16} strokeWidth={2} />}
        status={noWorkingDays ? null : kpis.balanceMinutes >= 0 ? "teal" : "coral"}
        label="Hours Balance"
        value={noWorkingDays ? "—" : formatMinutes(kpis.balanceMinutes, true)}
        sub={
          noWorkingDays
            ? "Not available yet"
            : kpis.balanceMinutes >= 0
              ? "Ahead of expected"
              : "Less than expected"
        }
      />
      <Kpi
        icon={<CalendarCheck size={16} strokeWidth={2} />}
        status={null}
        label="Effective Days Worked"
        value={formatDays(kpis.effectiveDays)}
        sub={noWorkingDays ? "No working days yet" : `Actual ${formatDays(kpis.effectiveDays)} / Expected ${kpis.expectedDays}`}
        fill={daysFill}
      />
      <Kpi
        icon={<Hourglass size={16} strokeWidth={2} />}
        status={kpis.halfDays > 0 ? "amber" : null}
        label="Half Days"
        value={String(kpis.halfDays)}
        sub={kpis.halfDays === 0 ? "None in this period" : "In this period"}
      />
      <Kpi
        icon={<ShieldCheck size={16} strokeWidth={2} />}
        status={null}
        label="Grace + Condoned"
        value={String(kpis.graceCondoned)}
        sub="Late or early, forgiven"
        title="Days a late arrival or early exit was forgiven because a full day was still worked."
      />
    </div>
  );
}

/**
 * One metric. `status` is set only when the figure is reporting something —
 * a loss, a deficit, a surplus, a warning — and then colours the value and
 * icon; every other metric stays navy with the neutral teal accent.
 */
function Kpi({
  icon,
  status,
  label,
  value,
  sub,
  title,
  fill,
}: {
  icon: ReactNode;
  status: Tone | null;
  label: string;
  value: string;
  sub: string;
  title?: string;
  /** 0–1 progress toward the expected figure; omitted when there is nothing to measure against. */
  fill?: number | null;
}) {
  const tone = status ? TONE[status] : null;
  return (
    <article
      title={title}
      className="att-kpi bg-white p-5 max-sm:p-4 min-w-0 flex flex-col transition-colors duration-150 hover:bg-[#F8FAFC] motion-reduce:transition-none"
    >
      <div className="flex items-center gap-2 min-w-0">
        <span aria-hidden className="shrink-0 flex" style={{ color: tone ? tone.fg : ACCENT }}>
          {icon}
        </span>
        <span className="text-[12.5px] font-semibold tracking-[0.01em] truncate" style={{ color: SLATE }}>
          {label}
        </span>
      </div>
      <div
        className="mt-3 text-[33px] max-sm:text-[30px] font-bold tabular-nums leading-none tracking-[-0.025em] break-words"
        style={{ color: tone ? tone.fg : NAVY }}
      >
        {value}
      </div>
      <div className="mt-2.5 text-[13px] leading-snug" style={{ color: SLATE }}>
        {sub}
      </div>
      {fill != null && (
        <div className="mt-auto pt-3">
          <div
            className="h-1.5 rounded-full overflow-hidden"
            style={{ background: BORDER_SOFT }}
            role="img"
            aria-label={`${Math.round(Math.min(1, fill) * 100)}% of expected`}
          >
            <div
              className="h-full rounded-full transition-[width] duration-500 motion-reduce:transition-none"
              style={{ width: `${Math.max(2, Math.min(1, fill) * 100)}%`, background: ACCENT }}
            />
          </div>
        </div>
      )}
    </article>
  );
}
