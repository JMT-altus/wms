"use client";

import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { STATUS_GROUP_LABEL, formatMinutes, type StatusGroup } from "@/lib/attendance/overview";
import { countsSummary, type AttendanceReport, type AttendanceReportRow, type AttendanceReportWeek } from "@/lib/attendance/weekly-report";
import { fmtDate, fmtDateRange } from "@/lib/dates";
import { BORDER_SOFT, NAVY, SLATE, TONE, type Tone } from "@/components/attendance/overview/theme";

/**
 * The Attendance Report: the month week by week, each week expandable to its
 * days, and a MONTH TOTAL at the bottom — the Salary report's layout, with
 * attendance only. The day table has exactly six columns: Date, Day, Status,
 * Check-in, Check-out, Work hours. No pay, day values or deductions.
 *
 * `manage`, when given (the admin's dashboard), lets a day open a full-width
 * row beneath it with that day's existing actions (edit punches, comp-off);
 * it adds no column.
 */

// Status colours: present green, absent red, half day orange, holiday blue, weekly off grey; working an off day reads as green.
const GROUP_TONE: Record<StatusGroup, Tone> = {
  present: "teal",
  half: "orange",
  absent: "coral",
  holiday: "blue",
  weekoff: "slate",
  offwork: "teal",
  leave: "amber",
  compoff: "rose",
  open: "amber",
};
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
export const REPORT_COLUMNS = ["Date", "Day", "Status", "Check-in", "Check-out", "Work hours"] as const;

export function AttendanceWeeklyReport({
  report,
  today,
  manage,
}: {
  report: AttendanceReport;
  today: string;
  manage?: (row: AttendanceReportRow, close: () => void) => React.ReactNode;
}) {
  const current = report.weeks.find((w) => w.start <= today && today <= w.end)?.index ?? report.weeks[report.weeks.length - 1]?.index ?? null;
  const [open, setOpen] = React.useState<Set<number>>(() => new Set(current === null ? [] : [current]));
  const [selected, setSelected] = React.useState<string | null>(null);
  const toggle = (i: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const t = report.totals;

  return (
    <section aria-label="Attendance report" className="grid gap-2">
      {report.weeks.map((w) => (
        <WeekBlock
          key={w.index}
          w={w}
          open={open.has(w.index)}
          onToggle={() => toggle(w.index)}
          manage={manage}
          selected={selected}
          onSelect={(d) => setSelected((s) => (s === d ? null : d))}
        />
      ))}

      <div
        className="mt-1 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-lg px-4 py-3 text-[13px] tabular-nums"
        style={{ background: "#F3F6FA", color: SLATE }}
        aria-label="Month total"
      >
        <span className="font-bold uppercase tracking-[0.08em]" style={{ color: NAVY }}>
          Month total
        </span>
        <span>
          Work hours <strong style={{ color: NAVY }}>{formatMinutes(t.workedMinutes)}</strong>
        </span>
        <span className="min-w-0">{countsSummary(t.counts, STATUS_GROUP_LABEL) || "No days recorded"}</span>
      </div>
    </section>
  );
}

function WeekBlock({
  w,
  open,
  onToggle,
  manage,
  selected,
  onSelect,
}: {
  w: AttendanceReportWeek;
  open: boolean;
  onToggle: () => void;
  manage?: (row: AttendanceReportRow, close: () => void) => React.ReactNode;
  selected: string | null;
  onSelect: (date: string) => void;
}) {
  const id = `attendance-week-${w.index}`;
  return (
    <div className="rounded-lg bg-white" style={{ border: `1px solid ${BORDER_SOFT}` }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-lg px-4 py-3 text-left transition-colors hover:bg-[#F6F8FB] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#0A6CFF]"
      >
        <span className="min-w-0">
          <span className="text-[13px] font-extrabold uppercase tracking-[0.06em]" style={{ color: NAVY }}>
            Week {w.index}
          </span>
          <span className="ml-3 text-[13px] tabular-nums" style={{ color: SLATE }}>
            {fmtDateRange(w.start, w.end)}
          </span>
          <span className="block text-[12px]" style={{ color: SLATE }}>
            {countsSummary(w.counts, STATUS_GROUP_LABEL) || "No days recorded"}
          </span>
        </span>
        <span className="flex items-center gap-3 text-[13px] tabular-nums" style={{ color: SLATE }}>
          <strong style={{ color: NAVY }} aria-label={`Week ${w.index} work hours`}>
            {formatMinutes(w.workedMinutes)}
          </strong>
          {open ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
        </span>
      </button>
      {open && (
        <div id={id} className="overflow-x-auto px-2 pb-2">
          <table className="w-full min-w-[520px] border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: SLATE }}>
                {REPORT_COLUMNS.map((h) => (
                  <th key={h} className={`px-2 py-1.5 ${h === "Work hours" ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {w.rows.map((r) => (
                <DayRowView key={r.date} r={r} manage={manage} isSelected={selected === r.date} onSelect={() => onSelect(r.date)} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function DayRowView({
  r,
  manage,
  isSelected,
  onSelect,
}: {
  r: AttendanceReportRow;
  manage?: (row: AttendanceReportRow, close: () => void) => React.ReactNode;
  isSelected: boolean;
  onSelect: () => void;
}) {
  const tone = r.group ? TONE[GROUP_TONE[r.group]] : null;
  // A day before joining has nothing to manage.
  const manageable = Boolean(manage && r.day && r.day.code !== "–");
  return (
    <>
      <tr
        className="tabular-nums"
        style={{ borderTop: `1px solid ${BORDER_SOFT}`, background: tone && r.group !== "present" ? tone.bg : undefined, color: NAVY }}
        aria-current={r.isToday ? "date" : undefined}
        data-status={r.group ?? (r.future ? "upcoming" : "none")}
      >
        <td className="whitespace-nowrap px-2 py-2 font-semibold">
          {manageable ? (
            <button
              type="button"
              onClick={onSelect}
              aria-expanded={isSelected}
              aria-label={`Manage ${fmtDate(r.date)}`}
              className="underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-[#0A6CFF]"
            >
              {fmtDate(r.date)}
            </button>
          ) : (
            fmtDate(r.date)
          )}
        </td>
        <td className="px-2 py-2" style={{ color: SLATE }}>
          {WEEKDAY[r.weekday]}
        </td>
        <td className="px-2 py-2">
          <span className="inline-flex flex-wrap items-center gap-1.5 font-bold" style={{ color: tone ? tone.fg : SLATE }}>
            {tone && <span aria-hidden className="inline-block rounded-full" style={{ width: 7, height: 7, background: tone.solid }} />}
            {r.label}
            {r.late && !r.lateWaived && (
              <span className="rounded-full px-1.5 text-[10.5px]" style={{ background: TONE.amber.bg, color: TONE.amber.fg }}>
                late
              </span>
            )}
            {r.leftEarly && (
              <span className="rounded-full px-1.5 text-[10.5px]" style={{ background: TONE.blue.bg, color: TONE.blue.fg }}>
                left early
              </span>
            )}
          </span>
        </td>
        <td className="px-2 py-2">{r.inAt ?? "—"}</td>
        <td className="px-2 py-2">{r.outAt ?? "—"}</td>
        <td className="px-2 py-2 text-right">{r.workedMinutes > 0 ? formatMinutes(r.workedMinutes) : "—"}</td>
      </tr>
      {manageable && isSelected && (
        <tr style={{ borderTop: `1px solid ${BORDER_SOFT}` }}>
          <td colSpan={REPORT_COLUMNS.length} className="px-2 py-2" style={{ background: "#F8FAFD" }}>
            {manage!(r, onSelect)}
          </td>
        </tr>
      )}
    </>
  );
}
