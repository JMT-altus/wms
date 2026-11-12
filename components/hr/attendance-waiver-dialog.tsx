"use client";

import * as React from "react";
import { AlertTriangle, Loader2, XCircle } from "lucide-react";
import { CenterDialog } from "@/components/ui/center-dialog";
import { formatMinutes } from "@/lib/attendance/overview";
import { fmtDate, fmtDateTime, fmtDateWithWeekday } from "@/lib/dates";
import { previewWaiver, reverseWaiver, waiveDay, type WaiverPreview } from "@/app/(app)/hr/attendance-correction/waiver-actions";
import type { WaiverRecord } from "@/lib/queries/attendance-waivers";

/**
 * Waive / reverse dialogs for HR → Attendance Correction. The server decides
 * everything (permission, which days can be waived, duplicates, the salary-run
 * warning); these collect the mandatory reason and the explicit confirmation and
 * show what the waiver changes before it is applied.
 */

const BTN = "inline-flex h-9 items-center justify-center gap-2 whitespace-nowrap rounded-lg px-4 text-[13.5px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 max-sm:px-2.5 max-sm:text-[12.5px]";
const PRIMARY = { background: "#3F3CB0", color: "#fff" } as const;
const MUTED = { background: "#EEF0F3", color: "#8A93A0" } as const;
const GHOST = { background: "#fff", color: "#172B4D", border: "1px solid #DCE4F0" } as const;
const AREA =
  "min-h-[64px] w-full rounded-lg border border-hairline-strong bg-white px-3 py-2 text-[13.5px] text-ink-strong outline-none focus:border-[#14336b] focus:ring-2 focus:ring-[#14336b]/20";
const ACCENT_BAR = "linear-gradient(90deg, #5B57D9 0%, #3F3CB0 100%)";

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-bold uppercase tracking-[0.05em] text-ink-subtle">{label}</dt>
      <dd className="text-[13.5px] font-semibold text-ink-strong tabular-nums">{children}</dd>
    </div>
  );
}

function Problem({ text }: { text: string }) {
  return (
    <p role="alert" className="mt-3 flex items-start gap-2 text-[13px] font-semibold text-[#B91C1C]">
      <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden /> {text}
    </p>
  );
}

const days = (n: number) => `${n} payable day${n === 1 ? "" : "s"}`;

export function WaiveDialog({ employeeId, date, onClose, onDone }: { employeeId: string; date: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [preview, setPreview] = React.useState<WaiverPreview | null>(null);
  const [reason, setReason] = React.useState("");
  const [confirmed, setConfirmed] = React.useState(false);
  const [busy, setBusy] = React.useState<"load" | "save" | null>("load");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let live = true;
    previewWaiver({ employeeId, date })
      .then((r) => live && (r.ok ? setPreview(r.preview) : setError(r.error)))
      .catch(() => live && setError("Could not check that day. Please try again."))
      .finally(() => live && setBusy(null));
    return () => {
      live = false;
    };
  }, [employeeId, date]);

  const ready = preview && reason.trim().length >= 3 && confirmed && busy === null;
  async function submit() {
    setBusy("save");
    setError(null);
    try {
      const r = await waiveDay({ employeeId, date, reason, confirmed: confirmed ? true : undefined });
      if (r.ok) onDone(`Attendance waived — ${r.waived.employeeName} · ${fmtDate(r.waived.date)}. It now counts as a paid day with no late/early mark.`);
      else setError(r.error);
    } catch {
      setError("The waiver could not be saved, so nothing was changed. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  const c = preview?.current;
  return (
    <CenterDialog
      open
      title="Waive attendance"
      subtitle={preview ? `${preview.employee.name} · ${fmtDateWithWeekday(date, "long")}` : fmtDateWithWeekday(date, "long")}
      onClose={onClose}
      width={600}
      accentBar={ACCENT_BAR}
      footer={
        <>
          <button type="button" className={BTN} style={GHOST} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={BTN} style={ready ? PRIMARY : MUTED} disabled={!ready} onClick={() => void submit()}>
            {busy === "save" && <Loader2 size={15} className="animate-spin" aria-hidden />}
            Waive attendance
          </button>
        </>
      }
    >
      {busy === "load" && (
        <p className="flex items-center gap-2 text-[13px] text-ink-subtle">
          <Loader2 size={15} className="animate-spin" aria-hidden /> Checking the day…
        </p>
      )}
      {preview && c && (
        <div className="grid gap-3">
          <dl className="grid grid-cols-2 gap-3 rounded-lg p-3 sm:grid-cols-4" style={{ border: "1px solid #E6ECF5", background: "#FAFCFF" }}>
            <Fact label="Employee">{preview.employee.name}</Fact>
            <Fact label="Date">{fmtDate(date)}</Fact>
            <Fact label="Status now">{c.label}{c.late && !c.lateWaived ? " · late" : ""}{c.leftEarly ? " · left early" : ""}</Fact>
            <Fact label="Recorded">
              {c.inAt ?? "—"} → {c.outAt ?? "—"}
              {c.inAt && c.outAt ? ` (${formatMinutes(c.workedMinutes)})` : ""}
            </Fact>
          </dl>
          <div className="rounded-lg px-3 py-2.5 text-[13px]" style={{ background: "#EFEFFD", border: "1px solid #D5D4F7", color: "#2E2B8F" }}>
            <p className="font-bold">After the waiver: WAIVED</p>
            <ul className="mt-1 list-disc pl-5">
              <li>
                Salary: {days(preview.payable.before)} → <strong>{days(preview.payable.after)}</strong>
                {preview.payable.after > preview.payable.before ? ` (+${preview.payable.after - preview.payable.before})` : ""}.
              </li>
              {preview.removesLateMark && <li>The late mark no longer counts toward the every-3rd-late half-day deduction.</li>}
              {preview.removesEarlyMark && <li>The left-early mark is removed.</li>}
              <li>The recorded check-in and check-out stay exactly as they are; no hours are added.</li>
            </ul>
          </div>
          {preview.salaryRun && (
            <p role="status" className="flex items-start gap-2 rounded-lg px-3 py-2 text-[12.5px] font-semibold" style={{ background: "#FFFBEB", border: "1px solid #FCD9A0", color: "#92400E" }}>
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
              <span>
                Salary for {preview.salaryRun.month} is already generated
                {preview.salaryRun.disbursed === undefined ? "" : preview.salaryRun.disbursed ? " and disbursed" : " (not yet disbursed)"}. The waiver will not change that
                salary run; it will show as needing review so payroll can recalculate if appropriate.
              </span>
            </p>
          )}
          <label className="block">
            <span className="mb-1 block text-[12px] font-bold text-ink-soft">Reason for the waiver (required)</span>
            <textarea className={AREA} value={reason} maxLength={500} aria-label="Waiver reason" placeholder="e.g. Approved client visit; biometric unavailable at site" onChange={(e) => setReason(e.target.value)} />
          </label>
          <label className="flex items-start gap-2 text-[13px] text-ink-muted">
            <input type="checkbox" className="mt-0.5 size-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            I confirm waiving {preview.employee.name}&rsquo;s attendance for {fmtDate(date)}.
          </label>
        </div>
      )}
      {error && <Problem text={error} />}
    </CenterDialog>
  );
}

export function ReverseWaiverDialog({ waiver, employeeName, onClose, onDone }: { waiver: WaiverRecord; employeeName: string; onClose: () => void; onDone: (msg: string) => void }) {
  const [reason, setReason] = React.useState("");
  const [confirmed, setConfirmed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ready = reason.trim().length >= 3 && confirmed && !busy;
  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const r = await reverseWaiver({ waiverId: waiver.id, reason, confirmed: confirmed ? true : undefined });
      if (r.ok) onDone(`Waiver reversed — ${employeeName} · ${fmtDate(r.reversed.date)}. The day is graded from its recorded times again.`);
      else setError(r.error);
    } catch {
      setError("The reversal could not be saved, so nothing was changed. Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <CenterDialog
      open
      title="Reverse waiver"
      subtitle={`${employeeName} · ${fmtDateWithWeekday(waiver.date, "long")}`}
      onClose={onClose}
      width={560}
      accentBar={ACCENT_BAR}
      footer={
        <>
          <button type="button" className={BTN} style={GHOST} onClick={onClose}>
            Cancel
          </button>
          <button type="button" className={BTN} style={ready ? PRIMARY : MUTED} disabled={!ready} onClick={() => void submit()}>
            {busy && <Loader2 size={15} className="animate-spin" aria-hidden />}
            Reverse waiver
          </button>
        </>
      }
    >
      <div className="grid gap-3">
        <dl className="grid grid-cols-2 gap-3 rounded-lg p-3" style={{ border: "1px solid #E6ECF5", background: "#FAFCFF" }}>
          <Fact label="Waived by">{waiver.waivedBy ?? "—"}</Fact>
          <Fact label="Waived on">{fmtDateTime(waiver.waivedAt)}</Fact>
          <div className="col-span-2">
            <Fact label="Reason">{waiver.reason}</Fact>
          </div>
        </dl>
        <p className="text-[12.5px] text-ink-muted">
          After reversing, the day is graded from its recorded times again (and counts toward salary as such). The waiver stays in the history.
        </p>
        <label className="block">
          <span className="mb-1 block text-[12px] font-bold text-ink-soft">Reason for reversing (required)</span>
          <textarea className={AREA} value={reason} maxLength={500} aria-label="Reversal reason" onChange={(e) => setReason(e.target.value)} />
        </label>
        <label className="flex items-start gap-2 text-[13px] text-ink-muted">
          <input type="checkbox" className="mt-0.5 size-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
          I confirm reversing this waiver.
        </label>
      </div>
      {error && <Problem text={error} />}
    </CenterDialog>
  );
}
