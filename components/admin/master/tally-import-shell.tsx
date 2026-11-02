"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import {
  Banknote,
  Building2,
  FileDown,
  FileInput,
  FileSpreadsheet,
  FileText,
  Loader2,
  Receipt,
  ReceiptText,
  Scale,
  ShoppingCart,
  Truck,
  UploadCloud,
  Users,
  type LucideIcon,
} from "lucide-react";
import { CenterDialog } from "@/components/ui/center-dialog";
import { fireToast } from "@/lib/toast";
import { fmtDate, fmtDateTime } from "@/lib/dates";
import { DateField } from "@/components/ui/date-field";
import { TALLY_CATEGORIES, TALLY_LIMITS, type TallyCategoryKey } from "@/lib/tally/categories";
import { checkMapping, findHeaderRow, mappingIsUsable, suggestMapping, type TallyMapping } from "@/lib/tally/mapping";
import { chunkRows, planRows, summarize, type PlannedRow, type RawRow, type TallyDirection } from "@/lib/tally/plan";
import { checkTallyChunk, finishTallyImport, getSavedTallyMapping, getTallyBatchProblems, importTallyChunk, startTallyImport } from "@/app/(forms-module)/forms/tally-import/actions";
import type { HistoryRow } from "@/lib/queries/tally-import";

/**
 * Tally Data Import. The file is read in this browser and only its cells go to
 * the server, which plans and validates them again. Nothing is written until the
 * person has validated the file and confirmed. See lib/tally/.
 */

interface Category {
  key: TallyCategoryKey;
  label: string;
  hint: string;
  icon: LucideIcon;
}

const CATEGORIES: ReadonlyArray<Category> = [
  { key: "customer-master", label: "Customer Master", hint: "Ledgers under Sundry Debtors", icon: Users },
  { key: "vendor-master", label: "Vendor Master", hint: "Ledgers under Sundry Creditors", icon: Building2 },
  { key: "sales-orders", label: "Sales Orders", hint: "Open and fulfilled orders", icon: ShoppingCart },
  { key: "sales-invoices", label: "Sales Invoices / Tax Invoices", hint: "Sales vouchers", icon: ReceiptText },
  { key: "purchase-invoices", label: "Purchase Invoices", hint: "Purchase vouchers", icon: Truck },
  { key: "credit-notes", label: "Credit Notes", hint: "Sales returns and adjustments", icon: FileInput },
  { key: "debit-notes", label: "Debit Notes", hint: "Purchase returns and adjustments", icon: FileDown },
  { key: "customer-receipts", label: "Customer Receipts (Cash/Bank)", hint: "Receipt vouchers", icon: Banknote },
  { key: "vendor-payments", label: "Vendor Payments (Cash/Bank)", hint: "Payment vouchers", icon: Receipt },
  { key: "outstanding-balances", label: "Outstanding Balances", hint: "Bills receivable and payable", icon: Scale },
];

const CARD_STYLE: React.CSSProperties = {
  border: "1px solid var(--color-hairline)",
  boxShadow: "0 14px 32px -20px rgba(245, 158, 11, 0.2), 0 2px 6px -2px rgba(15, 23, 42, 0.06)",
};
const FIELD = "h-9 rounded-lg border border-hairline-strong bg-white px-2 text-[13px] text-ink-strong";
const PRIMARY = "rounded-pill px-5 py-2.5 font-bold text-white disabled:cursor-not-allowed disabled:opacity-50";
/* The Forms module's rose (see STYLES.forms in app/(app)/hub/page.tsx): this screen is a Forms section now. */
const FORMS_ACCENT = "linear-gradient(135deg, #FB7185 0%, #BE123C 100%)";
const FORMS_ACCENT_BAR = "linear-gradient(90deg, #FB7185 0%, #BE123C 100%)";
const PRIMARY_STYLE: React.CSSProperties = { fontSize: 14, background: FORMS_ACCENT };

const STATE_LABEL: Record<PlannedRow["state"], string> = { valid: "Valid", attention: "Needs attention", duplicate: "Duplicate", invalid: "Invalid" };

interface Loaded {
  fileName: string;
  sheet: string;
  hash: string;
  headers: string[];
  rows: RawRow[];
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-xl px-3 py-2" style={{ background: "var(--color-surface-soft)", border: "1px solid var(--color-hairline)" }}>
      <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-subtle">{label}</p>
      <p className="text-[20px] font-extrabold tabular-nums leading-tight" style={{ color: tone ?? "var(--color-ink-strong)" }}>
        {value.toLocaleString("en-IN")}
      </p>
    </div>
  );
}

const when = (d: Date | string | null) => fmtDateTime(d) || "—";

export function TallyImportShell({ canImport = false, storageReady = true, history = [] }: { canImport?: boolean; storageReady?: boolean; history?: HistoryRow[] }) {
  const router = useRouter();
  const [selected, setSelected] = React.useState<TallyCategoryKey | null>(null);
  const category = CATEGORIES.find((c) => c.key === selected) ?? null;
  const [file, setFile] = React.useState<Loaded | null>(null);
  const [reading, setReading] = React.useState(false);
  const [fileError, setFileError] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [mapping, setMapping] = React.useState<TallyMapping>({});
  const [asOfDate, setAsOfDate] = React.useState("");
  const [direction, setDirection] = React.useState<TallyDirection | "">("");
  const [checked, setChecked] = React.useState<PlannedRow[] | null>(null);
  const [progress, setProgress] = React.useState<{ label: string; done: number; total: number } | null>(null);
  const [problem, setProblem] = React.useState<string | null>(null);
  const [includeAttention, setIncludeAttention] = React.useState(false);
  const [ackInvalid, setAckInvalid] = React.useState(false);
  const [confirming, setConfirming] = React.useState(false);
  const [result, setResult] = React.useState<HistoryRow | Awaited<ReturnType<typeof finishTallyImport>> | null>(null);
  const [details, setDetails] = React.useState<{ id: string; rows: Awaited<ReturnType<typeof getTallyBatchProblems>> } | null>(null);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const def = selected ? TALLY_CATEGORIES[selected] : null;
  const isOutstanding = def?.kind === "outstanding";
  const sample = React.useMemo(() => (file ? file.rows.slice(0, 50).map((r) => r.cells) : []), [file]);
  const problems = selected && file ? checkMapping(selected, mapping, file.headers, sample) : null;
  const mappingOk = problems ? mappingIsUsable(problems) : false;
  const settingsOk = !isOutstanding || (!!asOfDate && !!direction);
  const summary = checked ? summarize(checked, includeAttention) : null;
  const busy = progress !== null;
  const canRun = !!checked && !busy && summary!.ready > 0 && (summary!.invalid === 0 || ackInvalid);

  function resetChecks() {
    setChecked(null);
    setResult(null);
    setProblem(null);
    setAckInvalid(false);
    setIncludeAttention(false);
  }

  function choose(key: TallyCategoryKey) {
    setSelected(key === selected ? null : key);
    setFile(null);
    setMapping({});
    setFileError(null);
    resetChecks();
  }

  async function onFile(picked: File | undefined) {
    if (!picked || !selected) return;
    setFileError(null);
    setFile(null);
    resetChecks();
    setReading(true);
    try {
      const lib = await import("@/lib/tally/workbook");
      const bad = lib.checkTallyFile(picked.name, picked.size);
      if (bad) return setFileError(bad);
      const read = lib.readTallyBytes(picked.name, new Uint8Array(await picked.arrayBuffer()));
      if (!read.ok) return setFileError(read.error);
      const head = findHeaderRow(selected, read.grid);
      const headers = (read.grid[head] ?? []).map((h, i) => h.trim() || `Column ${i + 1}`);
      const rows = read.grid.slice(head + 1).map((cells, i) => ({ rowNo: head + i + 2, cells })).filter((r) => r.cells.some((c) => c.trim()));
      if (rows.length === 0) return setFileError("This file has headings but no data rows.");
      if (rows.length > TALLY_LIMITS.rows) return setFileError(`This file has more than ${TALLY_LIMITS.rows.toLocaleString("en-IN")} rows. Split it by financial year.`);
      const saved = await getSavedTallyMapping(selected).catch(() => null);
      setMapping(suggestMapping(selected, headers, rows.slice(0, 50).map((r) => r.cells), saved));
      setFile({ fileName: picked.name, sheet: read.sheet, hash: await lib.hashGrid(read.grid), headers, rows });
    } catch {
      setFileError("This file could not be read. It may be damaged.");
    } finally {
      setReading(false);
    }
  }

  function setField(key: string, value: string) {
    setMapping((m) => {
      const next = { ...m };
      if (value === "") delete next[key];
      else next[key] = Number(value);
      return next;
    });
    resetChecks();
  }

  const options = () => ({ asOfDate: asOfDate || null, direction: direction || null });
  const planLocally = () => planRows(selected!, file!.rows, mapping, { ...options(), today: new Date().toISOString().slice(0, 10) });
  /** Rows the plan ignores (Tally's total lines, blanks) are never sent or counted. */
  const liveRows = (plan: { rows: PlannedRow[] }) => {
    const keep = new Set(plan.rows.map((r) => r.rowNo));
    return file!.rows.filter((r) => keep.has(r.rowNo));
  };

  async function validate() {
    resetChecks();
    const plan = planLocally();
    const chunks = chunkRows(liveRows(plan), plan.rows);
    const all: PlannedRow[] = [];
    setProgress({ label: "Validating", done: 0, total: chunks.length });
    try {
      for (let i = 0; i < chunks.length; i++) {
        const res = await checkTallyChunk({ category: selected, mapping, rows: chunks[i], ...options() });
        if (!res.ok) return setProblem(res.error);
        all.push(...res.rows);
        setProgress({ label: "Validating", done: i + 1, total: chunks.length });
      }
      setChecked(all.sort((a, b) => a.rowNo - b.rowNo));
    } catch {
      setProblem("Validation could not finish. Nothing was changed. Please try again.");
    } finally {
      setProgress(null);
    }
  }

  async function runImport() {
    setConfirming(false);
    setProblem(null);
    const plan = planLocally();
    const rows = liveRows(plan);
    try {
      const started = await startTallyImport({ category: selected, fileName: file!.fileName, fileHash: file!.hash, sheetName: file!.sheet, headers: file!.headers, sample: file!.rows.slice(0, 50), mapping, totalRows: rows.length, ...options(), includeAttention, confirm: true });
      if (!started.ok) return setProblem(started.error);
      const done = new Set(started.doneRowNos);
      const chunks = chunkRows(rows.filter((r) => !done.has(r.rowNo)), plan.rows);
      setProgress({ label: "Importing", done: 0, total: chunks.length });
      for (let i = 0; i < chunks.length; i++) {
        let res = await importTallyChunk({ batchId: started.batchId, rows: chunks[i] }).catch(() => null);
        if (!res) res = await importTallyChunk({ batchId: started.batchId, rows: chunks[i] }).catch(() => null);
        if (!res) {
          setProblem("The connection dropped during the import. Upload the same file again to continue where it stopped: nothing will be imported twice.");
          break;
        }
        setProgress({ label: "Importing", done: i + 1, total: chunks.length });
      }
      const finished = await finishTallyImport(started.batchId);
      setResult(finished);
      if (finished.ok) {
        const b = finished.batch;
        fireToast({ message: b.status === "completed" ? `Imported ${b.importedRows.toLocaleString("en-IN")} rows.` : `Import finished with ${b.failedRows} rows not saved.`, type: b.status === "completed" ? "success" : "error" });
      }
      router.refresh();
    } catch {
      setProblem("The import stopped. Upload the same file again to continue: nothing will be imported twice.");
    } finally {
      setProgress(null);
    }
  }

  async function showDetails(id: string) {
    if (details?.id === id) return setDetails(null);
    setDetails({ id, rows: await getTallyBatchProblems(id) });
  }

  const finished = result && "ok" in result && result.ok ? result.batch : null;
  const flagged = checked?.filter((r) => r.state !== "valid") ?? [];

  return (
    <div className="space-y-8">
      {!storageReady && (
        <div role="status" className="rounded-section px-5 py-4 text-ink-muted" style={{ fontSize: 14, background: "var(--color-amber-bg)", border: "1px solid color-mix(in srgb, var(--color-amber) 35%, transparent)" }}>
          <strong className="text-ink-strong">Not set up yet.</strong> Tally import needs database update 0122. You can read a file and check its columns, but nothing can be validated or imported until it is applied.
        </div>
      )}
      {!canImport && (
        <div role="note" className="rounded-section px-5 py-4 text-ink-muted" style={{ fontSize: 14, background: "var(--color-amber-bg)", border: "1px solid color-mix(in srgb, var(--color-amber) 35%, transparent)" }}>
          <strong className="text-ink-strong">View only.</strong> Validating and importing need the &ldquo;Tally Data Import — Upload and import&rdquo; permission, which a super-admin grants in Field Permissions.
        </div>
      )}

      <section aria-labelledby="tally-category">
        <h2 id="tally-category" className="font-bold text-ink-strong" style={{ fontSize: 17 }}>
          1 · What are you importing?
        </h2>
        <div className="mt-3 grid grid-cols-3 max-lg:grid-cols-2 max-sm:grid-cols-1 gap-3">
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            const on = c.key === selected;
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={on}
                onClick={() => choose(c.key)}
                className="rounded-section bg-surface-card p-4 text-left transition-transform hover:-translate-y-0.5"
                style={{ ...CARD_STYLE, border: on ? "1.5px solid #BE123C" : CARD_STYLE.border }}
              >
                <div className="flex items-start gap-3">
                  <span aria-hidden className="grid place-items-center rounded-xl shrink-0" style={{ width: 38, height: 38, background: "#FDF2F6", color: "#B8325F" }}>
                    <Icon size={18} strokeWidth={2.2} />
                  </span>
                  <span className="min-w-0">
                    <span className="block font-bold text-ink-strong" style={{ fontSize: 14.5 }}>
                      {c.label}
                    </span>
                    <span className="block mt-0.5 text-ink-muted" style={{ fontSize: 12.5 }}>
                      {c.hint}
                    </span>
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="tally-upload">
        <h2 id="tally-upload" className="font-bold text-ink-strong" style={{ fontSize: 17 }}>
          2 · Upload the export
        </h2>
        <div className="mt-3 rounded-section bg-surface-card p-6" style={CARD_STYLE}>
          <div
            className="rounded-xl px-6 py-10 text-center"
            style={{ border: `2px dashed ${dragging ? "#BE123C" : "var(--color-hairline)"}`, background: "var(--color-surface-soft)" }}
            onDragOver={(e) => {
              e.preventDefault();
              if (selected) setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              void onFile(e.dataTransfer.files[0]);
            }}
          >
            <UploadCloud size={34} strokeWidth={1.8} className="mx-auto text-ink-subtle" aria-hidden />
            <p className="mt-3 font-bold text-ink-strong" style={{ fontSize: 15 }}>
              {category ? `Upload file for ${category.label}` : "Choose a category above, then upload its export"}
            </p>
            <p className="mt-1 text-ink-muted" style={{ fontSize: 13 }}>
              Drag and drop a file here, or choose one from your computer. Uploading only reads it: nothing is imported yet.
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.csv"
              aria-label="Tally export file"
              className="hidden"
              onChange={(e) => {
                void onFile(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <div className="mt-4">
              <button type="button" disabled={!selected || reading} onClick={() => inputRef.current?.click()} className={PRIMARY} style={PRIMARY_STYLE}>
                {reading ? "Reading…" : "Upload file"}
              </button>
            </div>
            {fileError && (
              <p role="alert" className="mt-3 text-[13px] font-semibold text-[#B91C1C]">
                {fileError}
              </p>
            )}
            {file && (
              <p role="status" className="mt-3 text-[13px] font-semibold text-ink-strong">
                {file.fileName} · {file.rows.length.toLocaleString("en-IN")} rows · sheet {file.sheet}
              </p>
            )}
          </div>

          <dl className="mt-5 grid grid-cols-3 max-md:grid-cols-1 gap-4" style={{ fontSize: 13 }}>
            <div className="flex items-start gap-2.5">
              <FileSpreadsheet size={17} className="mt-0.5 shrink-0 text-ink-subtle" aria-hidden />
              <div>
                <dt className="font-bold text-ink-strong">Formats</dt>
                <dd className="text-ink-muted">Excel (.xlsx) or CSV (.csv), exported from Tally.</dd>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <FileText size={17} className="mt-0.5 shrink-0 text-ink-subtle" aria-hidden />
              <div>
                <dt className="font-bold text-ink-strong">Layout</dt>
                <dd className="text-ink-muted">One record per row. Titles above the headings and total rows are handled.</dd>
              </div>
            </div>
            <div className="flex items-start gap-2.5">
              <FileInput size={17} className="mt-0.5 shrink-0 text-ink-subtle" aria-hidden />
              <div>
                <dt className="font-bold text-ink-strong">Limits</dt>
                <dd className="text-ink-muted">
                  Up to {TALLY_LIMITS.fileBytes / (1024 * 1024)} MB and {TALLY_LIMITS.rows.toLocaleString("en-IN")} rows per file. Use one file per financial year for larger histories.
                </dd>
              </div>
            </div>
          </dl>
        </div>
      </section>

      <section aria-labelledby="tally-after">
        <h2 id="tally-after" className="font-bold text-ink-strong" style={{ fontSize: 17 }}>
          3 · Review and import
        </h2>

        {file && def && (
          <div className="mt-3 grid gap-4">
            <div className="rounded-section bg-surface-card p-5" style={CARD_STYLE}>
              <h3 className="font-bold text-ink-strong" style={{ fontSize: 15 }}>
                File preview
              </h3>
              <div className="mt-2 overflow-x-auto">
                <table aria-label="File preview" className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-left text-ink-subtle">
                      <th className="px-2 py-1 font-semibold">Row</th>
                      {file.headers.map((h, i) => (
                        <th key={i} className="whitespace-nowrap px-2 py-1 font-semibold">
                          {h}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {file.rows.slice(0, 8).map((r) => (
                      <tr key={r.rowNo} className="border-t border-hairline">
                        <td className="px-2 py-1 tabular-nums text-ink-subtle">{r.rowNo}</td>
                        {file.headers.map((_, i) => (
                          <td key={i} className="whitespace-nowrap px-2 py-1 text-ink-strong">
                            {r.cells[i] ?? ""}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="rounded-section bg-surface-card p-5" style={CARD_STYLE}>
              <h3 className="font-bold text-ink-strong" style={{ fontSize: 15 }}>
                Column mapping
              </h3>
              <p className="mt-1 text-[13px] text-ink-muted">Going to: {def.destination}. Suggestions come from the headings and your last import; correct anything that looks wrong.</p>
              {isOutstanding && (
                <div className="mt-3 flex flex-wrap gap-3">
                  <label className="grid gap-1 text-[12.5px] font-semibold text-ink-muted">
                    Balances as of
                    <DateField aria-label="Balances as of" className={FIELD} value={asOfDate} onChange={(v) => (setAsOfDate(v), resetChecks())} />
                  </label>
                  <label className="grid gap-1 text-[12.5px] font-semibold text-ink-muted">
                    These are
                    <select aria-label="Direction" className={FIELD} value={direction} onChange={(e) => (setDirection(e.target.value as TallyDirection | ""), resetChecks())}>
                      <option value="">Choose…</option>
                      <option value="receivable">Receivable (customers owe us)</option>
                      <option value="payable">Payable (we owe vendors)</option>
                    </select>
                  </label>
                </div>
              )}
              <div className="mt-3 grid grid-cols-2 max-md:grid-cols-1 gap-x-6 gap-y-2">
                {def.fields.map((field) => (
                  <label key={field.key} className="flex items-center justify-between gap-3 text-[13px] text-ink-strong">
                    <span>
                      {field.label}
                      {field.required && <span className="ml-1 font-bold text-[#B91C1C]">*</span>}
                    </span>
                    <select aria-label={field.label} className={`${FIELD} w-[210px]`} value={mapping[field.key] ?? ""} onChange={(e) => setField(field.key, e.target.value)}>
                      <option value="">{field.required ? "Choose a column…" : "Not imported"}</option>
                      {file.headers.map((h, i) => (
                        <option key={i} value={i}>
                          {h}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              {problems && !mappingOk && (
                <ul role="alert" className="mt-3 list-disc pl-5 text-[13px] font-semibold text-[#B91C1C]">
                  {problems.missingRequired.map((f) => (
                    <li key={f.key}>{f.label} is required and has no column.</li>
                  ))}
                  {problems.duplicated.map((c) => (
                    <li key={c}>&ldquo;{c}&rdquo; is mapped to more than one field.</li>
                  ))}
                  {problems.incompatible.map((p) => (
                    <li key={p.field.key}>
                      &ldquo;{p.column}&rdquo; doesn&apos;t look like {p.field.label}.
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-4">
                <button type="button" disabled={!canImport || !storageReady || !mappingOk || !settingsOk || busy} onClick={validate} className={PRIMARY} style={PRIMARY_STYLE}>
                  Validate
                </button>
              </div>
            </div>
          </div>
        )}

        {progress && (
          <p role="status" className="mt-3 flex items-center gap-2 text-[13px] font-semibold text-ink-strong">
            <Loader2 size={15} className="animate-spin" aria-hidden />
            {progress.label}… part {progress.done} of {progress.total}
          </p>
        )}
        {problem && (
          <p role="alert" className="mt-3 text-[13px] font-semibold text-[#B91C1C]">
            {problem}
          </p>
        )}

        {summary && (
          <div className="mt-4 rounded-section bg-surface-card p-5" style={CARD_STYLE}>
            <h3 className="font-bold text-ink-strong" style={{ fontSize: 15 }}>
              Validation summary
            </h3>
            <div className="mt-2 grid grid-cols-6 max-md:grid-cols-3 gap-2">
              <Tile label="Total rows" value={summary.total} />
              <Tile label="Valid" value={summary.valid} tone="#047857" />
              <Tile label="Invalid" value={summary.invalid} tone="#B91C1C" />
              <Tile label="Duplicate" value={summary.duplicate} />
              <Tile label="Attention" value={summary.attention} tone="#B45309" />
              <Tile label="Ready" value={summary.ready} tone="#047857" />
            </div>
            {flagged.length > 0 && (
              <div className="mt-3 max-h-[280px] overflow-y-auto">
                <table aria-label="Rows to review" className="w-full text-[12.5px]">
                  <thead>
                    <tr className="text-left text-ink-subtle">
                      <th className="px-2 py-1 font-semibold">Row</th>
                      <th className="px-2 py-1 font-semibold">Result</th>
                      <th className="px-2 py-1 font-semibold">Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {flagged.slice(0, 500).map((r) => (
                      <tr key={r.rowNo} className="border-t border-hairline align-top">
                        <td className="px-2 py-1 tabular-nums">{r.rowNo}</td>
                        <td className="whitespace-nowrap px-2 py-1 font-semibold">{STATE_LABEL[r.state]}</td>
                        <td className="px-2 py-1 text-ink-muted">{r.messages.join(" ")}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {flagged.length > 500 && <p className="mt-1 text-[12.5px] text-ink-subtle">Showing the first 500 of {flagged.length.toLocaleString("en-IN")} rows.</p>}
            {summary.attention > 0 && (
              <label className="mt-3 flex items-center gap-2 text-[13px] text-ink-strong">
                <input type="checkbox" checked={includeAttention} onChange={(e) => setIncludeAttention(e.target.checked)} />
                Also import the {summary.attention} rows that need attention
              </label>
            )}
            {summary.invalid > 0 && (
              <label className="mt-2 flex items-center gap-2 text-[13px] text-ink-strong">
                <input type="checkbox" checked={ackInvalid} onChange={(e) => setAckInvalid(e.target.checked)} />
                Don&apos;t import the {summary.invalid} invalid rows; record them as rejected in the history
              </label>
            )}
          </div>
        )}

        {finished && (
          <div className="mt-4 rounded-section bg-surface-card p-5" style={CARD_STYLE}>
            <h3 className="font-bold text-ink-strong" style={{ fontSize: 15 }}>
              Record counts
            </h3>
            <p className="mt-1 text-[12.5px] text-ink-muted">From the database, for this import ({finished.status}).</p>
            <div className="mt-2 grid grid-cols-5 max-md:grid-cols-2 gap-2">
              <Tile label="Rows read" value={finished.totalRows} />
              <Tile label="Accepted" value={finished.importedRows + finished.skippedRows} />
              <Tile label="Rejected" value={finished.rejectedRows} tone="#B91C1C" />
              <Tile label="Skipped" value={finished.skippedRows} />
              <Tile label="Imported" value={finished.importedRows} tone="#047857" />
            </div>
            {finished.failedRows > 0 && <p className="mt-2 text-[13px] font-semibold text-[#B91C1C]">{finished.failedRows} rows were not saved. Upload the same file again to retry only those.</p>}
          </div>
        )}

        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button type="button" disabled={!canRun} onClick={() => setConfirming(true)} className={PRIMARY} style={PRIMARY_STYLE}>
            Import
          </button>
          <span className="text-ink-subtle" style={{ fontSize: 12.5 }}>
            {checked ? "Nothing is written until you confirm." : "Enabled once the file has been validated."}
          </span>
        </div>

        <div className="mt-6 rounded-section bg-surface-card p-5" style={CARD_STYLE}>
          <h3 className="font-bold text-ink-strong" style={{ fontSize: 15 }}>
            Import history
          </h3>
          <div className="mt-2 overflow-x-auto">
            <table aria-label="Import history" className="w-full text-[12.5px]" style={{ minWidth: 980 }}>
              <thead>
                <tr className="text-left text-ink-subtle">
                  {["Batch", "File", "Category", "Period", "Uploaded by", "Uploaded", "Total", "Imported", "Skipped", "Failed", "Status", "Completed", ""].map((h) => (
                    <th key={h} className="px-2 py-1 font-semibold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.length === 0 && (
                  <tr className="border-t border-hairline">
                    <td colSpan={13} className="px-2 py-3 text-ink-subtle">
                      No imports yet.
                    </td>
                  </tr>
                )}
                {history.map((b) => (
                  <React.Fragment key={b.id}>
                    <tr className="border-t border-hairline">
                      <td className="px-2 py-1 font-mono text-[11.5px]" title={b.id}>
                        <Link href={`/forms/tally-import/batches/${b.id}` as Route} className="font-bold text-[#0B4FB8] underline-offset-2 hover:underline" aria-label={`Open batch ${b.id.slice(0, 8)}`}>
                          {b.id.slice(0, 8)}
                        </Link>
                      </td>
                      <td className="px-2 py-1">{b.fileName}</td>
                      <td className="px-2 py-1">{TALLY_CATEGORIES[b.category as TallyCategoryKey]?.label ?? b.category}</td>
                      <td className="whitespace-nowrap px-2 py-1">
                        {b.financialYears.length ? b.financialYears.join(", ") : b.asOfDate ? `As of ${fmtDate(b.asOfDate)}` : "—"}
                        {b.isHistorical ? " · historical" : ""}
                      </td>
                      <td className="px-2 py-1">{b.uploadedBy ?? "—"}</td>
                      <td className="whitespace-nowrap px-2 py-1">{when(b.createdAt)}</td>
                      <td className="px-2 py-1 tabular-nums">{b.totalRows}</td>
                      <td className="px-2 py-1 tabular-nums">{b.importedRows}</td>
                      <td className="px-2 py-1 tabular-nums">{b.skippedRows}</td>
                      <td className="px-2 py-1 tabular-nums">{b.rejectedRows + b.failedRows}</td>
                      <td className="px-2 py-1 font-semibold">{b.status}</td>
                      <td className="whitespace-nowrap px-2 py-1">{when(b.completedAt)}</td>
                      <td className="px-2 py-1">
                        <button type="button" className="font-bold text-[#0B4FB8]" onClick={() => showDetails(b.id)}>
                          Details
                        </button>
                      </td>
                    </tr>
                    {details?.id === b.id && (
                      <tr>
                        <td colSpan={13} className="px-2 py-2 text-ink-muted">
                          {details.rows.length === 0 ? "Every row imported." : details.rows.map((r) => <p key={r.rowNo}>Row {r.rowNo} · {r.status}: {r.reason}</p>)}
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <CenterDialog
        open={confirming}
        title="Import these records?"
        accentBar={FORMS_ACCENT_BAR}
        subtitle={file?.fileName}
        width={480}
        onClose={() => setConfirming(false)}
        footer={
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setConfirming(false)} className="h-9 rounded-lg border border-hairline-strong bg-white px-4 text-[13.5px] font-semibold text-ink-strong">
              Cancel
            </button>
            <button type="button" onClick={runImport} className="h-9 rounded-lg px-4 text-[13.5px] font-semibold text-white" style={{ background: FORMS_ACCENT }}>
              Confirm import
            </button>
          </div>
        }
      >
        <p className="text-[14px] text-ink-strong">
          {summary?.ready.toLocaleString("en-IN")} rows will be imported into {def?.destination}. Existing records are never overwritten, and imported records can&apos;t be removed from this page.
        </p>
      </CenterDialog>
    </div>
  );
}
