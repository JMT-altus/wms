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
import {
  bulkUploadCustomerWorkbook,
  bulkUploadMasters,
  type BulkUploadResult,
  type CustomerWorkbookResult,
} from "@/app/(masters-module)/masters/actions";

const ACCENT = MASTERS_GRADIENT;

interface Loaded {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
}

/**
 * Same entry-point button for both targets — this is the ONE thing that must
 * never change shape between them. What opens behind it differs completely:
 * Products keeps the original flexible CSV/XLSX-mapping flow; Customers uses
 * the 3-sheet (Basic Details / Account Details / Sales) workbook flow, since
 * that format's columns are fixed by the downloadable template rather than
 * mapped by the uploader.
 */
export function BulkUpload({
  target,
  label,
  size = "band",
}: {
  target: BulkTarget;
  label: string;
  /**
   * Where this button is sitting.
   *
   * `band` matches the filter row's chips, Sort and Export — one band, one
   * style. `header` matches New client and Full screen up on the title row,
   * which are a size larger.
   */
  size?: "band" | "header";
}) {
  const [open, setOpen] = React.useState(false);
  const triggerButton = (
    <button
      type="button"
      onClick={() => setOpen(true)}
      title="Bulk Upload"
      className={
        size === "header"
          ? "shrink-0 inline-flex items-center gap-1.5 rounded-chip px-3.5 h-10 text-[14px] font-semibold text-ink-soft bg-surface-card border border-hairline whitespace-nowrap"
          : "shrink-0 inline-flex items-center gap-1 rounded-pill px-2 h-7 text-[12px] font-semibold text-ink-soft bg-surface-card border border-hairline whitespace-nowrap"
      }
    >
      <Upload size={size === "header" ? 15 : 13} strokeWidth={2.3} className="shrink-0" />
      Bulk Upload
    </button>
  );

  if (target === "customers") {
    return (
      <>
        {triggerButton}
        <CustomerWorkbookUpload open={open} onClose={() => setOpen(false)} />
      </>
    );
  }
  return (
    <>
      {triggerButton}
      <ProductBulkUpload open={open} onClose={() => setOpen(false)} target={target} label={label} />
    </>
  );
}

/** The original single-sheet CSV/XLSX bulk upload — unchanged, Products only now. */
function ProductBulkUpload({
  open,
  onClose,
  target,
  label,
}: {
  open: boolean;
  onClose: () => void;
  target: BulkTarget;
  label: string;
}) {
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
    onClose();
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

/**
 * 0087 — Customer Master bulk upload: one workbook, three linked sheets
 * (Basic Details / Account Details / Sales), replacing the old flexible
 * single-sheet mapping flow for this target only — Products is untouched
 * above. The template's columns are fixed, so there's no per-header mapping
 * step here: the file is sent as-is to the server, which reads the three
 * named sheets, validates every row, and reports exactly what happened.
 */
function CustomerWorkbookUpload({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [file, setFile] = React.useState<File | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<CustomerWorkbookResult | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  function reset() {
    setFile(null);
    setError(null);
    setResult(null);
    setBusy(false);
    if (inputRef.current) inputRef.current.value = "";
  }

  function close() {
    onClose();
    reset();
  }

  function onFile(f: File) {
    setError(null);
    setResult(null);
    if (!/\.xlsx?$/i.test(f.name)) {
      setError("That's not an Excel file. Download the template below and fill it in as .xlsx.");
      return;
    }
    setFile(f);
  }

  async function onImport() {
    if (!file) return;
    setBusy(true);
    setError(null);
    const formData = new FormData();
    formData.append("file", file);
    const res = await bulkUploadCustomerWorkbook(formData);
    setBusy(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setResult(res);
    setFile(null);
  }

  return (
    <MastersDialog
      open={open}
      title="Bulk upload customers"
      subtitle="One workbook, three sheets — Basic Details, Account Details, Sales — linked by Customer Code."
      onClose={close}
      width={720}
      footer={
        <>
          <CancelButton onClick={close} />
          {file && (
            <button
              type="button"
              onClick={onImport}
              disabled={busy}
              className="rounded-xl px-5 py-2.5 text-white font-bold disabled:opacity-60"
              style={{ fontSize: 14.5, background: ACCENT }}
            >
              {busy ? "Importing…" : "Import workbook"}
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
            background:
              result.rowErrors.length > 0
                ? "color-mix(in srgb, var(--color-amber) 10%, transparent)"
                : "color-mix(in srgb, var(--color-green) 10%, transparent)",
            border:
              result.rowErrors.length > 0
                ? "1px solid color-mix(in srgb, var(--color-amber) 28%, transparent)"
                : "1px solid color-mix(in srgb, var(--color-green) 28%, transparent)",
          }}
        >
          <p
            className="flex items-center gap-2 font-bold text-[15px]"
            style={{ color: result.rowErrors.length > 0 ? "var(--color-amber-deep)" : "var(--color-green-deep)" }}
          >
            <CheckCircle2 size={17} strokeWidth={2.4} />
            {result.customersCreated} customer{result.customersCreated === 1 ? "" : "s"} added,{" "}
            {result.customersUpdated} updated, {result.salesLinesImported} Sales line
            {result.salesLinesImported === 1 ? "" : "s"} imported.
          </p>
          {result.rowErrors.length > 0 && (
            <div className="mt-3 max-h-56 overflow-y-auto rounded-chip bg-surface-card border border-hairline p-3">
              <p className="font-bold text-ink-strong mb-1.5" style={{ fontSize: 13 }}>
                {result.rowErrors.length} row{result.rowErrors.length === 1 ? "" : "s"} skipped:
              </p>
              <ul className="text-[13px] text-ink-soft list-disc pl-5 space-y-0.5">
                {result.rowErrors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
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

      {!file && !result && (
        <div>
          <label
            className="flex flex-col items-center justify-center gap-2 rounded-section px-6 py-10 cursor-pointer text-center"
            style={{
              border: "1.5px dashed var(--color-hairline)",
              background: "var(--color-surface-soft)",
            }}
          >
            <FileSpreadsheet size={26} strokeWidth={1.9} className="text-ink-subtle" />
            <span className="font-bold text-ink-strong text-[15px]">Choose the filled-in .xlsx workbook</span>
            <span className="text-[13px] text-ink-muted">
              Basic Details, Account Details and Sales sheets, from the template below.
            </span>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) onFile(f);
              }}
            />
          </label>

          <div className="mt-5">
            <p className="uppercase font-bold tracking-[0.08em] text-ink-subtle" style={{ fontSize: 11 }}>
              Sheets in the workbook
            </p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {["Basic Details", "Account Details", "Sales"].map((s) => (
                <span
                  key={s}
                  className="rounded-pill px-2.5 py-1 font-semibold"
                  style={{
                    fontSize: 12,
                    background: "var(--color-surface-soft)",
                    border: "1px solid var(--color-hairline)",
                    color: "var(--color-ink-soft)",
                  }}
                >
                  {s}
                </span>
              ))}
            </div>
            <p className="mt-2 text-[13px] text-ink-muted">
              Customer Code links the three sheets — not Customer Name. Leave it blank on Basic
              Details for a brand-new customer with no Account Details/Sales rows in this file;
              fill it in yourself if other rows need to reference that customer.
            </p>
            <a
              href="/masters/customer-template.xlsx"
              download
              className="inline-block mt-3 text-[13.5px] font-semibold"
              style={{ color: MASTERS_INK }}
            >
              Download the template
            </a>
          </div>
        </div>
      )}

      {file && !result && (
        <div>
          <p className="text-[14px] text-ink-soft">
            <span className="font-bold text-ink-strong">{file.name}</span> ready to import.
          </p>
          <p className="mt-2 text-[13px] text-ink-muted">
            Every row across all three sheets is validated before anything is saved. A row with a
            problem is skipped and listed by sheet and row number — the rest of the file still
            imports.
          </p>
        </div>
      )}
    </MastersDialog>
  );
}
