"use client";

import * as React from "react";
import { AlertTriangle, CalendarDays, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, History, Loader2, Pencil, ShieldCheck, Undo2, UserRound, XCircle } from "lucide-react";
import { Select } from "@/components/ui/select";
import { formatMinutes, type StatusGroup } from "@/lib/attendance/overview";
import { buildAttendanceReport, type AttendanceReportRow, type AttendanceReportWeek } from "@/lib/attendance/weekly-report";
import { isEditable, monthFigures, needsCorrection, weekCounts } from "@/lib/attendance/correction/month-view";
import { shiftMonthKey } from "@/lib/salary/daily-report";
import { fmtDate, fmtDateRange, fmtDateTime, fmtMonth } from "@/lib/dates";
import { TONE, type Tone } from "@/components/attendance/overview/theme";
import type { HoursBand } from "@/lib/attendance/hours-band";
import type { WaiverRecord } from "@/lib/queries/attendance-waivers";
import { loadMonth, type MonthView, type SavedCorrection } from "@/app/(app)/hr/attendance-correction/actions";
import { AttendanceCorrectionEditor } from "@/components/hr/attendance-correction-editor";
import { ReverseWaiverDialog, WaiveDialog } from "@/components/hr/attendance-waiver-dialog";

/**
 * HR → Attendance Correction, employee-wise by month.
 *
 * Choose the employee once and the month once; the month is shown week by week
 * (the attendance report's own Monday–Sunday weeks, statuses and hours —
 * `buildAttendanceReport`, so nothing is graded here), and any day opens the
 * existing audited correction (lookup → review → confirm → save) in a dialog.
 * Days are highlighted by hours worked (display only, limits from Attendance
 * Settings), and an authorised user can waive a day or reverse a waiver. After
 * any save the month is reloaded, so the day, its week and the month totals show
 * what the attendance rules now make of it.
 */

export interface CorrectionPerson {
  id: string;
  name: string;
  email: string;
}

const NAVY = "#172B4D";
const SLATE = "#64748B";
const LINE = "#E3E9F2";
const CARD = "rounded-xl bg-white";
const ICON_BTN =
  "grid size-9 place-items-center rounded-lg border bg-white transition-colors hover:bg-[#F3F6FA] hover:text-[#0B4FB8] disabled:cursor-not-allowed disabled:opacity-35 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#0A6CFF]/20";
const ROW_BTN =
  "inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-bold transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#0A6CFF]/20";

// Subtle status colours: present green, absent light red, holiday light blue, weekly off grey, half day light orange, waived indigo.
const GROUP_TONE: Record<StatusGroup, Tone> = {
  present: "teal",
  absent: "coral",
  holiday: "blue",
  weekoff: "slate",
  half: "orange",
  offwork: "teal",
  leave: "amber",
  compoff: "rose",
  open: "amber",
  waived: "indigo",
};
// Hours highlight (display only): yellow = short day, green = long day.
export const BAND_STYLE: Record<HoursBand, { bg: string; fg: string; dot: string; label: string }> = {
  short: { bg: "#FFF4C7", fg: "#7A5600", dot: "#E0A800", label: "Short day" },
  long: { bg: "#DDF3E4", fg: "#14653A", dot: "#2E9E5B", label: "Long day" },
};
const WAIVED = TONE.indigo;
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const COLUMNS = ["Date", "Day", "Status", "Check-in", "Check-out", "Work hours", "Action"] as const;
const hm = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

interface RowCtx {
  bands: Record<string, HoursBand>;
  waiverByDate: Map<string, WaiverRecord>;
  canWaive: boolean;
  onEdit: (date: string) => void;
  onWaive: (date: string) => void;
  onReverse: (w: WaiverRecord) => void;
}

export function AttendanceCorrectionPanel({ people = [], currentMonth }: { people?: CorrectionPerson[]; currentMonth: string }) {
  const [employeeId, setEmployeeId] = React.useState("");
  const [month, setMonth] = React.useState(currentMonth);
  const [view, setView] = React.useState<MonthView | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [waiving, setWaiving] = React.useState<string | null>(null);
  const [reversing, setReversing] = React.useState<WaiverRecord | null>(null);
  const [saved, setSaved] = React.useState<SavedCorrection | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);
  const [open, setOpen] = React.useState<Set<number> | null>(null);
  const request = React.useRef(0);

  const options = React.useMemo(() => people.map((p) => ({ value: p.id, label: `${p.name} · ${p.email}` })), [people]);

  const load = React.useCallback(async (emp: string, m: string, keepOpen: boolean) => {
    const id = ++request.current;
    if (!keepOpen) {
      setView(null);
      setOpen(null);
    }
    setError(null);
    if (!emp) return;
    setLoading(true);
    try {
      const res = await loadMonth({ employeeId: emp, month: m });
      if (id !== request.current) return; // a newer choice won
      if (res.ok) setView(res.view);
      else {
        setView(null);
        setError(res.error);
      }
    } catch {
      if (id === request.current) setError("Could not load that month. Please try again.");
    } finally {
      if (id === request.current) setLoading(false);
    }
  }, []);

  const report = React.useMemo(() => {
    if (!view) return null;
    const [y, m] = view.month.split("-").map(Number) as [number, number];
    return buildAttendanceReport(view.days, y, m, view.today);
  }, [view]);
  const waiverByDate = React.useMemo(() => new Map((view?.waivers ?? []).filter((w) => !w.reversedAt).map((w) => [w.date, w])), [view]);

  // Weeks open by default: the current week, and every week with a day needing correction.
  const openWeeks =
    open ??
    new Set(
      (report?.weeks ?? [])
        .filter((w) => (view && w.start <= view.today && view.today <= w.end) || w.rows.some(needsCorrection))
        .map((w) => w.index),
    );
  const toggle = (i: number) =>
    setOpen(() => {
      const n = new Set(openWeeks);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  const clearMessages = () => {
    setSaved(null);
    setNotice(null);
  };
  const chooseMonth = (m: string) => {
    if (!/^\d{4}-\d{2}$/.test(m) || m > currentMonth || m === month) return;
    setMonth(m);
    clearMessages();
    void load(employeeId, m, false);
  };

  const fig = report ? monthFigures(report) : null;
  const bandCount = (b: HoursBand) => (view ? Object.values(view.bands).filter((x) => x === b).length : 0);
  const rowCtx: RowCtx | null = view
    ? {
        bands: view.bands,
        waiverByDate,
        canWaive: view.canWaive,
        onEdit: setEditing,
        onWaive: setWaiving,
        onReverse: setReversing,
      }
    : null;
  const afterWaiver = (msg: string) => {
    setWaiving(null);
    setReversing(null);
    setSaved(null);
    setNotice(msg);
    if (view) void load(view.employee.id, view.month, true);
  };

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      {/* Employee and month — chosen once for the whole page. */}
      <section className={`${CARD} p-3.5 max-md:p-3`} style={{ border: `1px solid ${LINE}` }} aria-label="Employee and month">
        <div className="grid items-end gap-3 md:grid-cols-[minmax(0,1fr)_auto]">
          <label className="block min-w-0">
            <span className="mb-1 flex items-center gap-1.5 text-[12px] font-bold" style={{ color: SLATE }}>
              <UserRound size={14} aria-hidden /> Employee
            </span>
            <Select
              options={options}
              value={employeeId}
              onValueChange={(v) => {
                setEmployeeId(v);
                clearMessages();
                void load(v, month, false);
              }}
              placeholder="Choose employee…"
              searchPlaceholder="Search employees…"
              ariaLabel="Employee"
            />
          </label>
          <div>
            <span className="mb-1 flex items-center gap-1.5 text-[12px] font-bold" style={{ color: SLATE }}>
              <CalendarDays size={14} aria-hidden /> Month
            </span>
            <div className="flex items-center gap-1.5">
              <button type="button" className={ICON_BTN} style={{ borderColor: LINE, color: NAVY }} aria-label="Previous month" onClick={() => chooseMonth(shiftMonthKey(month, -1))}>
                <ChevronLeft size={16} aria-hidden />
              </button>
              <input
                type="month"
                className="h-9 w-[150px] rounded-lg border bg-white px-2.5 text-[13.5px] font-semibold tabular-nums outline-none focus:border-[#14336b] focus:ring-2 focus:ring-[#14336b]/20"
                style={{ borderColor: LINE, color: NAVY }}
                value={month}
                max={currentMonth}
                aria-label="Month"
                onChange={(e) => chooseMonth(e.target.value)}
              />
              <button
                type="button"
                className={ICON_BTN}
                style={{ borderColor: LINE, color: NAVY }}
                aria-label="Next month"
                disabled={month >= currentMonth}
                onClick={() => chooseMonth(shiftMonthKey(month, 1))}
              >
                <ChevronRight size={16} aria-hidden />
              </button>
            </div>
          </div>
        </div>
      </section>

      {saved && (
        <section
          className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-[13px]"
          style={{ background: "#F0F8F4", border: "1px solid #B9E2CC", color: NAVY }}
          role="status"
          aria-live="polite"
        >
          <CheckCircle2 size={17} className="mt-0.5 shrink-0 text-[#1F7A55]" aria-hidden />
          <div className="min-w-0">
            <p className="font-bold">
              Correction saved — {saved.employeeName} · {fmtDate(saved.date)} · now IN <span className="tabular-nums">{saved.in ?? "—"}</span>, OUT{" "}
              <span className="tabular-nums">{saved.out ?? "—"}</span>
            </p>
            <p className="mt-0.5" style={{ color: SLATE }}>
              {saved.changes.map((c) => (c.action === "add" ? `Added ${c.kind.toUpperCase()} ${c.to}` : `Changed ${c.kind.toUpperCase()} ${c.from} → ${c.to}`)).join(" · ")} (
              {saved.reason.label})
              {saved.grade ? ` · status now ${saved.grade.code}, ${formatMinutes(saved.grade.workedMinutes)} worked` : ""}. Week and month totals below are
              updated; the previous times are kept in the audit history.
            </p>
          </div>
          <button type="button" className="ml-auto shrink-0 text-[12px] font-bold hover:underline" style={{ color: SLATE }} onClick={() => setSaved(null)}>
            Dismiss
          </button>
        </section>
      )}

      {notice && (
        <section className="flex items-start gap-2.5 rounded-xl px-4 py-3 text-[13px]" style={{ background: WAIVED.bg, border: "1px solid #D5D4F7", color: NAVY }} role="status" aria-live="polite">
          <ShieldCheck size={17} className="mt-0.5 shrink-0" style={{ color: WAIVED.fg }} aria-hidden />
          <p className="min-w-0 font-semibold">{notice} Week and month totals below are updated.</p>
          <button type="button" className="ml-auto shrink-0 text-[12px] font-bold hover:underline" style={{ color: SLATE }} onClick={() => setNotice(null)}>
            Dismiss
          </button>
        </section>
      )}

      {error && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-white px-4 py-3 text-[13px] font-semibold text-[#B91C1C]" style={{ border: "1px solid #F5C9C6" }}>
          <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden /> {error}
        </p>
      )}

      {!employeeId && !error && (
        <p className={`${CARD} px-4 py-8 text-center text-[13.5px]`} style={{ border: `1px dashed ${LINE}`, color: SLATE }}>
          Choose an employee to see their attendance for {fmtMonth(month, "long")}, week by week.
        </p>
      )}

      {loading && !view && (
        <p className="flex items-center justify-center gap-2 py-8 text-[13px]" style={{ color: SLATE }}>
          <Loader2 size={16} className="animate-spin" aria-hidden /> Loading attendance…
        </p>
      )}

      {view && report && fig && rowCtx && (
        <>
          <section className={`${CARD} p-3.5 max-md:p-3`} style={{ border: `1px solid ${LINE}` }} aria-label="Month summary">
            <div className="mb-2.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <h2 className="text-[14.5px] font-bold" style={{ color: NAVY }}>
                {view.employee.name}
                <span className="ml-2 text-[12.5px] font-semibold" style={{ color: SLATE }}>
                  {view.employee.email}
                </span>
              </h2>
              <span className="flex items-center gap-2 text-[12.5px] font-semibold" style={{ color: SLATE }}>
                {loading && <Loader2 size={13} className="animate-spin" aria-label="Refreshing" />}
                {fmtMonth(view.month, "long")}
              </span>
            </div>
            <dl className="grid grid-cols-5 gap-2 max-lg:grid-cols-4 max-sm:grid-cols-2">
              <Figure label="Present" value={fig.present} tone="teal" />
              <Figure label="Absent" value={fig.absent} tone="coral" />
              <Figure label="Half days" value={fig.halfDay} tone="orange" />
              <Figure label="Holidays" value={fig.holiday} tone="blue" />
              <Figure label="Weekly offs" value={fig.weeklyOff} tone="slate" />
              <Figure label="Work hours" value={formatMinutes(fig.workedMinutes)} />
              <Figure label={`Under ${hm(view.highlight.shortBelowMinutes)}`} value={bandCount("short")} band="short" hint="Days with both punches and fewer hours than the short-day limit (Attendance Settings)" />
              <Figure label={`Over ${hm(view.highlight.longAboveMinutes)}`} value={bandCount("long")} band="long" hint="Days with both punches and more hours than the long-day limit (Attendance Settings)" />
              <Figure label="Waived" value={report.totals.counts.waived ?? 0} tone={(report.totals.counts.waived ?? 0) > 0 ? "indigo" : undefined} />
              <Figure label="To correct" value={fig.needsCorrection} tone={fig.needsCorrection > 0 ? "amber" : undefined} hint="Records requiring correction: past days with a check-in or a check-out missing" />
            </dl>
            <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]" style={{ color: SLATE }} aria-label="Hours highlight legend">
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="inline-block size-3 rounded-sm" style={{ background: BAND_STYLE.short.bg, border: `1px solid ${BAND_STYLE.short.dot}` }} /> Under{" "}
                {hm(view.highlight.shortBelowMinutes)} worked
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span aria-hidden className="inline-block size-3 rounded-sm" style={{ background: BAND_STYLE.long.bg, border: `1px solid ${BAND_STYLE.long.dot}` }} /> Over{" "}
                {hm(view.highlight.longAboveMinutes)} worked
              </span>
              <span>Hours = check-out − check-in; a day with a punch missing is never highlighted. Display only — grading and pay are unchanged.</span>
            </p>
          </section>

          <section className="grid grid-cols-[minmax(0,1fr)] gap-2" aria-label="Weeks">
            {report.weeks.map((w) => (
              <Week key={w.index} w={w} open={openWeeks.has(w.index)} onToggle={() => toggle(w.index)} ctx={rowCtx} />
            ))}
          </section>

          {(view.canWaive || view.waivers.length > 0) && <WaiverHistory waivers={view.waivers} />}
        </>
      )}

      {editing && view && (
        <AttendanceCorrectionEditor
          key={`${view.employee.id}:${editing}`}
          employeeId={view.employee.id}
          date={editing}
          onClose={() => setEditing(null)}
          onSaved={(s) => {
            setEditing(null);
            setNotice(null);
            setSaved(s);
            void load(view.employee.id, view.month, true); // recalculated day, week and month
          }}
        />
      )}
      {waiving && view && <WaiveDialog key={`w:${waiving}`} employeeId={view.employee.id} date={waiving} onClose={() => setWaiving(null)} onDone={afterWaiver} />}
      {reversing && view && <ReverseWaiverDialog key={`r:${reversing.id}`} waiver={reversing} employeeName={view.employee.name} onClose={() => setReversing(null)} onDone={afterWaiver} />}
    </div>
  );
}

function Figure({ label, value, tone, band, hint }: { label: string; value: number | string; tone?: Tone; band?: HoursBand; hint?: string }) {
  const t = band ? { bg: BAND_STYLE[band].bg, fg: BAND_STYLE[band].fg } : tone ? TONE[tone] : null;
  return (
    <div className="min-w-0 rounded-lg px-3 py-2" style={{ background: t ? t.bg : "#F6F8FB", border: `1px solid ${LINE}` }} title={hint}>
      <dt className="truncate text-[10.5px] font-bold uppercase tracking-[0.03em]" style={{ color: SLATE }}>
        {label}
      </dt>
      <dd className="text-[18px] font-extrabold tabular-nums leading-tight" style={{ color: t ? t.fg : NAVY }}>
        {value}
      </dd>
    </div>
  );
}

function Week({ w, open, onToggle, ctx }: { w: AttendanceReportWeek; open: boolean; onToggle: () => void; ctx: RowCtx }) {
  const id = `ac-week-${w.index}`;
  const flagged = w.rows.filter(needsCorrection).length;
  const shortN = w.rows.filter((r) => ctx.bands[r.date] === "short").length;
  const longN = w.rows.filter((r) => ctx.bands[r.date] === "long").length;
  return (
    <div className={CARD} style={{ border: `1px solid ${LINE}` }}>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls={id}
        className="flex w-full flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-xl px-4 py-2.5 text-left transition-colors hover:bg-[#F6F8FB] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[#0A6CFF]"
      >
        <span className="min-w-0">
          <span className="text-[12.5px] font-extrabold uppercase tracking-[0.06em]" style={{ color: NAVY }}>
            Week {w.index}
          </span>
          <span className="ml-2.5 text-[12.5px] tabular-nums" style={{ color: SLATE }}>
            {fmtDateRange(w.start, w.end)}
          </span>
          <span className="mt-0.5 flex flex-wrap gap-x-2.5 text-[12px]" style={{ color: SLATE }}>
            {weekCounts(w.counts).map((c) => (
              <span key={c.key}>
                <strong className="tabular-nums" style={{ color: c.n ? NAVY : undefined }}>
                  {c.n}
                </strong>{" "}
                {c.label}
              </span>
            ))}
            {flagged > 0 && (
              <span className="font-semibold" style={{ color: TONE.amber.fg }}>
                · {flagged} to check
              </span>
            )}
            {shortN > 0 && (
              <span className="font-semibold" style={{ color: BAND_STYLE.short.fg }}>
                · {shortN} short
              </span>
            )}
            {longN > 0 && (
              <span className="font-semibold" style={{ color: BAND_STYLE.long.fg }}>
                · {longN} long
              </span>
            )}
          </span>
        </span>
        <span className="flex items-center gap-3 text-[13px] tabular-nums" style={{ color: SLATE }}>
          <strong style={{ color: NAVY }} aria-label={`Week ${w.index} work hours`}>
            {formatMinutes(w.workedMinutes)}
          </strong>
          <ChevronDown size={16} aria-hidden className="transition-transform" style={{ transform: open ? "rotate(180deg)" : undefined }} />
        </span>
      </button>
      {open && (
        <div id={id} className="overflow-x-auto px-2 pb-2">
          <table className="w-full min-w-[640px] border-collapse text-[13px]">
            <thead>
              <tr className="text-left text-[10.5px] font-bold uppercase tracking-[0.08em]" style={{ color: SLATE }}>
                {COLUMNS.map((h) => (
                  <th key={h} className={`px-2 py-1.5 ${h === "Work hours" || h === "Action" ? "text-right" : ""}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {w.rows.map((r) => (
                <Day key={r.date} r={r} ctx={ctx} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Can this day be offered for waiving? (The server decides; this only hides buttons that would be refused.) */
function offerWaive(r: AttendanceReportRow): boolean {
  if (!isEditable(r) || !r.day) return false;
  const c = r.day.code;
  if (c === "H/D" || c === "A" || c === "incomplete") return true;
  return c === "P" && ((r.late && !r.lateWaived) || r.leftEarly);
}

function Day({ r, ctx }: { r: AttendanceReportRow; ctx: RowCtx }) {
  const waived = r.code === "WV";
  const tone = r.group ? TONE[GROUP_TONE[r.group]] : null;
  const flag = needsCorrection(r);
  const editable = isEditable(r);
  const band = ctx.bands[r.date];
  const bs = band ? BAND_STYLE[band] : null;
  const waiver = ctx.waiverByDate.get(r.date);
  return (
    <tr
      className="tabular-nums"
      style={{ borderTop: `1px solid #EEF2F7`, color: NAVY, background: bs?.bg, boxShadow: waived ? `inset 3px 0 0 ${WAIVED.solid}` : undefined }}
      aria-current={r.isToday ? "date" : undefined}
      data-status={r.group ?? (r.future ? "upcoming" : "none")}
      data-hours={band ?? "normal"}
    >
      <td className="whitespace-nowrap px-2 py-1.5 font-semibold">{fmtDate(r.date)}</td>
      <td className="px-2 py-1.5" style={{ color: SLATE }}>
        {WEEKDAY[r.weekday]}
      </td>
      <td className="px-2 py-1.5">
        <span
          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11.5px] font-bold ${waived ? "uppercase tracking-[0.04em]" : ""}`}
          style={tone ? { background: waived ? "#E2E1FB" : tone.bg, color: tone.fg } : { background: "#F6F8FB", color: SLATE }}
          title={waiver ? `Waived by ${waiver.waivedBy ?? "—"} on ${fmtDateTime(waiver.waivedAt)}: ${waiver.reason}` : undefined}
        >
          {tone && <span aria-hidden className="inline-block rounded-full" style={{ width: 6, height: 6, background: tone.solid }} />}
          {r.label}
          {r.late && !r.lateWaived && <span className="font-semibold opacity-80">· late</span>}
          {r.leftEarly && <span className="font-semibold opacity-80">· left early</span>}
        </span>
        {waived && waiver && (
          <span className="mt-0.5 block max-w-[220px] truncate text-[11px]" style={{ color: WAIVED.fg }} title={`${waiver.reason}`}>
            by {waiver.waivedBy ?? "—"} · {fmtDate(waiver.waivedAt)}
          </span>
        )}
      </td>
      <td className="px-2 py-1.5">{r.inAt ?? <Missing show={flag && !r.inAt} />}</td>
      <td className="px-2 py-1.5">{r.outAt ?? <Missing show={flag && !r.outAt} />}</td>
      <td className="px-2 py-1.5 text-right" style={bs ? { color: bs.fg, fontWeight: 800 } : undefined} title={bs ? bs.label : undefined}>
        {r.workedMinutes > 0 ? formatMinutes(r.workedMinutes) : "—"}
      </td>
      <td className="px-2 py-1 text-right">
        <span className="inline-flex flex-wrap justify-end gap-1">
          {editable ? (
            <button
              type="button"
              onClick={() => ctx.onEdit(r.date)}
              aria-label={`Edit ${fmtDate(r.date)}`}
              className={`${ROW_BTN} bg-white hover:bg-[#EEF4FF]`}
              style={{ color: flag ? TONE.amber.fg : "#0B4FB8", border: `1px solid ${flag ? "#F0D9A8" : "#D6E3F7"}` }}
            >
              <Pencil size={12} aria-hidden /> Edit
            </button>
          ) : (
            <span className="text-[12px]" style={{ color: "#A0AABB" }}>
              —
            </span>
          )}
          {ctx.canWaive && waived && waiver && (
            <button type="button" onClick={() => ctx.onReverse(waiver)} aria-label={`Reverse waiver ${fmtDate(r.date)}`} className={`${ROW_BTN} bg-white hover:bg-[#F3F2FE]`} style={{ color: WAIVED.fg, border: "1px solid #D5D4F7" }}>
              <Undo2 size={12} aria-hidden /> Reverse
            </button>
          )}
          {ctx.canWaive && !waived && offerWaive(r) && (
            <button type="button" onClick={() => ctx.onWaive(r.date)} aria-label={`Waive ${fmtDate(r.date)}`} className={`${ROW_BTN} bg-white hover:bg-[#F3F2FE]`} style={{ color: WAIVED.fg, border: "1px solid #D5D4F7" }}>
              <ShieldCheck size={12} aria-hidden /> Waive
            </button>
          )}
        </span>
      </td>
    </tr>
  );
}

function Missing({ show }: { show: boolean }) {
  return show ? (
    <span className="inline-flex items-center gap-1 text-[12px] font-semibold" style={{ color: TONE.amber.fg }}>
      <AlertTriangle size={12} aria-hidden /> missing
    </span>
  ) : (
    <>—</>
  );
}

function WaiverHistory({ waivers }: { waivers: WaiverRecord[] }) {
  return (
    <section className={`${CARD} p-3.5 max-md:p-3`} style={{ border: `1px solid ${LINE}` }} aria-label="Waiver history">
      <h2 className="flex items-center gap-2 text-[14px] font-bold" style={{ color: NAVY }}>
        <History size={15} aria-hidden style={{ color: WAIVED.fg }} /> Waiver history
      </h2>
      <p className="text-[12px]" style={{ color: SLATE }}>
        Every waiver this month — active and reversed — with who, when and why. A waived day counts as one paid day with no late or early mark; the recorded
        punches are never changed.
      </p>
      {waivers.length === 0 ? (
        <p className="mt-2 text-[12.5px]" style={{ color: SLATE }}>
          No waivers this month.
        </p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
            <thead>
              <tr className="text-left text-[10.5px] font-bold uppercase tracking-[0.06em]" style={{ color: SLATE }}>
                {["Date", "Status", "Waived by", "Reason", "Reversed by", "Reversal reason"].map((h) => (
                  <th key={h} className="px-2 py-1.5">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {waivers.map((w) => (
                <tr key={w.id} className="align-top" style={{ borderTop: "1px solid #EEF2F7", color: NAVY }}>
                  <td className="whitespace-nowrap px-2 py-1.5 font-semibold tabular-nums">{fmtDate(w.date)}</td>
                  <td className="px-2 py-1.5">
                    <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={w.reversedAt ? { background: "#F3F5F8", color: SLATE } : { background: "#E2E1FB", color: WAIVED.fg }}>
                      {w.reversedAt ? "Reversed" : "Active"}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {w.waivedBy ?? "—"}
                    <span className="block text-[11px] tabular-nums" style={{ color: SLATE }}>
                      {fmtDateTime(w.waivedAt)}
                    </span>
                  </td>
                  <td className="px-2 py-1.5">{w.reason}</td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    {w.reversedAt ? (
                      <>
                        {w.reversedBy ?? "—"}
                        <span className="block text-[11px] tabular-nums" style={{ color: SLATE }}>
                          {fmtDateTime(w.reversedAt)}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-2 py-1.5" style={{ color: SLATE }}>
                    {w.reverseReason ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
