"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Upload, Loader2, FileSpreadsheet, X } from "lucide-react";
import { importWeeklyGoals } from "@/app/(app)/weekly-goals/actions";

interface Props {
  /** The team member rows import into; "" / "all" means "use the file's Employee column". */
  employeeId: string;
  weekStart: string;
  weekLabel: string;
  isAdmin: boolean;
}

type Result = { imported: number; skipped: number; warnings: string[] } | null;

/**
 * "Import file" button for the Weekly Goals board. Accepts a CSV / Excel file
 * (the same thing you'd download from Google Sheets) whose first row is the
 * column headers. Each data row becomes a weekly goal for the week in view.
 */
export function WeeklyGoalsImport(props: Props) {
  const router = useRouter();
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [open, setOpen] = React.useState(false);
  const [pending, start] = React.useTransition();
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<Result>(null);

  const needsEmployeeColumn = props.isAdmin && (!props.employeeId || props.employeeId === "all");

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!file) return;
    setError(null);
    setResult(null);
    const fd = new FormData();
    fd.set("file", file);
    fd.set("weekStart", props.weekStart);
    fd.set("employeeId", props.employeeId);
    start(async () => {
      const res = await importWeeklyGoals(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setResult({ imported: res.imported, skipped: res.skipped, warnings: res.warnings });
      router.refresh();
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          setError(null);
          setResult(null);
        }}
        className="inline-flex h-9 items-center gap-1.5 px-3.5 rounded-lg text-[13.5px] font-semibold border border-hairline-strong bg-white text-ink-strong transition-colors hover:border-[#9fb2d1] hover:bg-[#F8FAFD] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#14336B]"
      >
        <Upload size={16} strokeWidth={2.4} />
        Import file
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => !pending && setOpen(false)}
        >
          <div
            className="relative w-full max-w-[560px] overflow-hidden rounded-xl border border-hairline bg-surface-card shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <span
              aria-hidden
              className="absolute inset-x-0 top-0 h-[3px]"
              style={{ background: "linear-gradient(90deg, rgb(2, 99, 204), rgb(0, 66, 138))" }}
            />
            <div className="flex items-center justify-between gap-4 border-b border-hairline px-5 py-3">
              <div className="flex items-center gap-2">
                <FileSpreadsheet size={18} className="text-altus-red" />
                <h2 className="text-[18px] font-extrabold text-ink-strong">Import Weekly Goals</h2>
              </div>
              <button
                type="button"
                onClick={() => !pending && setOpen(false)}
                className="inline-flex size-8 items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-surface-soft hover:text-ink-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A6CFF]"
                aria-label="Close"
              >
                <X size={16} />
              </button>
            </div>

            <div className="px-5 py-4">
            <p className="text-[13px] leading-[1.5] text-ink-soft">
              Upload a CSV or Excel file (or one exported from Google Sheets) for{" "}
              <strong className="text-ink-strong">{props.weekLabel}</strong>. The first row
              must be the column headers; every row after becomes a goal.
            </p>

            <div className="mt-3 rounded-lg border border-hairline bg-[#F5F7FB] px-3 py-2.5">
              <p className="text-[11.5px] font-bold uppercase tracking-[0.06em] text-ink-subtle">
                Recognised headers
              </p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {[
                  "Client", "Subject", "Priority", "Incentive", "KPI", "Target", "% Done", "Explanation", "Link",
                  ...(props.isAdmin ? ["Employee (name or email)"] : []),
                ].map((h) => (
                  <span
                    key={h}
                    className="inline-flex items-center rounded-md border border-hairline bg-white px-2 py-0.5 text-[12px] font-semibold text-ink-soft"
                  >
                    {h}
                  </span>
                ))}
              </div>
            </div>

            {needsEmployeeColumn && (
              <p className="mt-3 rounded-lg border border-[#FDE6B3] bg-[#FFF8E8] px-3 py-2 text-[12.5px] font-medium text-[#9A5B00]">
                You&apos;re viewing all team members — include an <strong>Employee</strong> column
                (name or email) in the file, or pick one person first.
              </p>
            )}

            {error && (
              <p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[12.5px] font-medium text-altus-red">
                {error}
              </p>
            )}

            {result && (
              <div className="mt-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-[12.5px] font-semibold text-green-700">
                Imported {result.imported} goal{result.imported === 1 ? "" : "s"}
                {result.skipped > 0 ? ` · ${result.skipped} row(s) skipped` : ""}.
                {result.warnings.length > 0 && (
                  <ul className="mt-1.5 list-disc pl-4 font-semibold text-amber-700">
                    {result.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={onPick}
            />

            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => !pending && setOpen(false)}
                className="inline-flex h-9 items-center rounded-lg border border-[#D6DEEB] bg-white px-4 text-[13px] font-semibold text-[#334155] transition-colors hover:bg-[#F5F8FE] hover:border-[#B8CCEE] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A6CFF]"
              >
                {result ? "Done" : "Cancel"}
              </button>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                disabled={pending}
                className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0A6CFF] px-4 text-[13px] font-semibold text-white transition-colors hover:bg-[#0858d6] active:bg-[#0749b3] disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A6CFF]"
              >
                {pending ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
                {pending ? "Importing…" : "Choose file"}
              </button>
            </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
