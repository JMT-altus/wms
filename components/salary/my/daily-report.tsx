"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ListChecks } from "lucide-react";
import type { DailyReport, DailyWeek } from "@/lib/salary/daily-report";
import { STATUS_GROUP_LABEL, formatMinutes, type StatusGroup } from "@/lib/attendance/overview";
import { days, inrPaise, signedPaise } from "@/lib/salary/money";
import { fmtDate, fmtDateRange } from "@/lib/dates";
import { TONE, type Tone } from "@/components/attendance/overview/theme";
import { BLUE, BLUE_LINE, BLUE_SOFT, BORDER_SOFT, CONTROL, FAINT, HEAD_BG, NAVY, SECTION_HEAD, SECTION_TITLE, SLATE, SURFACE, TH } from "@/components/salary/ui";

const GROUP_TONE: Record<StatusGroup, Tone> = {
  present: "teal",
  half: "amber",
  absent: "coral",
  holiday: "blue",
  weekoff: "slate",
  offwork: "violet",
  leave: "orange",
  compoff: "rose",
  open: "amber",
};
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const money = (p: number | null) => (p === null ? "—" : inrPaise(p));

/**
 * Day by day, week by week: status, punches, hours, the day's value in days of
 * pay and — when the month has a run — what it earned at the run's rate. The
 * weeks add up to the month, and the month adds up to the saved gross exactly
 * (late deduction and any paisa of rounding shown as their own lines).
 *
 * Hours are reported, not priced: the attendance policy defines no weekly or
 * monthly hours target and no hourly pay, so there is no "hours balance".
 */
export function DailySalaryReport({ report, hasRun, today, perDayPaise }: { report: DailyReport; hasRun: boolean; today: string; perDayPaise: number | null }) {
  const [filter, setFilter] = useState<StatusGroup | "all">("all");
  const thisWeek = report.weeks.find((w) => w.start <= today && today <= w.end)?.index ?? report.weeks[report.weeks.length - 1]?.index ?? null;
  const [open, setOpen] = useState<Set<number>>(() => new Set(thisWeek === null ? [] : [thisWeek]));
  const toggle = (i: number) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  const groupsPresent = new Set<StatusGroup>();
  for (const w of report.weeks) for (const r of w.rows) if (r.group) groupsPresent.add(r.group);
  const t = report.totals;

  return (
    <section className="overflow-hidden" style={SURFACE} aria-labelledby="dr-title">
      <div className={SECTION_HEAD}>
        <div className="min-w-0">
          <h2 id="dr-title" className={SECTION_TITLE}>
            <ListChecks size={15} aria-hidden style={{ color: BLUE }} /> Daily salary report
          </h2>
          <p className="mt-0.5 text-[12px]" style={{ color: SLATE }}>
            {perDayPaise !== null ? `${inrPaise(perDayPaise)} per day of pay · ` : ""}
            each day counts present 1, half day ½, absent 0, worked holiday 2
          </p>
        </div>
        <label className="flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: SLATE }}>
          Show
          <select value={filter} onChange={(e) => setFilter(e.target.value as StatusGroup | "all")} className={CONTROL} aria-label="Filter days by status">
            <option value="all">All statuses</option>
            {(Object.keys(STATUS_GROUP_LABEL) as StatusGroup[])
              .filter((g) => groupsPresent.has(g))
              .map((g) => (
                <option key={g} value={g}>
                  {STATUS_GROUP_LABEL[g]}
                </option>
              ))}
          </select>
        </label>
      </div>

      <div className="px-4 pb-4 pt-3">
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Hours worked" value={formatMinutes(t.workedMinutes)} hint="all punches this month" />
          <Stat label="Payable days so far" value={days(t.dayValues)} hint="sum of day values" />
          <Stat label="Earned by day" value={money(t.earnedPaise)} hint={hasRun ? "before deductions" : "no salary run for this month"} />
          <Stat
            label="Late deduction"
            value={hasRun ? (t.lateDeductionPaise !== 0 ? signedPaise(t.lateDeductionPaise) : "None") : "—"}
            hint="every third un-waived late = ½ day"
            tone={t.lateDeductionPaise !== 0 ? TONE.coral.fg : undefined}
          />
        </div>
        <p className="mt-2 text-[11.5px]" style={{ color: SLATE }}>
          No weekly or monthly hours target is set in the attendance policy, so hours are shown for information and pay follows day values.
        </p>

        <div className="mt-3 grid gap-2">
          {report.weeks.map((w) => (
            <WeekBlock key={w.index} w={w} open={open.has(w.index)} onToggle={() => toggle(w.index)} filter={filter} hasRun={hasRun} />
          ))}
        </div>

        <div
          className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-lg px-4 py-2.5 text-[13px] tabular-nums"
          style={{ background: BLUE_SOFT, border: `1px solid ${BLUE_LINE}`, color: SLATE }}
        >
          <span className="font-semibold" style={{ color: NAVY }}>
            Month total
          </span>
          <span>
            Hours <strong className="font-semibold" style={{ color: NAVY }}>{formatMinutes(t.workedMinutes)}</strong>
          </span>
          <span>
            Days <strong className="font-semibold" style={{ color: NAVY }}>{days(t.dayValues)}</strong>
          </span>
          {hasRun && (
            <>
              <span>
                Earned <strong className="font-semibold" style={{ color: NAVY }}>{money(t.earnedPaise)}</strong>
              </span>
              {t.lateDeductionPaise !== 0 && (
                <span>
                  Late <strong className="font-semibold" style={{ color: TONE.coral.fg }}>{signedPaise(t.lateDeductionPaise)}</strong>
                </span>
              )}
              {t.roundingPaise !== 0 && (
                <span>
                  Rounding <strong className="font-semibold" style={{ color: NAVY }}>{signedPaise(t.roundingPaise)}</strong>
                </span>
              )}
              <span>
                Base salary{" "}
                <strong className="font-semibold" style={{ color: NAVY }} data-testid="daily-gross">
                  {money(t.grossPaise)}
                </strong>
              </span>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: string }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: HEAD_BG, border: `1px solid ${BORDER_SOFT}` }}>
      <p className="text-[11.5px] font-semibold" style={{ color: SLATE }}>
        {label}
      </p>
      <p className="mt-0.5 text-[16px] font-bold tabular-nums" style={{ color: tone ?? NAVY }}>
        {value}
      </p>
      <p className="text-[11.5px]" style={{ color: SLATE }}>
        {hint}
      </p>
    </div>
  );
}

function WeekBlock({ w, open, onToggle, filter, hasRun }: { w: DailyWeek; open: boolean; onToggle: () => void; filter: StatusGroup | "all"; hasRun: boolean }) {
  const rows = filter === "all" ? w.rows : w.rows.filter((r) => r.group === filter);
  const summary = (Object.keys(w.counts) as (keyof typeof w.counts)[])
    .filter((k) => (w.counts[k] ?? 0) > 0)
    .map((k) => `${w.counts[k]} ${k === "upcoming" ? "upcoming" : STATUS_GROUP_LABEL[k as StatusGroup].toLowerCase()}`)
    .join(" · ");
  const id = `week-${w.index}-rows`;
  return (
    <div className="overflow-hidden rounded-lg" style={{ border: "1px solid #E2E8F0" }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3.5 py-2.5 text-left transition-colors hover:bg-[#F6F9FF] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-[#0A6CFF]/20"
        style={open ? { background: HEAD_BG } : undefined}
      >
        <span className="min-w-0">
          <span className="text-[13px] font-semibold" style={{ color: NAVY }}>
            Week {w.index}
          </span>
          <span className="ml-3 text-[12.5px] tabular-nums" style={{ color: SLATE }}>
            {fmtDateRange(w.start, w.end)}
          </span>
          <span className="block text-[11.5px]" style={{ color: SLATE }}>
            {summary}
          </span>
        </span>
        <span className="flex items-center gap-4 text-[13px] tabular-nums" style={{ color: SLATE }}>
          <span>
            <strong className="font-semibold" style={{ color: NAVY }}>{formatMinutes(w.workedMinutes)}</strong>
          </span>
          <span>
            <strong className="font-semibold" style={{ color: NAVY }}>{days(w.dayValues)}</strong> d
          </span>
          {hasRun && (
            <span className="min-w-[90px] text-right font-semibold" style={{ color: NAVY }}>
              {money(w.earnedPaise)}
            </span>
          )}
          {open ? <ChevronUp size={15} aria-hidden style={{ color: FAINT }} /> : <ChevronDown size={15} aria-hidden style={{ color: FAINT }} />}
        </span>
      </button>
      {open && (
        <div id={id} className="overflow-x-auto border-t" style={{ borderColor: "#E2E8F0" }}>
          <table className="w-full min-w-[720px] border-collapse text-[13px]">
            <thead>
              <tr>
                {["Date", "Day", "Status", "Check-in", "Check-out", "Work hours", "Day value", "Earned"].map((h, i) => (
                  <th key={h} className={`${TH} ${i >= 5 ? "!text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-3 text-center" style={{ color: SLATE }}>
                    No days with this status in this week.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const tone = r.group ? TONE[GROUP_TONE[r.group]] : null;
                return (
                  <tr key={r.date} className="tabular-nums" style={{ background: tone && r.group !== "present" ? tone.bg : undefined, color: NAVY }} aria-current={r.isToday ? "date" : undefined}>
                    <td className="px-3 py-1.5 font-medium">{fmtDate(r.date)}</td>
                    <td className="px-3 py-1.5" style={{ color: SLATE }}>
                      {WEEKDAY[r.weekday]}
                    </td>
                    <td className="px-3 py-1.5">
                      <span className="inline-flex items-center gap-1.5 font-semibold" style={{ color: tone ? tone.fg : SLATE }}>
                        {tone && <span aria-hidden className="inline-block rounded-full" style={{ width: 7, height: 7, background: tone.solid }} />}
                        {r.label}
                        {r.late && !r.lateWaived && (
                          <span className="rounded-full px-1.5 text-[10.5px]" style={{ background: TONE.amber.bg, color: TONE.amber.fg, border: "1px solid #F6DDA6" }}>
                            late
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-3 py-1.5">{r.inAt ?? "—"}</td>
                    <td className="px-3 py-1.5">{r.outAt ?? "—"}</td>
                    <td className="px-3 py-1.5 text-right">{r.workedMinutes > 0 ? formatMinutes(r.workedMinutes) : "—"}</td>
                    <td className="px-3 py-1.5 text-right">{r.future || !r.code ? "—" : days(r.dayValue)}</td>
                    <td className="px-3 py-1.5 text-right font-semibold">{r.future || !r.code || !hasRun ? "—" : money(r.earnedPaise)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
