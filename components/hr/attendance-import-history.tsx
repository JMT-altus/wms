"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Undo2 } from "lucide-react";
import {
  inspectImportBatch,
  undoImportBatch,
  type BatchInspection,
  type BatchSummary,
} from "@/app/(app)/hr/attendance-import/actions";

/**
 * Previous imports. Reading is always safe. Undo removes only the punches of
 * that batch that are still exactly as the import wrote them; any punch that
 * was edited, replaced or deleted since is left alone and counted as such.
 */

const CARD = "rounded-xl bg-white p-4 max-md:p-3";
const LINE = { border: "1px solid #DCE4F0" } as const;

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });

export function AttendanceImportHistory({ batches }: { batches: BatchSummary[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState<string | null>(null);
  const [info, setInfo] = React.useState<BatchInspection | null>(null);
  const [busy, setBusy] = React.useState<"inspect" | "undo" | null>(null);
  const [confirm, setConfirm] = React.useState(false);
  const [message, setMessage] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function inspect(batchId: string) {
    setOpen(batchId);
    setInfo(null);
    setConfirm(false);
    setMessage(null);
    setError(null);
    setBusy("inspect");
    try {
      const res = await inspectImportBatch(batchId);
      if (res.ok) setInfo(res.inspection);
      else setError(res.error);
    } catch {
      setError("Could not load this import.");
    } finally {
      setBusy(null);
    }
  }

  async function undo(batchId: string) {
    setBusy("undo");
    setError(null);
    try {
      const res = await undoImportBatch({ batchId, confirm: true });
      if (!res.ok) {
        setError(res.error);
      } else {
        const u = res.undo;
        setMessage(
          `Removed ${u.removed} unchanged punch${u.removed === 1 ? "" : "es"}. Left alone: ${u.keptModified} edited, ${u.keptDayTouched} unchanged but on ${u.daysSkipped} day${u.daysSkipped === 1 ? "" : "s"} that were edited or have another punch, ${u.missing} already gone` +
            (u.failedPeople ? `. ${u.failedPeople} employee${u.failedPeople === 1 ? "" : "s"} could not be processed — try again.` : "."),
        );
        setConfirm(false);
        router.refresh();
        const again = await inspectImportBatch(batchId);
        if (again.ok) setInfo(again.inspection);
      }
    } catch {
      setError("The undo did not complete. Inspect the import again to see what is left.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className={CARD} style={LINE} aria-labelledby="att-history">
      <h2 id="att-history" className="text-[15px] font-bold text-ink-strong">
        Previous imports
      </h2>
      <p className="mt-1 text-[12.5px] text-ink-muted">
        Every import is recorded under a batch id with the exact punches it wrote. Undo removes only punches that are still exactly as imported;
        edited punches are never touched.
      </p>
      {batches.length === 0 ? (
        <p className="mt-3 text-[13px] text-ink-subtle">No imports have been recorded yet.</p>
      ) : (
        <div className="mt-3 overflow-x-auto rounded-lg" style={{ border: "1px solid #E6ECF5" }}>
          <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
            <thead>
              <tr className="text-left text-ink-soft" style={{ background: "#F5F7FB" }}>
                <th className="px-3 py-1.5 font-bold">When (IST)</th>
                <th className="px-3 py-1.5 font-bold">By</th>
                <th className="px-3 py-1.5 font-bold">File</th>
                <th className="px-3 py-1.5 font-bold">Dates</th>
                <th className="px-3 py-1.5 text-center font-bold">People</th>
                <th className="px-3 py-1.5 text-center font-bold">Punches</th>
                <th className="px-3 py-1.5 text-center font-bold">Undone</th>
                <th className="px-3 py-1.5" />
              </tr>
            </thead>
            <tbody>
              {batches.map((b) => (
                <React.Fragment key={b.batchId}>
                  <tr className="border-t border-[#EEF1F6]">
                    <td className="px-3 py-1.5 tabular-nums">{fmt(b.createdAt)}</td>
                    <td className="px-3 py-1.5">{b.actorName}</td>
                    <td className="max-w-[220px] truncate px-3 py-1.5" title={b.file ?? ""}>{b.file ?? "—"}</td>
                    <td className="px-3 py-1.5 tabular-nums">{b.from && b.to ? `${b.from} → ${b.to}` : "—"}</td>
                    <td className="px-3 py-1.5 text-center tabular-nums">{b.people}</td>
                    <td className="px-3 py-1.5 text-center tabular-nums">{b.punches}</td>
                    <td className="px-3 py-1.5 text-center tabular-nums">{b.removed}</td>
                    <td className="px-3 py-1.5 text-right">
                      <button
                        type="button"
                        onClick={() => (open === b.batchId ? setOpen(null) : void inspect(b.batchId))}
                        className="rounded-lg px-2.5 py-1 font-bold text-[#0B4FB8]"
                        style={{ background: "#EEF4FF" }}
                      >
                        {open === b.batchId ? "Hide" : "Inspect"}
                      </button>
                    </td>
                  </tr>
                  {open === b.batchId && (
                    <tr className="border-t border-[#EEF1F6] bg-[#FAFCFF]">
                      <td colSpan={8} className="px-3 py-3">
                        <p className="text-[12px] text-ink-subtle">
                          Batch <span className="font-mono">{b.batchId}</span>
                        </p>
                        {busy === "inspect" && <Loader2 size={16} className="mt-2 animate-spin text-ink-subtle" aria-label="Loading" />}
                        {error && <p role="alert" className="mt-2 text-[13px] font-semibold text-[#B91C1C]">{error}</p>}
                        {message && <p className="mt-2 text-[13px] font-semibold text-[#047857]">{message}</p>}
                        {info && info.batchId === b.batchId && (
                          <>
                            <p className="mt-2 text-[13px] text-ink-strong tabular-nums">
                              {info.totals.recorded} recorded · <strong className="text-[#047857]">{info.totals.intact} can be removed</strong> ·{" "}
                              {info.totals.keptDayTouched > 0 && (
                                <>
                                  <strong className="text-[#B45309]">{info.totals.keptDayTouched} unchanged but kept (their day was edited)</strong> ·{" "}
                                </>
                              )}
                              <strong className="text-[#B45309]">{info.totals.modified} edited since</strong> · {info.totals.missing} no longer
                              present · {info.totals.removed} removed by an undo
                            </p>
                            <div className="mt-2 overflow-x-auto rounded-lg" style={{ border: "1px solid #E6ECF5" }}>
                              <table className="w-full min-w-[520px] border-collapse text-[12.5px]">
                                <thead>
                                  <tr className="text-left text-ink-soft" style={{ background: "#F5F7FB" }}>
                                    <th className="px-3 py-1.5 font-bold">Employee</th>
                                    <th className="px-3 py-1.5 text-center font-bold">Recorded</th>
                                    <th className="px-3 py-1.5 text-center font-bold">Unchanged</th>
                                    <th className="px-3 py-1.5 text-center font-bold">Edited</th>
                                    <th className="px-3 py-1.5 text-center font-bold">Gone</th>
                                    <th className="px-3 py-1.5 text-center font-bold">Removed</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {info.people.map((p) => (
                                    <tr key={p.employeeId} className="border-t border-[#EEF1F6] align-top">
                                      <td className="px-3 py-1.5">
                                        <span className="font-semibold">{p.name}</span>
                                        <span className="ml-2 text-ink-subtle">{p.email}</span>
                                        {p.touchedDays.length > 0 && (
                                          <ul className="mt-1 text-[12px] text-[#B45309]">
                                            {p.touchedDays.map((d) => (
                                              <li key={d.date}>
                                                {d.date}: whole day kept — {d.why.join("; ")}
                                              </li>
                                            ))}
                                          </ul>
                                        )}
                                        {p.modifiedDetails.length > 0 && (
                                          <ul className="mt-1 text-[12px] text-[#B45309]">
                                            {p.modifiedDetails.map((m, i) => (
                                              <li key={i}>
                                                {m.date} {m.kind.toUpperCase()}: {m.why.join(", ")}
                                              </li>
                                            ))}
                                          </ul>
                                        )}
                                      </td>
                                      <td className="px-3 py-1.5 text-center tabular-nums">{p.recorded}</td>
                                      <td className="px-3 py-1.5 text-center tabular-nums">{p.intact}</td>
                                      <td className="px-3 py-1.5 text-center tabular-nums">{p.modified}</td>
                                      <td className="px-3 py-1.5 text-center tabular-nums">{p.missing}</td>
                                      <td className="px-3 py-1.5 text-center tabular-nums">{p.removed}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                            {info.totals.intact > 0 && (
                              <div className="mt-3">
                                <label className="flex items-start gap-2 text-[13px] text-ink-muted">
                                  <input type="checkbox" checked={confirm} onChange={(e) => setConfirm(e.target.checked)} className="mt-0.5 size-4" />
                                  Remove the {info.totals.intact} unchanged punch{info.totals.intact === 1 ? "" : "es"} this import wrote. Edited punches stay.
                                </label>
                                <button
                                  type="button"
                                  disabled={!confirm || busy !== null}
                                  onClick={() => void undo(b.batchId)}
                                  className="mt-2 inline-flex h-9 items-center gap-2 rounded-lg px-4 text-[13.5px] font-bold text-white disabled:cursor-not-allowed disabled:opacity-50"
                                  style={{ background: "#B91C1C" }}
                                >
                                  {busy === "undo" ? <Loader2 size={15} className="animate-spin" aria-hidden /> : <Undo2 size={15} aria-hidden />}
                                  Undo unchanged punches
                                </button>
                              </div>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
