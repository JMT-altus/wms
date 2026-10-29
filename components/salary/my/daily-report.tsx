"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, ListChecks } from "lucide-react";
import type { DailyReport, DailyWeek } from "@/lib/salary/daily-report";
import { STATUS_GROUP_LABEL, formatMinutes, type StatusGroup } from "@/lib/attendance/overview";
import { days, inrPaise, signedPaise } from "@/lib/salary/money";
import { ACCENT, BORDER_SOFT, CARD, NAVY, SLATE, TONE, type Tone } from "@/components/attendance/overview/theme";

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
const DATE_FMT = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
const fmtDate = (ymd: string) => DATE_FMT.format(new Date(`${ymd}T12:00:00Z`)).replace(/ /g, "-");
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
    <section className="rounded-xl p-6 max-md:p-4" style={CARD} aria-labelledby="dr-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="dr-title" className="flex items-center gap-2 text-[11.5px] font-bold uppercase tracking-[0.12em]" style={{ color: SLATE }}>
            <ListChecks size={14} aria-hidden style={{ color: ACCENT }} /> Daily salary report
          </h2>
          <p className="mt-1 text-[12.5px]" style={{ color: SLATE }}>
            {perDayPaise !== null ? `${inrPaise(perDayPaise)} per day of pay · ` : ""}
            each day counts present 1, half day ½, absent 0, worked holiday 2
          </p>
        </div>
        <label className="text-[12.5px] font-semibold" style={{ color: SLATE }}>
          Show{" "}
          <select
            value={filter}
            onChange={(e) => setFilter(e.target.value as StatusGroup | "all")}
            className="ml-1 h-8 rounded-md bg-white px-2 text-[13px] font-semibold"
            style={{ border: `1px solid ${BORDER_SOFT}`, color: NAVY }}
            aria-label="Filter days by status"
          >
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

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
      <p className="mt-2 text-[12px]" style={{ color: SLATE }}>
        No weekly or monthly hours target is set in the attendance policy, so hours are shown for information and pay follows day values.
      </p>

      <div className="mt-4 grid gap-2">
        {report.weeks.map((w) => (
          <WeekBlock key={w.index} w={w} open={open.has(w.index)} onToggle={() => toggle(w.index)} filter={filter} hasRun={hasRun} />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-x-6 gap-y-1 rounded-lg px-4 py-3 text-[13px] tabular-nums" style={{ background: "#F3F6FA", color: SLATE }}>
        <span className="font-bold uppercase tracking-[0.08em]" style={{ color: NAVY }}>
          Month total
        </span>
        <span>
          Hours <strong style={{ color: NAVY }}>{formatMinutes(t.workedMinutes)}</strong>
        </span>
        <span>
          Days <strong style={{ color: NAVY }}>{days(t.dayValues)}</strong>
        </span>
        {hasRun && (
          <>
            <span>
              Earned <strong style={{ color: NAVY }}>{money(t.earnedPaise)}</strong>
            </span>
            {t.lateDeductionPaise !== 0 && (
              <span>
                Late <strong style={{ color: TONE.coral.fg }}>{signedPaise(t.lateDeductionPaise)}</strong>
              </span>
            )}
            {t.roundingPaise !== 0 && (
              <span>
                Rounding <strong style={{ color: NAVY }}>{signedPaise(t.roundingPaise)}</strong>
              </span>
            )}
            <span>
              Base salary <strong style={{ color: NAVY }} data-testid="daily-gross">{money(t.grossPaise)}</strong>
            </span>
          </>
        )}
      </div>
    </section>
  );
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint: string; tone?: string }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ background: "#F8FAFD" }}>
      <p className="text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: SLATE }}>
        {label}
      </p>
      <p className="mt-0.5 text-[18px] font-extrabold tabular-nums" style={{ color: tone ?? NAVY }}>
        {value}
      </p>
      <p className="text-[12px]" style={{ color: SLATE }}>
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
    <div className="rounded-lg" style={{ border: `1px solid ${BORDER_SOFT}` }}>
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
            {fmtDate(w.start)} – {fmtDate(w.end)}
          </span>
          <span className="block text-[12px]" style={{ color: SLATE }}>
            {summary}
          </span>
        </span>
        <span className="flex items-center gap-4 text-[13px] tabular-nums" style={{ color: SLATE }}>
          <span>
            <strong style={{ color: NAVY }}>{formatMinutes(w.workedMinutes)}</strong>
          </span>
          <span>
            <strong style={{ color: NAVY }}>{days(w.dayValues)}</strong> d
          </span>
          {hasRun && (
            <span className="font-bold" style={{ color: NAVY }}>
              {money(w.earnedPaise)}
            </span>
          )}
          {open ? <ChevronUp size={16} aria-hidden /> : <ChevronDown size={16} aria-hidden />}
        </span>
      </button>
      {open && (
        <div id={id} className="overflow-x-auto px-2 pb-2">
          <table className="w-full min-w-[720px] border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-[11px] font-bold uppercase tracking-[0.08em]" style={{ color: SLATE }}>
                {["Date", "Day", "Status", "Check-in", "Check-out", "Work hours", "Day value", "Earned"].map((h, i) => (
                  <th key={h} className={`px-2 py-1.5 ${i >= 5 ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-2 py-3 text-center" style={{ color: SLATE }}>
                    No days with this status in this week.
                  </td>
                </tr>
              )}
              {rows.map((r) => {
                const tone = r.group ? TONE[GROUP_TONE[r.group]] : null;
                return (
                  <tr key={r.date} className="tabular-nums" style={{ borderTop: `1px solid ${BORDER_SOFT}`, background: tone && r.group !== "present" ? tone.bg : undefined, color: NAVY }} aria-current={r.isToday ? "date" : undefined}>
                    <td className="px-2 py-2 font-semibold">{fmtDate(r.date)}</td>
                    <td className="px-2 py-2" style={{ color: SLATE }}>
                      {WEEKDAY[r.weekday]}
                    </td>
                    <td className="px-2 py-2">
                      <span className="inline-flex items-center gap-1.5 font-bold" style={{ color: tone ? tone.fg : SLATE }}>
                        {tone && <span aria-hidden className="inline-block rounded-full" style={{ width: 7, height: 7, background: tone.solid }} />}
                        {r.label}
                        {r.late && !r.lateWaived && (
                          <span className="rounded-full px-1.5 text-[10.5px]" style={{ background: TONE.amber.bg, color: TONE.amber.fg }}>
                            late
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-2 py-2">{r.inAt ?? "—"}</td>
                    <td className="px-2 py-2">{r.outAt ?? "—"}</td>
                    <td className="px-2 py-2 text-right">{r.workedMinutes > 0 ? formatMinutes(r.workedMinutes) : "—"}</td>
                    <td className="px-2 py-2 text-right">{r.future || !r.code ? "—" : days(r.dayValue)}</td>
                    <td className="px-2 py-2 text-right font-semibold">{r.future || !r.code || !hasRun ? "—" : money(r.earnedPaise)}</td>
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
