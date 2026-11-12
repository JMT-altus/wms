"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CalendarClock, Clock3, Highlighter, History, Info, Loader2, LogIn, LogOut, Plus, Trash2 } from "lucide-react";
import { MultiSelect } from "@/components/ui/multi-select";
import { DateField } from "@/components/ui/date-field";
import { fireToast } from "@/lib/toast";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { DEFAULT_HOURS_HIGHLIGHT, fromMinutes, toMinutes, type Grace, type HoursHighlight, type ShiftSettings, type WorkShift } from "@/lib/attendance/shift-settings";
import type { AttendanceSchedule } from "@/lib/attendance/schedule";
import { saveGrace, saveHoursHighlight, saveWorkShifts } from "@/app/(admin)/admin/attendance-settings/actions";

/**
 * Admin Panel → Attendance Settings (client). Three independent cards — Work
 * Shift Configuration, Check-in Grace Period, Check-out Grace Period — each
 * saved on its own with an effective date and a reason, then the scheduled
 * changes and the change history. The server decides everything (permission,
 * validation, effective-date limits); this only collects and shows.
 */

const NAVY = "#172B4D";
const SLATE = "#64748B";
const LINE = "#E3E9F2";
const FIELD =
  "h-9 w-full rounded-lg border bg-white px-2.5 text-[13.5px] font-semibold text-ink-strong outline-none focus:border-[#14336b] focus:ring-2 focus:ring-[#14336b]/20";
const LABEL = "mb-1 block text-[11.5px] font-bold uppercase tracking-[0.04em]";
const BTN = "inline-flex h-9 items-center justify-center gap-2 rounded-lg px-4 text-[13.5px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50";

interface Person {
  id: string;
  name: string;
}
interface HistoryRow {
  id: string;
  label: string;
  from: string;
  to: string;
  effectiveFrom: string;
  reason: string;
  by: string | null;
  at: string;
}

const newId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const hoursLabel = (m: number) => `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;

function Card({ icon, title, lede, children }: { icon: React.ReactNode; title: string; lede: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl bg-white p-4 max-md:p-3" style={{ border: `1px solid ${LINE}` }} aria-label={title}>
      <div className="mb-3 flex items-start gap-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg" style={{ background: "#EEF4FF", color: "#0B4FB8" }} aria-hidden>
          {icon}
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold" style={{ color: NAVY }}>
            {title}
          </h2>
          <p className="text-[12.5px]" style={{ color: SLATE }}>
            {lede}
          </p>
        </div>
      </div>
      {children}
    </section>
  );
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#0A6CFF]/25"
      style={{ background: checked ? "#0A6CFF" : "#CBD5E1" }}
    >
      <span className="inline-block size-5 rounded-full bg-white shadow transition-transform" style={{ transform: `translateX(${checked ? 22 : 2}px)` }} />
    </button>
  );
}

/** Effective date + reason + Save — the same footer on every card. */
function SaveBar({
  id,
  effectiveFrom,
  setEffectiveFrom,
  reason,
  setReason,
  minDate,
  busy,
  onSave,
}: {
  id: string;
  effectiveFrom: string;
  setEffectiveFrom: (v: string) => void;
  reason: string;
  setReason: (v: string) => void;
  minDate: string;
  busy: boolean;
  onSave: () => void;
}) {
  return (
    <div className="mt-3 grid items-end gap-2.5 border-t pt-3 sm:grid-cols-[170px_minmax(0,1fr)_auto]" style={{ borderColor: LINE }}>
      <label className="block">
        <span className={LABEL} style={{ color: SLATE }}>
          Effective from
        </span>
        <DateField className={FIELD} value={effectiveFrom} min={minDate} onChange={setEffectiveFrom} aria-label={`${id} effective from`} />
      </label>
      <label className="block">
        <span className={LABEL} style={{ color: SLATE }}>
          Reason for change
        </span>
        <input className={FIELD} style={{ borderColor: LINE }} value={reason} maxLength={500} placeholder="e.g. New store timings from next month" onChange={(e) => setReason(e.target.value)} aria-label={`${id} reason`} />
      </label>
      <button type="button" className={BTN} style={{ background: "#0A6CFF", color: "#fff" }} disabled={busy} onClick={onSave}>
        {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}
        Save changes
      </button>
    </div>
  );
}

/** Hours + minutes for a duration, kept as total minutes. */
function DurationField({ label, idPrefix, minutes, onChange }: { label: string; idPrefix: string; minutes: number; onChange: (m: number) => void }) {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const num = (v: string) => (v === "" ? 0 : Math.max(0, Math.floor(Number(v)) || 0));
  return (
    <div>
      <span className={LABEL} style={{ color: SLATE }}>
        {label}
      </span>
      <div className="flex items-center gap-1.5">
        <input type="number" min={0} max={24} className={`${FIELD} w-[70px]`} style={{ borderColor: LINE }} value={h} onChange={(e) => onChange(Math.min(24, num(e.target.value)) * 60 + m)} aria-label={`${idPrefix} hours`} />
        <span className="text-[12.5px] font-semibold" style={{ color: SLATE }}>
          h
        </span>
        <input type="number" min={0} max={59} className={`${FIELD} w-[70px]`} style={{ borderColor: LINE }} value={m} onChange={(e) => onChange(h * 60 + Math.min(59, num(e.target.value)))} aria-label={`${idPrefix} minutes`} />
        <span className="text-[12.5px] font-semibold" style={{ color: SLATE }}>
          min
        </span>
      </div>
    </div>
  );
}

export function AttendanceSettingsPanel({
  today,
  minDate,
  paidThrough,
  current,
  readError,
  legacy,
  people,
  departments,
  overrides,
  upcoming,
  history,
}: {
  today: string;
  minDate: string;
  paidThrough: string | null;
  current: ShiftSettings;
  readError: string | null;
  legacy: AttendanceSchedule;
  people: Person[];
  departments: Person[];
  overrides: { name: string; lateAfter: string | null; earlyBefore: string | null }[];
  upcoming: { label: string; effectiveFrom: string; summary: string }[];
  history: HistoryRow[];
}) {
  const router = useRouter();
  const firstDate = today > minDate ? today : minDate;
  const empOptions = React.useMemo(() => people.map((p) => ({ value: p.id, label: p.name })), [people]);
  const deptOptions = React.useMemo(() => departments.map((d) => ({ value: d.id, label: d.name })), [departments]);
  const savedIds = React.useMemo(() => new Set(current.shifts?.shifts.map((s) => s.id) ?? []), [current.shifts]);

  // ── Shifts ────────────────────────────────────────────────────────────────
  const [shifts, setShifts] = React.useState<WorkShift[]>(() => current.shifts?.shifts.map((s) => ({ ...s })) ?? []);
  const [shiftDate, setShiftDate] = React.useState(firstDate);
  const [shiftReason, setShiftReason] = React.useState("");
  // ── Grace ─────────────────────────────────────────────────────────────────
  const [inG, setInG] = React.useState<Grace>(current.checkIn ?? { enabled: false, minutes: 0 });
  const [inDate, setInDate] = React.useState(firstDate);
  const [inReason, setInReason] = React.useState("");
  const [outG, setOutG] = React.useState<Grace>(current.checkOut ?? { enabled: false, minutes: 0 });
  const [outDate, setOutDate] = React.useState(firstDate);
  const [outReason, setOutReason] = React.useState("");
  const [hl, setHl] = React.useState<HoursHighlight>(current.hoursHighlight ?? DEFAULT_HOURS_HIGHLIGHT);
  const [hlDate, setHlDate] = React.useState(firstDate);
  const [hlReason, setHlReason] = React.useState("");
  const [busy, setBusy] = React.useState<"shifts" | "in" | "out" | "hl" | null>(null);

  const patch = (id: string, p: Partial<WorkShift>) => setShifts((list) => list.map((s) => (s.id === id ? { ...s, ...p } : p.isDefault ? { ...s, isDefault: false } : s)));
  const addShift = () =>
    setShifts((list) => [
      ...list,
      { id: newId(), name: "", start: "", end: "", workingHours: 8, active: true, isDefault: list.every((s) => !s.isDefault || !s.active), employeeIds: [], departmentIds: [] },
    ]);

  async function run(which: "shifts" | "in" | "out" | "hl", call: () => Promise<{ ok: true; message: string } | { ok: false; error: string }>, reset: () => void) {
    setBusy(which);
    try {
      const res = await call();
      if (res.ok) {
        fireToast({ type: "success", message: res.message });
        reset();
        router.refresh();
      } else fireToast({ type: "error", message: res.error });
    } catch {
      fireToast({ type: "error", message: "Could not save. You may not have permission, or the connection dropped — nothing was changed." });
    } finally {
      setBusy(null);
    }
  }

  const exampleShift = shifts.find((s) => s.active && s.isDefault && s.start && s.end) ?? shifts.find((s) => s.active && s.start && s.end);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {readError && (
        <p role="alert" className="flex items-start gap-2 rounded-xl bg-white px-4 py-3 text-[13px] font-semibold text-[#B91C1C]" style={{ border: "1px solid #F5C9C6" }}>
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> {readError} Attendance is using the company times until this is corrected.
        </p>
      )}

      <p className="flex items-start gap-2 rounded-xl px-4 py-2.5 text-[12.5px]" style={{ background: "#F5F8FD", border: `1px solid ${LINE}`, color: SLATE }}>
        <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
        <span>
          Without a shift, attendance uses the company times: late after <strong className="tabular-nums">{legacy.lateAfter}</strong>, early before{" "}
          <strong className="tabular-nums">{legacy.earlyBefore}</strong>, full day <strong>{hoursLabel(legacy.fullDayMinutes)}</strong>, half day{" "}
          <strong>{hoursLabel(legacy.halfDayMinutes)}</strong>. Changes can take effect from <strong>{fmtDate(minDate)}</strong>
          {paidThrough ? ` (salary is already generated for ${paidThrough})` : " (the first day of this month)"}; earlier days keep their rules.
        </span>
      </p>

      {/* 1 — Work shifts */}
      <Card icon={<Clock3 size={17} />} title="Work Shift Configuration" lede="Shift timings and working hours. A shift applies to the employees or departments it names; the default shift applies to everyone else.">
        {shifts.length === 0 ? (
          <p className="rounded-lg px-3 py-4 text-center text-[13px]" style={{ border: `1px dashed ${LINE}`, color: SLATE }}>
            No shifts yet — attendance uses the company times above. Add a shift to start.
          </p>
        ) : (
          <div className="grid gap-2.5">
            {shifts.map((s, i) => {
              const span = s.start && s.end ? toMinutes(s.end) - toMinutes(s.start) : 0;
              return (
                <div key={s.id} className="rounded-lg p-3" style={{ border: `1px solid ${LINE}`, background: s.active ? "#FFFFFF" : "#F8FAFC" }} data-testid="shift-row">
                  <div className="grid items-end gap-2.5 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_110px_110px_110px_auto]">
                    <label className="block min-w-0">
                      <span className={LABEL} style={{ color: SLATE }}>
                        Shift name
                      </span>
                      <input className={FIELD} style={{ borderColor: LINE }} value={s.name} maxLength={60} placeholder={`Shift ${i + 1}`} onChange={(e) => patch(s.id, { name: e.target.value })} aria-label={`Shift ${i + 1} name`} />
                    </label>
                    <label className="block">
                      <span className={LABEL} style={{ color: SLATE }}>
                        Start
                      </span>
                      <input type="time" className={FIELD} style={{ borderColor: LINE }} value={s.start} onChange={(e) => patch(s.id, { start: e.target.value })} aria-label={`Shift ${i + 1} start`} />
                    </label>
                    <label className="block">
                      <span className={LABEL} style={{ color: SLATE }}>
                        End
                      </span>
                      <input type="time" className={FIELD} style={{ borderColor: LINE }} value={s.end} onChange={(e) => patch(s.id, { end: e.target.value })} aria-label={`Shift ${i + 1} end`} />
                    </label>
                    <label className="block">
                      <span className={LABEL} style={{ color: SLATE }}>
                        Working hours
                      </span>
                      <input
                        type="number"
                        min={0.25}
                        max={24}
                        step={0.25}
                        className={FIELD}
                        style={{ borderColor: LINE }}
                        value={Number.isFinite(s.workingHours) ? s.workingHours : ""}
                        onChange={(e) => patch(s.id, { workingHours: e.target.value === "" ? Number.NaN : Number(e.target.value) })}
                        aria-label={`Shift ${i + 1} working hours`}
                      />
                    </label>
                    <div className="flex h-9 items-center gap-3">
                      <span className="flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: NAVY }}>
                        <Switch checked={s.active} onChange={(v) => patch(s.id, { active: v, ...(v ? {} : { isDefault: false }) })} label={`Shift ${i + 1} active`} />
                        {s.active ? "Active" : "Inactive"}
                      </span>
                      {!savedIds.has(s.id) && (
                        <button type="button" className="grid size-8 place-items-center rounded-md hover:bg-[#FCF2F0]" style={{ color: "#C2403A" }} onClick={() => setShifts((l) => l.filter((x) => x.id !== s.id))} aria-label={`Remove shift ${i + 1}`}>
                          <Trash2 size={15} aria-hidden />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-2.5 grid items-center gap-2.5 md:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)]">
                    <label className="flex items-center gap-2 text-[12.5px] font-semibold" style={{ color: NAVY }}>
                      <input type="radio" name="default-shift" className="size-4" checked={s.isDefault} disabled={!s.active} onChange={() => patch(s.id, { isDefault: true })} aria-label={`Shift ${i + 1} is the default`} />
                      Default shift
                    </label>
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 text-[11.5px] font-bold uppercase tracking-[0.04em]" style={{ color: SLATE }}>
                        Employees
                      </span>
                      <div className="filter-chip min-w-0 flex-1" aria-label={`Shift ${i + 1} employees`}>
                        <MultiSelect options={empOptions} selected={s.employeeIds} onChange={(v) => patch(s.id, { employeeIds: v })} placeholder="None" />
                      </div>
                    </div>
                    <div className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 text-[11.5px] font-bold uppercase tracking-[0.04em]" style={{ color: SLATE }}>
                        Departments
                      </span>
                      <div className="filter-chip min-w-0 flex-1" aria-label={`Shift ${i + 1} departments`}>
                        <MultiSelect options={deptOptions} selected={s.departmentIds} onChange={(v) => patch(s.id, { departmentIds: v })} placeholder="None" />
                      </div>
                    </div>
                  </div>
                  {span > 0 && (
                    <p className="mt-2 text-[12px] tabular-nums" style={{ color: SLATE }}>
                      {s.start}–{s.end} ({hoursLabel(span)} span) · on time up to <strong style={{ color: NAVY }}>{fromMinutes(toMinutes(s.start) + (inG.enabled ? inG.minutes : 0))}</strong>
                      {" · "}leaving before <strong style={{ color: NAVY }}>{fromMinutes(toMinutes(s.end) - (outG.enabled ? outG.minutes : 0))}</strong> is early
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <button type="button" className={`${BTN} mt-2.5`} style={{ background: "#fff", color: "#0B4FB8", border: "1px solid #CFE0FA" }} onClick={addShift} disabled={shifts.length >= 20}>
          <Plus size={15} aria-hidden /> Add shift
        </button>
        <SaveBar
          id="Shifts"
          effectiveFrom={shiftDate}
          setEffectiveFrom={setShiftDate}
          reason={shiftReason}
          setReason={setShiftReason}
          minDate={minDate}
          busy={busy === "shifts"}
          onSave={() => void run("shifts", () => saveWorkShifts({ shifts, effectiveFrom: shiftDate, reason: shiftReason }), () => setShiftReason(""))}
        />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 2 — Check-in grace */}
        <Card icon={<LogIn size={17} />} title="Check-in Grace Period" lede="Minutes after the shift start that still count as on time.">
          <div className="flex flex-wrap items-end gap-4">
            <span className="flex h-9 items-center gap-2 text-[13px] font-semibold" style={{ color: NAVY }}>
              <Switch checked={inG.enabled} onChange={(v) => setInG((g) => ({ ...g, enabled: v }))} label="Check-in grace enabled" />
              {inG.enabled ? "Enabled" : "Disabled"}
            </span>
            <label className="block w-[190px]">
              <span className={LABEL} style={{ color: SLATE }}>
                Grace (minutes)
              </span>
              <input type="number" min={0} max={240} step={1} className={FIELD} style={{ borderColor: LINE }} value={inG.minutes} onChange={(e) => setInG((g) => ({ ...g, minutes: e.target.value === "" ? 0 : Number(e.target.value) }))} aria-label="Check-in grace minutes" />
            </label>
          </div>
          <p className="mt-2 text-[12px]" style={{ color: SLATE }}>
            {exampleShift
              ? `${exampleShift.name || "This shift"} starts ${exampleShift.start}: check-in up to ${fromMinutes(toMinutes(exampleShift.start) + (inG.enabled ? inG.minutes : 0))} is on time; later is late.`
              : "Applies to employees on a shift. Without shifts, the company late-after time is used."}
          </p>
          <SaveBar
            id="Check-in grace"
            effectiveFrom={inDate}
            setEffectiveFrom={setInDate}
            reason={inReason}
            setReason={setInReason}
            minDate={minDate}
            busy={busy === "in"}
            onSave={() => void run("in", () => saveGrace({ key: "check_in_grace", enabled: inG.enabled, minutes: inG.minutes, effectiveFrom: inDate, reason: inReason }), () => setInReason(""))}
          />
        </Card>

        {/* 3 — Check-out grace */}
        <Card icon={<LogOut size={17} />} title="Check-out Grace Period" lede="Minutes before the shift end that an early check-out is still accepted.">
          <div className="flex flex-wrap items-end gap-4">
            <span className="flex h-9 items-center gap-2 text-[13px] font-semibold" style={{ color: NAVY }}>
              <Switch checked={outG.enabled} onChange={(v) => setOutG((g) => ({ ...g, enabled: v }))} label="Check-out grace enabled" />
              {outG.enabled ? "Enabled" : "Disabled"}
            </span>
            <label className="block w-[190px]">
              <span className={LABEL} style={{ color: SLATE }}>
                Early window (minutes)
              </span>
              <input type="number" min={0} max={240} step={1} className={FIELD} style={{ borderColor: LINE }} value={outG.minutes} onChange={(e) => setOutG((g) => ({ ...g, minutes: e.target.value === "" ? 0 : Number(e.target.value) }))} aria-label="Check-out grace minutes" />
            </label>
          </div>
          <p className="mt-2 text-[12px]" style={{ color: SLATE }}>
            {exampleShift
              ? `${exampleShift.name || "This shift"} ends ${exampleShift.end}: check-out from ${fromMinutes(toMinutes(exampleShift.end) - (outG.enabled ? outG.minutes : 0))} is on time; earlier is "left early".`
              : "Applies to employees on a shift. Without shifts, the company early-before time is used."}{" "}
            Late check-out needs no tolerance: the attendance rules don&rsquo;t penalise staying late.
          </p>
          <SaveBar
            id="Check-out grace"
            effectiveFrom={outDate}
            setEffectiveFrom={setOutDate}
            reason={outReason}
            setReason={setOutReason}
            minDate={minDate}
            busy={busy === "out"}
            onSave={() => void run("out", () => saveGrace({ key: "check_out_grace", enabled: outG.enabled, minutes: outG.minutes, effectiveFrom: outDate, reason: outReason }), () => setOutReason(""))}
          />
        </Card>
      </div>

      {/* 4 — Daily hours highlight (display only) */}
      <Card icon={<Highlighter size={17} />} title="Daily Hours Highlight" lede="Colours days in HR → Attendance Correction by hours worked (check-out − check-in). Display only: grading and pay are unchanged.">
        <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
          <DurationField label="Yellow below" idPrefix="Short-day limit" minutes={hl.shortBelowMinutes} onChange={(m) => setHl((v) => ({ ...v, shortBelowMinutes: m }))} />
          <DurationField label="Green above" idPrefix="Long-day limit" minutes={hl.longAboveMinutes} onChange={(m) => setHl((v) => ({ ...v, longAboveMinutes: m }))} />
          <p className="pb-2 text-[12px]" style={{ color: SLATE }}>
            Between the two limits (inclusive) a day looks normal. A day with a punch missing is never coloured.
            {current.hoursHighlight ? "" : " Not saved yet — these are the starting values."}
          </p>
        </div>
        <SaveBar
          id="Hours highlight"
          effectiveFrom={hlDate}
          setEffectiveFrom={setHlDate}
          reason={hlReason}
          setReason={setHlReason}
          minDate={minDate}
          busy={busy === "hl"}
          onSave={() => void run("hl", () => saveHoursHighlight({ ...hl, effectiveFrom: hlDate, reason: hlReason }), () => setHlReason(""))}
        />
      </Card>

      {overrides.length > 0 && (
        <p className="flex items-start gap-2 rounded-xl px-4 py-2.5 text-[12.5px]" style={{ background: "#FEF8E8", border: "1px solid #F3DEA9", color: "#7A5208" }}>
          <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
          <span>
            {overrides.length} employee{overrides.length === 1 ? " has" : "s have"} personal late / early times (Admin → Employees → edit), which still apply to them over any shift:{" "}
            {overrides.map((o) => `${o.name} (${[o.lateAfter && `late after ${o.lateAfter.slice(0, 5)}`, o.earlyBefore && `early before ${o.earlyBefore.slice(0, 5)}`].filter(Boolean).join(", ")})`).join("; ")}.
          </span>
        </p>
      )}

      {upcoming.length > 0 && (
        <Card icon={<CalendarClock size={17} />} title="Scheduled changes" lede="Saved, and taking effect on the date shown.">
          <ul className="grid gap-1.5 text-[13px]">
            {upcoming.map((u, i) => (
              <li key={i} className="flex flex-wrap gap-x-2" style={{ color: NAVY }}>
                <strong className="tabular-nums">{fmtDate(u.effectiveFrom)}</strong>
                <span style={{ color: SLATE }}>{u.label}:</span> {u.summary}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card icon={<History size={17} />} title="Change history" lede="Every saved change, newest first — previous and new value, effective date, who and when.">
        {history.length === 0 ? (
          <p className="text-[13px]" style={{ color: SLATE }}>
            No changes yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
              <thead>
                <tr className="text-left text-[10.5px] font-bold uppercase tracking-[0.06em]" style={{ color: SLATE }}>
                  {["Setting", "Previous", "New", "Effective from", "Changed by", "When", "Reason"].map((h) => (
                    <th key={h} className="px-2 py-1.5">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} className="align-top" style={{ borderTop: "1px solid #EEF2F7", color: NAVY }}>
                    <td className="whitespace-nowrap px-2 py-1.5 font-semibold">{h.label}</td>
                    <td className="px-2 py-1.5" style={{ color: SLATE }}>
                      {h.from}
                    </td>
                    <td className="px-2 py-1.5">{h.to}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{fmtDate(h.effectiveFrom)}</td>
                    <td className="whitespace-nowrap px-2 py-1.5">{h.by ?? "—"}</td>
                    <td className="whitespace-nowrap px-2 py-1.5 tabular-nums">{fmtDateTime(h.at)}</td>
                    <td className="px-2 py-1.5" style={{ color: SLATE }}>
                      {h.reason}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
