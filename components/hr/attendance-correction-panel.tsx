"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Loader2, XCircle } from "lucide-react";
import { Select } from "@/components/ui/select";
import {
  CORRECTION_REASONS,
  EXPLANATION_MAX,
  explanationError,
} from "@/lib/attendance/correction/plan";
import {
  lookupDay,
  previewCorrection,
  saveCorrection,
  type DayView,
  type PunchView,
  type ReviewView,
  type SavedCorrection,
} from "@/app/(app)/hr/attendance-correction/actions";

/**
 * HR → Attendance Correction. Pick an employee and a date, see what is stored,
 * enter the missing or corrected time(s) with a reason and an explanation, review
 * existing vs proposed, confirm, save. A blank time means "leave as it is" — this
 * panel never deletes a punch and never fills one in for you.
 */

export interface CorrectionPerson {
  id: string;
  name: string;
  email: string;
}

const CARD = "rounded-xl bg-white p-4 max-md:p-3";
const LINE = { border: "1px solid #DCE4F0" } as const;
const BTN =
  "inline-flex h-9 items-center justify-center gap-2 rounded-lg px-4 text-[13.5px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY = { background: "#0A6CFF", color: "#fff" } as const;
const MUTED = { background: "#EEF0F3", color: "#8A93A0" } as const;
const FIELD =
  "h-9 w-full rounded-lg border border-hairline-strong bg-white px-3 text-[13.5px] font-semibold text-ink-strong outline-none focus:border-[#14336b] focus:ring-2 focus:ring-[#14336b]/20";

function StepTitle({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink-strong">
      <span className="inline-flex size-6 items-center justify-center rounded-full text-[12px] font-bold" style={{ background: "#EEF4FF", color: "#0B4FB8" }}>
        {n}
      </span>
      {children}
    </h2>
  );
}

const SOURCE_LABEL: Record<string, string> = { self: "punched by the employee", admin: "entered by an admin" };

function PunchLine({ label, p }: { label: string; p: PunchView | null }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ border: "1px solid #E6ECF5", background: "#FAFCFF" }}>
      <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-subtle">{label}</p>
      {p ? (
        <>
          <p className="text-[20px] font-extrabold tabular-nums leading-tight text-ink-strong">{p.time}</p>
          <p className="text-[12px] text-ink-muted">{SOURCE_LABEL[p.source] ?? p.source}</p>
          {p.note && <p className="mt-0.5 line-clamp-2 text-[12px] text-ink-subtle" title={p.note}>Note: {p.note}</p>}
        </>
      ) : (
        <p className="text-[15px] font-bold text-ink-subtle">Not recorded</p>
      )}
    </div>
  );
}

const mins = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;

export function AttendanceCorrectionPanel({ people = [], today }: { people?: CorrectionPerson[]; today: string }) {
  const [employeeId, setEmployeeId] = React.useState("");
  const [date, setDate] = React.useState("");
  const [day, setDay] = React.useState<DayView | null>(null);
  const [inTime, setInTime] = React.useState("");
  const [outTime, setOutTime] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [explanation, setExplanation] = React.useState("");
  const [review, setReview] = React.useState<ReviewView | null>(null);
  const [confirmed, setConfirmed] = React.useState(false);
  const [busy, setBusy] = React.useState<"load" | "review" | "save" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [saved, setSaved] = React.useState<SavedCorrection | null>(null);

  const options = React.useMemo(() => people.map((p) => ({ value: p.id, label: `${p.name} · ${p.email}` })), [people]);

  function clearReview() {
    setReview(null);
    setConfirmed(false);
    setError(null);
  }

  async function load(nextEmployee: string, nextDate: string) {
    setDay(null);
    clearReview();
    setSaved(null);
    if (!nextEmployee || !nextDate) return;
    setBusy("load");
    try {
      const res = await lookupDay({ employeeId: nextEmployee, date: nextDate });
      if (res.ok) setDay(res.day);
      else setError(res.error);
    } catch {
      setError("Could not load that day. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const snapshot = day ? { in: day.punches.in?.loggedAt ?? null, out: day.punches.out?.loggedAt ?? null } : { in: null, out: null };
  const body = () => ({ employeeId, date, inTime, outTime, reason, explanation, snapshot });

  const whyNot = !day
    ? "Choose an employee and a date first."
    : !inTime && !outTime
      ? "Enter an IN time, an OUT time, or both."
      : !reason
        ? "Choose a reason."
        : explanationError(reason, explanation);

  async function doReview() {
    setBusy("review");
    setError(null);
    setConfirmed(false);
    try {
      const res = await previewCorrection(body());
      if (res.ok) setReview(res.review);
      else {
        setReview(null);
        setError(res.error);
      }
    } catch {
      setError("Could not check the correction. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function doSave() {
    setBusy("save");
    setError(null);
    try {
      const res = await saveCorrection({ ...body(), confirmed: confirmed ? true : undefined });
      if (res.ok) {
        setSaved(res.saved);
        setReview(null);
        setConfirmed(false);
        setInTime("");
        setOutTime("");
        setExplanation("");
        // Show what is stored now.
        const again = await lookupDay({ employeeId, date });
        if (again.ok) setDay(again.day);
      } else {
        setError(res.error);
      }
    } catch {
      setError("The correction could not be saved, so nothing was changed. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <section className={CARD} style={LINE} aria-labelledby="ac-pick">
        <StepTitle n={1}>
          <span id="ac-pick">Employee and date</span>
        </StepTitle>
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_200px]">
          <label className="block">
            <span className="mb-1 block text-[12px] font-bold text-ink-soft">Employee</span>
            <Select
              options={options}
              value={employeeId}
              onValueChange={(v) => {
                setEmployeeId(v);
                void load(v, date);
              }}
              placeholder="Choose employee…"
              searchPlaceholder="Search employees…"
              ariaLabel="Employee"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-[12px] font-bold text-ink-soft">Attendance date</span>
            <input
              type="date"
              className={FIELD}
              value={date}
              max={today}
              aria-label="Attendance date"
              onChange={(e) => {
                setDate(e.target.value);
                void load(employeeId, e.target.value);
              }}
            />
          </label>
        </div>
        {busy === "load" && <Loader2 size={16} className="mt-3 animate-spin text-ink-subtle" aria-label="Loading" />}
        {!day && error && (
          <p role="alert" className="mt-3 flex items-start gap-2 text-[13px] font-semibold text-[#B91C1C]">
            <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden /> {error}
          </p>
        )}

        {day && (
          <div className="mt-4">
            <p className="text-[13.5px] text-ink-strong">
              <strong>{day.employee.name}</strong> · {day.employee.email} · <span className="tabular-nums">{day.date}</span>
            </p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
              <PunchLine label="Stored IN" p={day.punches.in} />
              <PunchLine label="Stored OUT" p={day.punches.out} />
              <div className="rounded-lg px-3 py-2" style={{ border: "1px solid #E6ECF5", background: "#FAFCFF" }}>
                <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-subtle">Day code now</p>
                {day.grade ? (
                  <>
                    <p className="text-[20px] font-extrabold leading-tight text-ink-strong">{day.grade.code}</p>
                    <p className="text-[12px] text-ink-muted">
                      {mins(day.grade.workedMinutes)} worked{day.grade.late ? " · late" : ""}{day.grade.leftEarly ? " · left early" : ""}
                    </p>
                  </>
                ) : (
                  <p className="text-[15px] font-bold text-ink-subtle">—</p>
                )}
              </div>
            </div>
          </div>
        )}
      </section>

      {day && (
        <section className={CARD} style={LINE} aria-labelledby="ac-enter">
          <StepTitle n={2}>
            <span id="ac-enter">Times, reason and explanation</span>
          </StepTitle>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            Fill in only what needs adding or changing. A blank time is left exactly as it is; nothing is deleted or made up.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-4">
            <label className="block">
              <span className="mb-1 block text-[12px] font-bold text-ink-soft">IN time</span>
              <input type="time" className={FIELD} value={inTime} aria-label="IN time" onChange={(e) => { setInTime(e.target.value); clearReview(); }} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-bold text-ink-soft">OUT time</span>
              <input type="time" className={FIELD} value={outTime} aria-label="OUT time" onChange={(e) => { setOutTime(e.target.value); clearReview(); }} />
            </label>
            <label className="block sm:col-span-2">
              <span className="mb-1 block text-[12px] font-bold text-ink-soft">Reason</span>
              <select
                className={FIELD}
                value={reason}
                aria-label="Reason"
                onChange={(e) => {
                  setReason(e.target.value);
                  clearReview();
                }}
              >
                <option value="">Choose a reason…</option>
                {CORRECTION_REASONS.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="mt-3 block">
            <span className="mb-1 block text-[12px] font-bold text-ink-soft">
              Explanation (required){reason === "other" ? " — say exactly what happened" : ""}
            </span>
            <textarea
              className="min-h-[72px] w-full rounded-lg border border-hairline-strong bg-white px-3 py-2 text-[13.5px] text-ink-strong outline-none focus:border-[#14336b] focus:ring-2 focus:ring-[#14336b]/20"
              value={explanation}
              maxLength={EXPLANATION_MAX}
              aria-label="Explanation"
              placeholder="For example: Power cut 9:00–11:30, biometric machine was off; times confirmed by the supervisor."
              onChange={(e) => {
                setExplanation(e.target.value);
                clearReview();
              }}
            />
            <span className="text-[11.5px] text-ink-subtle tabular-nums">{explanation.trim().length}/{EXPLANATION_MAX}</span>
          </label>
          {error && !review && (
            <p role="alert" className="mt-2 flex items-start gap-2 text-[13px] font-semibold text-[#B91C1C]">
              <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden /> {error}
            </p>
          )}
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <button type="button" className={BTN} style={whyNot || busy ? MUTED : PRIMARY} disabled={!!whyNot || busy !== null} onClick={() => void doReview()}>
              {busy === "review" && <Loader2 size={15} className="animate-spin" aria-hidden />}
              Review changes
            </button>
            {whyNot && day && (inTime || outTime || reason || explanation) && <span className="text-[12.5px] text-ink-subtle">{whyNot}</span>}
          </div>
        </section>
      )}

      {review && (
        <section className={CARD} style={LINE} aria-labelledby="ac-review">
          <StepTitle n={3}>
            <span id="ac-review">Review and confirm</span>
          </StepTitle>
          <p className="mt-2 text-[13.5px] text-ink-strong">
            <strong>{review.employee.name}</strong> · {review.employee.email} · <span className="tabular-nums">{review.date}</span>
          </p>
          <div className="mt-2 overflow-x-auto rounded-lg" style={{ border: "1px solid #E6ECF5" }}>
            <table className="w-full min-w-[420px] border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-ink-soft" style={{ background: "#F5F7FB" }}>
                  <th className="px-3 py-1.5 font-bold" />
                  <th className="px-3 py-1.5 font-bold">Stored now</th>
                  <th className="px-3 py-1.5 font-bold">After this correction</th>
                </tr>
              </thead>
              <tbody>
                {(["in", "out"] as const).map((k) => {
                  const now = review.existing[k]?.time ?? null;
                  const after = k === "in" ? review.finalIn : review.finalOut;
                  const changed = review.changes.some((c) => c.kind === k);
                  return (
                    <tr key={k} className="border-t border-[#EEF1F6]">
                      <td className="px-3 py-1.5 font-bold">{k === "in" ? "IN" : "OUT"}</td>
                      <td className="px-3 py-1.5 tabular-nums text-ink-muted">{now ?? "Not recorded"}</td>
                      <td className="px-3 py-1.5 tabular-nums font-bold" style={{ color: changed ? "#0B4FB8" : undefined }}>
                        {after ?? "Not recorded"}
                        {!changed && after ? <span className="ml-2 text-[12px] font-semibold text-ink-subtle">(unchanged)</span> : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <ul className="mt-2 grid gap-0.5 text-[13px] font-semibold text-ink-strong">
            {review.changes.map((c) => (
              <li key={c.kind}>
                {c.action === "add" ? `Add ${c.kind.toUpperCase()} ${c.to}` : `Change ${c.kind.toUpperCase()} ${c.from} → ${c.to}`}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[13px] text-ink-muted">
            <strong className="text-ink-strong">{review.reason.label}.</strong> {review.explanation}
          </p>
          {review.keepsNotes.length > 0 && (
            <p className="mt-1 text-[12.5px] text-ink-subtle">
              The existing note on the punch is kept; your explanation is added after it: &ldquo;{review.keepsNotes.join(" · ")}&rdquo;
            </p>
          )}
          {review.warnings.map((w) => (
            <p key={w} className="mt-1 flex items-start gap-2 text-[12.5px] font-semibold text-[#B45309]">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden /> {w}
            </p>
          ))}
          {review.salaryRun && (
            <p
              role="status"
              className="mt-2 flex items-start gap-2 rounded-lg px-3 py-2 text-[12.5px] font-semibold"
              style={{ background: "#FFFBEB", border: "1px solid #FCD9A0", color: "#92400E" }}
            >
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                A salary run already exists for {review.salaryRun.month}
                {review.salaryRun.disbursed === undefined ? "" : review.salaryRun.disbursed ? " and has been disbursed" : " (not yet disbursed)"}.
                This correction will not update that salary run; payroll may need to review the difference.
              </span>
            </p>
          )}
          <p className="mt-2 text-[12px] text-ink-subtle">
            Saved as an admin entry with this reason and explanation, with the previous times kept in the audit history. No emails
            are sent from this panel.
          </p>
          <label className="mt-3 flex items-start gap-2 text-[13px] text-ink-muted">
            <input type="checkbox" className="mt-0.5 size-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I have checked these times against a reliable source, and I confirm this correction.
          </label>
          {error && (
            <p role="alert" className="mt-2 flex items-start gap-2 text-[13px] font-semibold text-[#B91C1C]">
              <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden /> {error}
            </p>
          )}
          <div className="mt-3">
            <button type="button" className={BTN} style={confirmed && busy === null ? PRIMARY : MUTED} disabled={!confirmed || busy !== null} onClick={() => void doSave()}>
              {busy === "save" && <Loader2 size={15} className="animate-spin" aria-hidden />}
              Save correction
            </button>
          </div>
        </section>
      )}

      {saved && (
        <section className={CARD} style={{ border: "1px solid #A7F3D0" }} aria-live="polite">
          <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink-strong">
            <CheckCircle2 size={18} className="text-[#059669]" aria-hidden /> Correction saved
          </h2>
          <p className="mt-1 text-[13.5px] text-ink-strong">
            <strong>{saved.employeeName}</strong> · <span className="tabular-nums">{saved.date}</span> · now IN{" "}
            <strong className="tabular-nums">{saved.in ?? "—"}</strong>, OUT <strong className="tabular-nums">{saved.out ?? "—"}</strong>
          </p>
          <ul className="mt-1 text-[13px] text-ink-muted">
            {saved.changes.map((c) => (
              <li key={c.kind}>
                {c.action === "add" ? `Added ${c.kind.toUpperCase()} ${c.to}` : `Changed ${c.kind.toUpperCase()} ${c.from} → ${c.to}`} ({saved.reason.label})
              </li>
            ))}
          </ul>
          {saved.grade && (
            <p className="mt-1 text-[13px] text-ink-muted">
              Day code now <strong className="text-ink-strong">{saved.grade.code}</strong> ({mins(saved.grade.workedMinutes)} worked). It appears in the
              attendance report and in the employee&rsquo;s attendance.
            </p>
          )}
          <p className="mt-1 text-[12.5px] text-ink-subtle">Recorded in the audit history with the previous times, the reason and your explanation.</p>
        </section>
      )}
    </div>
  );
}
