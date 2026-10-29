import type { ReactNode } from "react";
import { CalendarCheck, CalendarOff, CircleSlash, Clock3, Palmtree, Sun, UserX } from "lucide-react";
import type { AttendanceCards } from "@/lib/salary/daily-report";
import { days } from "@/lib/salary/money";
import { CARD, NAVY, SLATE, TONE, type ToneColors } from "@/components/attendance/overview/theme";

/**
 * The month's attendance in the terms pay is counted in — from the grader's
 * own summary, the same one Generate Salary reads. Three headline cards
 * (worked, half days, absent) and, when they apply, leave, off days and
 * off days worked.
 *
 * `scope` picks the wording: "me" for the employee's own month (My Salary);
 * "roster" for the administrators' Salary page, where the same cards carry the
 * whole active roster's totals (`employees` says how many) — every employee's
 * month added up, nothing averaged or estimated.
 */
export function AttendanceSummaryCards({ a, error, scope = "me", employees }: { a: AttendanceCards | null; error?: boolean; scope?: "me" | "roster"; employees?: number }) {
  if (error || !a) {
    return (
      <section className="rounded-xl p-6 max-md:p-4" style={CARD} aria-label="Attendance summary">
        <p className="text-[14px]" style={{ color: SLATE }}>
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
      icon: <Palmtree size={18} aria-hidden />,
    });
  }
  extras.push({
    key: "off",
    label: "Holidays & weekly offs",
    value: String(a.offDays),
    sub: a.compOff > 0 ? `${a.compOff} comp-off day${a.compOff === 1 ? "" : "s"} taken` : "not counted as working days",
    tone: TONE.slate,
    icon: <CalendarOff size={18} aria-hidden />,
  });
  if (a.workedOffDays > 0) {
    extras.push({
      key: "offwork",
      label: "Worked on an off day",
      value: String(a.workedOffDays),
      sub: "counted as extra pay days",
      tone: TONE.violet,
      icon: <Sun size={18} aria-hidden />,
    });
  }
  if (a.noCheckOut > 0) {
    extras.push({
      key: "open",
      label: "No check-out",
      value: String(a.noCheckOut),
      sub: "flagged for review; not paid until resolved",
      tone: TONE.amber,
      icon: <CircleSlash size={18} aria-hidden />,
    });
  }
  return (
    <section aria-label="Attendance summary" className="grid gap-4" data-scope={scope}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card
          icon={<CalendarCheck size={18} aria-hidden />}
          tone={TONE.teal}
          label="Days worked"
          value={
            <>
              {a.daysWorked} <span className="text-[18px] font-bold" style={{ color: SLATE }}>/ {a.workingDays}</span>
            </>
          }
          sub={roster ? `full days, of the roster's working days so far` : "full days, of your working days so far"}
          testId="days-worked"
        />
        <Card icon={<Clock3 size={18} aria-hidden />} tone={TONE.amber} label="Half days" value={a.halfDays} sub="counted as half a day each" testId="half-days" />
        <Card icon={<UserX size={18} aria-hidden />} tone={TONE.coral} label="Absent" value={a.absent} sub="no punch, no approved leave" testId="absent" />
      </div>
      {extras.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {extras.map((e) => (
            <Card key={e.key} icon={e.icon} tone={e.tone} label={e.label} value={e.value} sub={e.sub} compact />
          ))}
        </div>
      )}
      <p className="text-[12.5px] tabular-nums" style={{ color: SLATE }}>
        {who ? `${who[0]!.toUpperCase()}${who.slice(1)} · payable days so far: ` : "Payable days so far: "}
        <strong style={{ color: NAVY }}>{days(a.payableDays)}</strong>
        {a.lateMarks > 0 && (
          <>
            {" "}
            · late marks: <strong style={{ color: NAVY }}>{a.lateMarks}</strong> (every third costs half a day)
          </>
        )}
      </p>
    </section>
  );
}

function Card({ icon, tone, label, value, sub, compact, testId }: { icon: ReactNode; tone: ToneColors; label: string; value: ReactNode; sub: string; compact?: boolean; testId?: string }) {
  return (
    <div className={`flex items-start gap-3 rounded-xl ${compact ? "p-4" : "p-5"}`} style={CARD}>
      <span className="grid size-10 shrink-0 place-items-center rounded-full" style={{ background: tone.bg, color: tone.fg }}>
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[11.5px] font-bold uppercase tracking-[0.1em]" style={{ color: SLATE }}>
          {label}
        </p>
        <p className={`${compact ? "text-[22px]" : "text-[30px]"} font-extrabold leading-tight tabular-nums`} style={{ color: tone.fg }} data-testid={testId}>
          {value}
        </p>
        <p className="text-[12.5px]" style={{ color: SLATE }}>
          {sub}
        </p>
      </div>
    </div>
  );
}
