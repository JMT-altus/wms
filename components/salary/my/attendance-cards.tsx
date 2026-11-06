import type { ReactNode } from "react";
import { CalendarCheck, CalendarOff, CircleSlash, Clock3, Palmtree, Sun, UserX } from "lucide-react";
import type { AttendanceCards } from "@/lib/salary/daily-report";
import { days } from "@/lib/salary/money";
import { TONE, type ToneColors } from "@/components/attendance/overview/theme";
import { BLUE_LINE, BLUE_SOFT, NAVY, SLATE, SURFACE } from "@/components/salary/ui";

/**
 * The month's attendance in the terms pay is counted in — from the grader's
 * own summary, the same one Generate Salary reads. Three headline cards
 * (worked, half days, absent) and, when they apply, leave, off days and
 * off days worked — all one size, in one row where the width allows.
 *
 * `scope` picks the wording: "me" for the employee's own month (My Salary);
 * "roster" for the administrators' Salary page, where the same cards carry the
 * whole active roster's totals (`employees` says how many) — every employee's
 * month added up, nothing averaged or estimated.
 */
export function AttendanceSummaryCards({ a, error, scope = "me", employees, subjectName }: { a: AttendanceCards | null; error?: boolean; scope?: "me" | "roster"; employees?: number; /** The admin's Employee Salary Report: name the employee instead of "your". */ subjectName?: string }) {
  if (error || !a) {
    return (
      <section className="px-4 py-3.5" style={SURFACE} aria-label="Attendance summary">
        <p className="text-[13px]" style={{ color: SLATE }}>
          Couldn&apos;t load this month&apos;s attendance. Please refresh in a moment.
        </p>
      </section>
    );
  }
  const roster = scope === "roster";
  const who = roster ? `across ${employees ?? 0} active employee${employees === 1 ? "" : "s"}` : null;
  const extras: { key: string; label: string; value: string; sub: string; tone: ToneColors; icon: ReactNode }[] = [];
  if (a.paidLeave + a.unpaidLeave > 0) {
    extras.push({
      key: "leave",
      label: "Approved leave",
      value: String(a.paidLeave + a.unpaidLeave),
      sub: `${a.paidLeave} paid · ${a.unpaidLeave} unpaid`,
      tone: TONE.orange,
      icon: <Palmtree size={16} aria-hidden />,
    });
  }
  extras.push({
    key: "off",
    label: "Holidays & weekly offs",
    value: String(a.offDays),
    sub: a.compOff > 0 ? `${a.compOff} comp-off day${a.compOff === 1 ? "" : "s"} taken` : "not counted as working days",
    tone: TONE.slate,
    icon: <CalendarOff size={16} aria-hidden />,
  });
  if (a.workedOffDays > 0) {
    extras.push({
      key: "offwork",
      label: "Worked on an off day",
      value: String(a.workedOffDays),
      sub: "counted as extra pay days",
      tone: TONE.violet,
      icon: <Sun size={16} aria-hidden />,
    });
  }
  if (a.noCheckOut > 0) {
    extras.push({
      key: "open",
      label: "No check-out",
      value: String(a.noCheckOut),
      sub: "flagged for review; not paid until resolved",
      tone: TONE.amber,
      icon: <CircleSlash size={16} aria-hidden />,
    });
  }
  return (
    <section aria-label="Attendance summary" className="grid gap-2.5" data-scope={scope}>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
        <Card
          icon={<CalendarCheck size={16} aria-hidden />}
          tone={TONE.teal}
          label="Days worked"
          value={
            <>
              {a.daysWorked} <span className="text-[14px] font-semibold" style={{ color: SLATE }}>/ {a.workingDays}</span>
            </>
          }
          sub={roster ? `full days, of the roster's working days so far` : subjectName ? "full days, of their working days so far" : "full days, of your working days so far"}
          testId="days-worked"
        />
        <Card icon={<Clock3 size={16} aria-hidden />} tone={TONE.amber} label="Half days" value={a.halfDays} sub="counted as half a day each" testId="half-days" />
        <Card icon={<UserX size={16} aria-hidden />} tone={TONE.coral} label="Absent" value={a.absent} sub="no punch, no approved leave" testId="absent" />
        {extras.map((e) => (
          <Card key={e.key} icon={e.icon} tone={e.tone} label={e.label} value={e.value} sub={e.sub} />
        ))}
      </div>
      {/* Payable days: the figure pay is counted from, on one slim line. */}
      <p className="rounded-lg px-3 py-2 text-[12.5px] tabular-nums" style={{ color: SLATE, background: BLUE_SOFT, border: `1px solid ${BLUE_LINE}` }}>
        {who ? `${who[0]!.toUpperCase()}${who.slice(1)} · payable days so far: ` : "Payable days so far: "}
        <strong className="font-semibold" style={{ color: NAVY }}>
          {days(a.payableDays)}
        </strong>
        {a.lateMarks > 0 && (
          <>
            {" "}
            · late marks: <strong className="font-semibold" style={{ color: NAVY }}>{a.lateMarks}</strong> (every third costs half a day)
          </>
        )}
      </p>
    </section>
  );
}

function Card({ icon, tone, label, value, sub, testId }: { icon: ReactNode; tone: ToneColors; label: string; value: ReactNode; sub: string; testId?: string }) {
  return (
    <div className="flex min-h-[84px] items-start gap-3 px-3.5 py-3" style={SURFACE}>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: tone.bg, color: tone.fg }}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[12px] font-semibold" style={{ color: SLATE }}>
          {label}
        </p>
        <p className="mt-0.5 text-[22px] font-bold leading-tight tabular-nums" style={{ color: tone.fg }} data-testid={testId}>
          {value}
        </p>
        <p className="text-[11.5px] leading-snug" style={{ color: SLATE }}>
          {sub}
        </p>
      </div>
    </div>
  );
}
