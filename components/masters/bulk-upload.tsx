"use client";

import * as React from "react";
import { Upload, FileSpreadsheet, CheckCircle2, AlertTriangle } from "lucide-react";
import { CancelButton } from "@/components/admin/master/drawer";
import { MastersDialog } from "./masters-dialog";
import { MASTERS_GRADIENT, MASTERS_INK } from "./theme";
import {
  BULK_FIELDS,
  applyMapping,
  autoMap,
  parseDelimited,
  splitUsableRows,
  type BulkTarget,
  type MappedRow,
} from "@/lib/masters/bulk-parse";
import { bulkUploadMasters, type BulkUploadResult } from "@/app/(masters-module)/masters/actions";

const ACCENT = MASTERS_GRADIENT;

interface Loaded {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
}

/**
 * Bulk upload for one master.
 *
 * The file is parsed and mapped IN THE BROWSER, and only the mapped rows are
 * sent — so the person sees exactly what will be imported before anything is
 * written, and an unrecognised column is visibly ignored rather than silently
 * dropped server-side. The server re-normalises everything it receives anyway
 * (lib/masters/bulk-parse.ts is shared by both sides); this is a preview, not
 * a trust boundary.
 *
 * .xlsx is read with a dynamic import of the `xlsx` package so the ~400 KB
 * parser only downloads for the person who actually picks a spreadsheet.
 */
export function BulkUpload({ target, label }: { target: BulkTarget; label: string }) {
  const [open, setOpen] = React.useState(false);
  const [loaded, setLoaded] = React.useState<Loaded | null>(null);
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<BulkUploadResult | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const fields = BULK_FIELDS[target];

  function reset() {
    setLoaded(null);
    setMapping({});
    setError(null);
    setResult(null);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  function close() {
    setOpen(false);
    reset();
  }

  async function onFile(file: File) {
    setError(null);
    setResult(null);
    try {
      let parsed: { headers: string[]; rows: Record<string, string>[] };
      if (/\.xlsx?$/i.test(file.name)) {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
        const sheetName = wb.SheetNames[0];
        const sheet = sheetName ? wb.Sheets[sheetName] : undefined;
        if (!sheet) {
          setError("That workbook has no sheets.");
          return;
        }
        // Round-tripping through CSV means one parser, not two: sheet_to_csv
        // emits each cell's FORMATTED text, so a date reads as the user sees it
        // in Excel rather than as a serial number.
        const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
        parsed = parseDelimited(csv);
      } else {
        parsed = parseDelimited(await file.text());
      }

      if (parsed.rows.length === 0) {
        setError("That file has a header row but no data rows.");
        return;
      }
      setLoaded({ fileName: file.name, headers: parsed.headers, rows: parsed.rows });
      setMapping(autoMap(parsed.headers, target));
    } catch (err) {
      setError(`Could not read that file: ${(err as Error).message}`);
    }
  }

  const mapped: MappedRow[] = React.useMemo(
    () => (loaded ? applyMapping(loaded.rows, mapping) : []),
    [loaded, mapping],
  );
  const { usable, skipped } = React.useMemo(
    () => splitUsableRows(mapped, target),
    [mapped, target],
  );

  async function onImport() {
    if (!loaded) return;
    setBusy(true);
    setError(null);
    const res = await bulkUploadMasters({
      target,
      fileName: loaded.fileName,
      rows: mapped,
    });
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setResult(res);
    setLoaded(null);
  }

  const templateHref = React.useMemo(() => {
    const header = fields.map((f) => f.label).join(",");
    return `data:text/csv;charset=utf-8,${encodeURIComponent(`﻿${header}\n`)}`;
  }, [fields]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Bulk Upload"
        // h-9 / 13px matches the chips, Sort and Export — one band, one style.
        className="inline-flex items-center gap-1.5 rounded-chip px-3 h-9 text-[13px] font-semibold text-ink-soft bg-surface-card border border-hairline whitespace-nowrap"
      >
        <Upload size={15} strokeWidth={2.3} className="shrink-0" />
        Bulk Upload
      </button>

      <MastersDialog
        open={open}
        title={`Bulk upload ${label}`}
        subtitle="CSV or Excel. Only Name is required — anything a row leaves out imports blank."
        onClose={close}
        width={720}
        footer={
          <>
            <CancelButton onClick={close} />
            {loaded && (
              <button
                type="button"
                onClick={onImport}
                disabled={busy || usable.length === 0}
                className="rounded-xl px-5 py-2.5 text-white font-bold disabled:opacity-60"
                style={{ fontSize: 14.5, background: ACCENT }}
              >
                {busy ? "Importing…" : `Import ${usable.length} row${usable.length === 1 ? "" : "s"}`}
              </button>
            )}
          </>
        }
      >
        {error && (
          <div
            className="mb-4 rounded-chip px-3.5 py-3 flex items-start gap-2.5"
            style={{
              background: "color-mix(in srgb, var(--color-red) 10%, transparent)",
              border: "1px solid color-mix(in srgb, var(--color-red) 28%, transparent)",
            }}
          >
            <AlertTriangle size={16} strokeWidth={2.3} style={{ color: "var(--color-red-deep)", marginTop: 1 }} />
            <p className="text-[14px]" style={{ color: "var(--color-red-deep)" }}>{error}</p>
          </div>
        )}

        {result && (
          <div
            className="rounded-chip px-4 py-4"
            style={{
              background: "color-mix(in srgb, var(--color-green) 10%, transparent)",
              border: "1px solid color-mix(in srgb, var(--color-green) 28%, transparent)",
            }}
          >
            <p className="flex items-center gap-2 font-bold text-[15px]" style={{ color: "var(--color-green-deep)" }}>
              <CheckCircle2 size={17} strokeWidth={2.4} />
              Imported {result.imported} {label}.
            </p>
            <ul className="mt-2 text-[13.5px] text-ink-soft list-disc pl-5 space-y-0.5">
              {result.skippedMissing > 0 && <li>{result.skippedMissing} skipped — no Name.</li>}
              {result.skippedDuplicate > 0 && (
                <li>{result.skippedDuplicate} skipped — that name or code already exists.</li>
              )}
              {result.unmatchedReps > 0 && (
                <li>
                  {result.unmatchedReps} imported without a salesperson — the name in the file
                  didn&apos;t match anyone on the roster. Assign them from the table.
                </li>
              )}
              {result.skippedMissing === 0 &&
                result.skippedDuplicate === 0 &&
                result.unmatchedReps === 0 && <li>Every row imported cleanly.</li>}
            </ul>
            <button
              type="button"
              onClick={reset}
              className="mt-3 rounded-xl px-4 py-2 font-semibold text-ink-soft"
              style={{ fontSize: 14, border: "1px solid var(--color-hairline)" }}
            >
              Upload another file
            </button>
          </div>
        )}

        {!loaded && !result && (
          <div>
            <label
              className="flex flex-col items-center justify-center gap-2 rounded-section px-6 py-10 cursor-pointer text-center"
              style={{
                border: "1.5px dashed var(--color-hairline)",
                background: "var(--color-surface-soft)",
              }}
            >
              <FileSpreadsheet size={26} strokeWidth={1.9} className="text-ink-subtle" />
              <span className="font-bold text-ink-strong text-[15px]">Choose a .csv or .xlsx file</span>
              <span className="text-[13px] text-ink-muted">
                The first row must be the column headings.
              </span>
              <input
                ref={inputRef}
                type="file"
                accept=".csv,.xlsx,.xls,text/csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void onFile(f);
                }}
              />
            </label>

            <div className="mt-5">
              <p className="uppercase font-bold tracking-[0.08em] text-ink-subtle" style={{ fontSize: 11 }}>
                Columns we recognise
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {fields.map((f) => (
                  <span
                    key={f.key}
                    className="rounded-pill px-2.5 py-1 font-semibold"
                    style={{
                      fontSize: 12,
                      background: "var(--color-surface-soft)",
                      border: "1px solid var(--color-hairline)",
                      color: "var(--color-ink-soft)",
                    }}
                  >
                    {f.label}
                    {f.required && <span style={{ color: "var(--color-red-deep)" }}> *</span>}
                  </span>
                ))}
              </div>
              <a
                href={templateHref}
                download={`${target}-template.csv`}
                className="inline-block mt-3 text-[13.5px] font-semibold"
                style={{ color: MASTERS_INK }}
              >
                Download a blank template
              </a>
            </div>
          </div>
        )}

        {loaded && (
          <div>
            <p className="text-[14px] text-ink-soft">
              <span className="font-bold text-ink-strong">{loaded.fileName}</span> — {loaded.rows.length} row
              {loaded.rows.length === 1 ? "" : "s"}.
            </p>

            <p className="uppercase font-bold tracking-[0.08em] text-ink-subtle mt-5" style={{ fontSize: 11 }}>
              Match your columns
            </p>
            <div className="mt-2 space-y-2">
              {loaded.headers.map((h) => (
                <div key={h} className="flex items-center gap-3">
                  <span
                    className="shrink-0 truncate font-semibold text-ink-strong"
                    style={{ fontSize: 13.5, width: 170 }}
                    title={h}
                  >
                    {h || <span className="text-ink-subtle">(no heading)</span>}
                  </span>
                  <span className="text-ink-subtle shrink-0">→</span>
                  <select
                    value={mapping[h] ?? ""}
                    onChange={(e) =>
                      setMapping((prev) => {
                        const next = { ...prev };
                        // One field can only come from one column — clear any
                        // other header already claiming it, or two columns
                        // would silently fight over the same value.
                        if (e.target.value) {
                          for (const k of Object.keys(next)) {
                            if (next[k] === e.target.value) delete next[k];
                          }
                          next[h] = e.target.value;
                        } else delete next[h];
                        return next;
                      })
                    }
                    className="flex-1 min-w-0 rounded-chip px-3 h-9 bg-surface-soft border border-hairline text-[13.5px] text-ink-strong outline-none"
                  >
                    <option value="">Ignore this column</option>
                    {fields.map((f) => (
                      <option key={f.key} value={f.key}>
                        {f.label}
                        {f.required ? " (required)" : ""}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>

            <p className="uppercase font-bold tracking-[0.08em] text-ink-subtle mt-6" style={{ fontSize: 11 }}>
              Preview — first 5 rows
            </p>
            <div className="mt-2 overflow-x-auto rounded-section border border-hairline">
              <table className="w-full" style={{ fontSize: 13 }}>
                <thead>
                  <tr className="text-left uppercase tracking-[0.06em] text-ink-subtle" style={{ fontSize: 10.5 }}>
                    {fields.map((f) => (
                      <th key={f.key} className="px-3 py-2 font-bold whitespace-nowrap">
                        {f.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {mapped.slice(0, 5).map((row, i) => (
                    <tr key={i} className="border-t" style={{ borderColor: "var(--color-hairline)" }}>
                      {fields.map((f) => (
                        <td key={f.key} className="px-3 py-2 text-ink-soft whitespace-nowrap">
                          {row[f.key] || <span className="text-ink-subtle">—</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {skipped > 0 && (
              <p className="mt-3 text-[13.5px]" style={{ color: "var(--color-amber-deep)" }}>
                {skipped} row{skipped === 1 ? "" : "s"} will be skipped — no Name.
              </p>
            )}
            <p className="mt-2 text-[13px] text-ink-muted">
              Rows whose name or code already exists are skipped rather than overwritten.
            </p>
          </div>
        )}
      </MastersDialog>
    </>
  );
}
