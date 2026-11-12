"use client";

import * as React from "react";
import { AlertTriangle, Loader2, XCircle } from "lucide-react";
import { CenterDialog } from "@/components/ui/center-dialog";
import { CORRECTION_REASONS, EXPLANATION_MAX, explanationError } from "@/lib/attendance/correction/plan";
import { formatMinutes } from "@/lib/attendance/overview";
import { fmtDateWithWeekday } from "@/lib/dates";
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
 * Attendance Correction — the editor for ONE day, opened from the month view.
 *
 * Same flow and the same server actions as before: it reads what is stored
 * (`lookupDay`), lets HR enter the missing or corrected time(s) with a reason and
 * an explanation, shows stored-vs-corrected (`previewCorrection`, a dry run), and
 * saves only after the explicit confirmation (`saveCorrection`: punch write +
 * audit row in one transaction, refused if the day changed meanwhile). A blank
 * time is left exactly as it is — nothing is deleted or made up.
 */

const FIELD =
  "h-9 w-full rounded-lg border border-hairline-strong bg-white px-3 text-[13.5px] font-semibold text-ink-strong outline-none focus:border-[#14336b] focus:ring-2 focus:ring-[#14336b]/20";
const BTN =
  "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-[13.5px] font-bold max-sm:px-2.5 max-sm:text-[12.5px] transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY = { background: "#0A6CFF", color: "#fff" } as const;
const MUTED = { background: "#EEF0F3", color: "#8A93A0" } as const;
const GHOST = { background: "#fff", color: "#172B4D", border: "1px solid #DCE4F0" } as const;
const SOURCE_LABEL: Record<string, string> = { self: "punched by the employee", admin: "entered by an admin" };

function Original({ p }: { p: PunchView | null }) {
  return p ? (
    <div className="min-w-0">
      <p className="text-[16px] font-extrabold tabular-nums leading-tight text-ink-strong">{p.time}</p>
      <p className="text-[11.5px] text-ink-muted">{SOURCE_LABEL[p.source] ?? p.source}</p>
      {p.note && (
        <p className="line-clamp-1 text-[11.5px] text-ink-subtle" title={p.note}>
          Note: {p.note}
        </p>
      )}
    </div>
  ) : (
    <p className="text-[13.5px] font-bold text-ink-subtle">Not recorded</p>
  );
}

export function AttendanceCorrectionEditor({
  employeeId,
  date,
  onClose,
  onSaved,
}: {
  employeeId: string;
  date: string;
  onClose: () => void;
  onSaved: (saved: SavedCorrection) => void;
}) {
  const [day, setDay] = React.useState<DayView | null>(null);
  const [inTime, setInTime] = React.useState("");
  const [outTime, setOutTime] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [explanation, setExplanation] = React.useState("");
  const [review, setReview] = React.useState<ReviewView | null>(null);
  const [confirmed, setConfirmed] = React.useState(false);
  const [busy, setBusy] = React.useState<"load" | "review" | "save" | null>("load");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    lookupDay({ employeeId, date })
      .then((res) => {
        if (!live) return;
        if (res.ok) setDay(res.day);
        else setError(res.error);
      })
      .catch(() => live && setError("Could not load that day. Please try again."))
      .finally(() => live && setBusy(null));
    return () => {
      live = false;
    };
  }, [employeeId, date]);

  const clearReview = () => {
    setReview(null);
    setConfirmed(false);
    setError(null);
  };
  const snapshot = day ? { in: day.punches.in?.loggedAt ?? null, out: day.punches.out?.loggedAt ?? null } : { in: null, out: null };
  const body = () => ({ employeeId, date, inTime, outTime, reason, explanation, snapshot });
  const whyNot = !day
    ? "Loading the stored times…"
    : !inTime && !outTime
      ? "Enter a corrected check-in, check-out, or both."
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
      if (res.ok) onSaved(res.saved);
      else setError(res.error);
    } catch {
      setError("The correction could not be saved, so nothing was changed. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const grade = day?.grade ?? null;
  const subtitle = `${day?.employee.name ?? "…"} · ${fmtDateWithWeekday(date, "long")}`;

  return (
    <CenterDialog
      open
      title="Edit attendance"
      subtitle={subtitle}
      onClose={onClose}
      width={640}
      accentBar="linear-gradient(90deg, #0A6CFF 0%, #14336B 100%)"
      footer={
        <>
          <button type="button" className={BTN} style={GHOST} onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className={BTN}
            style={whyNot || busy ? MUTED : review ? GHOST : PRIMARY}
            disabled={!!whyNot || busy !== null}
            onClick={() => void doReview()}
          >
            {busy === "review" && <Loader2 size={15} className="animate-spin" aria-hidden />}
            Review changes
          </button>
          <button
            type="button"
            className={BTN}
            style={review && confirmed && busy === null ? PRIMARY : MUTED}
            disabled={!review || !confirmed || busy !== null}
            onClick={() => void doSave()}
          >
            {busy === "save" && <Loader2 size={15} className="animate-spin" aria-hidden />}
            Save correction
          </button>
        </>
      }
    >
      {busy === "load" && (
        <p className="flex items-center gap-2 text-[13px] text-ink-subtle">
          <Loader2 size={15} className="animate-spin" aria-hidden /> Loading the stored times…
        </p>
      )}

      {day && (
        <div className="grid gap-4">
          {/* Original (stored) next to Corrected (what HR enters). */}
          <div className="overflow-x-auto rounded-lg" style={{ border: "1px solid #E6ECF5" }}>
            <table className="w-full min-w-[300px] border-collapse text-[13px]">
              <thead>
                <tr className="text-left text-[11px] font-bold uppercase tracking-[0.06em] text-ink-subtle" style={{ background: "#F5F7FB" }}>
                  <th className="w-[84px] px-3 py-2 max-sm:px-2 sm:w-[110px]" />
                  <th className="px-3 py-2">Original (stored)</th>
                  <th className="px-3 py-2" style={{ color: "#0B4FB8" }}>
                    Corrected
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-t border-[#EEF1F6] align-top">
                  <th scope="row" className="px-3 py-2.5 text-left font-bold text-ink-soft max-sm:px-2">
                    Check-in
                  </th>
                  <td className="px-3 py-2.5 max-sm:px-2">
                    <Original p={day.punches.in} />
                  </td>
                  <td className="px-3 py-2.5 max-sm:px-2">
                    <input
                      type="time"
                      className={FIELD}
                      value={inTime}
                      aria-label="Corrected check-in"
                      onChange={(e) => {
                        setInTime(e.target.value);
                        clearReview();
                      }}
                    />
                  </td>
                </tr>
                <tr className="border-t border-[#EEF1F6] align-top">
                  <th scope="row" className="px-3 py-2.5 text-left font-bold text-ink-soft max-sm:px-2">
                    Check-out
                  </th>
                  <td className="px-3 py-2.5 max-sm:px-2">
                    <Original p={day.punches.out} />
                  </td>
                  <td className="px-3 py-2.5 max-sm:px-2">
                    <input
                      type="time"
                      className={FIELD}
                      value={outTime}
                      aria-label="Corrected check-out"
                      onChange={(e) => {
                        setOutTime(e.target.value);
                        clearReview();
                      }}
                    />
                  </td>
                </tr>
                <tr className="border-t border-[#EEF1F6]">
                  <th scope="row" className="px-3 py-2.5 text-left font-bold text-ink-soft max-sm:px-2">
                    Work hours
                  </th>
                  <td className="px-3 py-2.5 tabular-nums">
                    {grade ? (
                      <>
                        <strong className="text-ink-strong">{day.punches.in && day.punches.out ? formatMinutes(grade.workedMinutes) : "—"}</strong>
                        <span className="ml-2 text-[12px] text-ink-muted">
                          status {grade.code}
                          {grade.late ? " · late" : ""}
                          {grade.leftEarly ? " · left early" : ""}
                        </span>
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-3 py-2.5 text-[12px] text-ink-muted">Recalculated by the attendance rules after saving</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="-mt-2 text-[12px] text-ink-muted">Fill in only what needs adding or changing. A blank time is left exactly as it is.</p>

          <div className="grid gap-3 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)]">
            <label className="block">
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
            <label className="block">
              <span className="mb-1 block text-[12px] font-bold text-ink-soft">
                Explanation (required){reason === "other" ? " — say exactly what happened" : ""}
              </span>
              <textarea
                className="min-h-[64px] w-full rounded-lg border border-hairline-strong bg-white px-3 py-2 text-[13.5px] text-ink-strong outline-none focus:border-[#14336b] focus:ring-2 focus:ring-[#14336b]/20"
                value={explanation}
                maxLength={EXPLANATION_MAX}
                aria-label="Explanation"
                placeholder="For example: Power cut 9:00–11:30, biometric machine was off; times confirmed by the supervisor."
                onChange={(e) => {
                  setExplanation(e.target.value);
                  clearReview();
                }}
              />
              <span className="text-[11.5px] text-ink-subtle tabular-nums">
                {explanation.trim().length}/{EXPLANATION_MAX}
              </span>
            </label>
          </div>
          {whyNot && (inTime || outTime || reason || explanation) && <p className="-mt-2 text-[12.5px] text-ink-subtle">{whyNot}</p>}
        </div>
      )}

      {review && (
        <section className="mt-4 rounded-lg p-3" style={{ border: "1px solid #CFE0FA", background: "#F7FAFF" }} aria-labelledby="ac-review">
          <h3 id="ac-review" className="text-[14px] font-bold text-ink-strong">
            Review and confirm
          </h3>
          <ul className="mt-1.5 grid gap-0.5 text-[13px] font-semibold text-ink-strong">
            {review.changes.map((c) => (
              <li key={c.kind}>
                {c.action === "add" ? `Add ${c.kind.toUpperCase()} ${c.to}` : `Change ${c.kind.toUpperCase()} ${c.from} → ${c.to}`}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-[12.5px] text-ink-muted tabular-nums">
            After saving: check-in <strong className="text-ink-strong">{review.finalIn ?? "Not recorded"}</strong>, check-out{" "}
            <strong className="text-ink-strong">{review.finalOut ?? "Not recorded"}</strong>
          </p>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            <strong className="text-ink-strong">{review.reason.label}.</strong> {review.explanation}
          </p>
          {review.keepsNotes.length > 0 && (
            <p className="mt-1 text-[12px] text-ink-subtle">
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
          <p className="mt-1.5 text-[12px] text-ink-subtle">
            Saved as an admin entry with this reason and explanation; the previous times stay in the audit history. No emails are sent.
          </p>
          <label className="mt-2 flex items-start gap-2 text-[13px] text-ink-muted">
            <input type="checkbox" className="mt-0.5 size-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I have checked these times against a reliable source, and I confirm this correction.
          </label>
        </section>
      )}

      {error && (
        <p role="alert" className="mt-3 flex items-start gap-2 text-[13px] font-semibold text-[#B91C1C]">
          <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden /> {error}
        </p>
      )}
    </CenterDialog>
  );
}
