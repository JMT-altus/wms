"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, UploadCloud, XCircle } from "lucide-react";
import type { WorkBook } from "xlsx";
import {
  FIELD_LABELS,
  type ColumnMapping,
  type MasterField,
  type ReadSheet,
  type SheetColumn,
} from "@/lib/collections/master/workbook";
import type { PlannedRow, RowStatus } from "@/lib/collections/master/plan";
import {
  importCollectionMaster,
  previewCollectionMaster,
  type MasterImportResult,
  type MasterPreview,
} from "@/app/(forms-module)/forms/collection/master/actions";

/**
 * Collection Master — upload, map, preview, confirm.
 *
 * The file is read in this browser. Nothing is written until the admin has seen
 * the server's preview and confirmed; changes to companies already stored are
 * applied only for the rows the admin ticks. A column with no header is never
 * mapped automatically, and mapping one needs an explicit confirmation.
 */

const CARD = "rounded-xl bg-white p-4 max-md:p-3";
const LINE = { border: "1px solid #DCE4F0" } as const;
const BTN = "inline-flex h-9 items-center justify-center gap-2 rounded-lg px-4 text-[13.5px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY = { background: "#0A6CFF", color: "#fff" } as const;
const MUTED = { background: "#EEF0F3", color: "#8A93A0" } as const;
const SELECT = "h-9 w-full rounded-lg border border-hairline-strong bg-white px-2.5 text-[13px] font-semibold text-ink-strong";
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const PAGE = 50;

const FIELDS: MasterField[] = ["company", "coordinator", "paymentTerms"];

const STATUS_LABEL: Record<RowStatus, string> = {
  new: "New",
  unchanged: "Unchanged",
  changed: "Changed",
  duplicate: "Duplicate",
  rejected: "Rejected",
};
const STATUS_TONE: Record<RowStatus, { bg: string; fg: string }> = {
  new: { bg: "#ECFDF5", fg: "#047857" },
  unchanged: { bg: "#F1F5F9", fg: "#475569" },
  changed: { bg: "#FFFBEB", fg: "#B45309" },
  duplicate: { bg: "#EEF4FF", fg: "#0B4FB8" },
  rejected: { bg: "#FEF2F2", fg: "#B91C1C" },
};

function Step({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink-strong">
      <span className="inline-flex size-6 items-center justify-center rounded-full text-[12px] font-bold" style={{ background: "#EEF4FF", color: "#0B4FB8" }}>
        {n}
      </span>
      {children}
    </h2>
  );
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-lg px-3 py-2" style={{ border: "1px solid #E6ECF5", background: "#FAFCFF" }}>
      <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-subtle">{label}</p>
      <p className="text-[20px] font-extrabold tabular-nums leading-tight" style={{ color: tone ?? "#1E293B" }}>
        {value}
      </p>
    </div>
  );
}

export function CollectionMasterImport({ storageReady }: { storageReady: boolean }) {
  const router = useRouter();
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [wb, setWb] = React.useState<WorkBook | null>(null);
  const [read, setRead] = React.useState<ReadSheet | null>(null);
  const [mapping, setMapping] = React.useState<ColumnMapping>({ company: null, coordinator: null, paymentTerms: null });
  /** Why the Sales Coordinator column was (or wasn't) picked automatically. */
  const [coordinatorHint, setCoordinatorHint] = React.useState<string | null>(null);
  const [unnamedOk, setUnnamedOk] = React.useState<Record<MasterField, boolean>>({ company: false, coordinator: false, paymentTerms: false });
  const [readError, setReadError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<MasterPreview | null>(null);
  const [accept, setAccept] = React.useState<Set<number>>(new Set());
  const [confirmed, setConfirmed] = React.useState(false);
  const [busy, setBusy] = React.useState<"check" | "import" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<MasterImportResult | null>(null);
  const [filter, setFilter] = React.useState<RowStatus | "all">("all");
  const [page, setPage] = React.useState(0);

  const lib = () => import("@/lib/collections/master/workbook");

  function resetPreview() {
    setPreview(null);
    setAccept(new Set());
    setConfirmed(false);
    setError(null);
    setResult(null);
    setPage(0);
  }

  async function load(book: WorkBook, sheet: string, headerRow?: number) {
    const w = await lib();
    const r = w.readSheet(book, sheet, headerRow);
    setRead(r);
    // Header text first; for a blank header, the coordinator column is suggested
    // from its contents (configurable rules) — an unnamed column still needs the
    // confirmation tick below before anything is imported from it.
    const auto = w.autoMap(r.columns);
    const hint = w.suggestCoordinatorColumn(r, auto);
    setMapping({ ...auto, coordinator: hint.index });
    setCoordinatorHint(hint.reason);
    setUnnamedOk({ company: false, coordinator: false, paymentTerms: false });
    resetPreview();
  }

  async function onFile(file: File | undefined) {
    setReadError(null);
    setRead(null);
    setWb(null);
    resetPreview();
    if (!file) {
      setFileName(null);
      return;
    }
    setFileName(file.name);
    if (!/\.(xlsx|xls|csv)$/i.test(file.name)) {
      setReadError("Choose an Excel (.xlsx, .xls) or CSV (.csv) file.");
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setReadError("This file is larger than 10 MB.");
      return;
    }
    try {
      const w = await lib();
      const book = w.readWorkbook(/\.csv$/i.test(file.name) ? await file.text() : await file.arrayBuffer());
      const first = book.SheetNames[0];
      if (!first) {
        setReadError("The workbook has no sheets.");
        return;
      }
      setWb(book);
      await load(book, first);
    } catch {
      setReadError("This file could not be read. Is it a valid Excel or CSV file?");
    }
  }

  const columns = read?.columns ?? [];
  const colOf = (i: number | null) => columns.find((c) => c.index === i) ?? null;
  // Same rule as the server: the coordinator column always, and any column without a header.
  const unnamedMapped = FIELDS.filter((f) => {
    const c = colOf(mapping[f]);
    return !!c && (f === "coordinator" || c.header === null);
  });
  const notImported: SheetColumn[] = columns.filter((c) => !Object.values(mapping).includes(c.index) && c.filled > 0);
  const canCheck = !!read && mapping.company !== null && unnamedMapped.every((f) => unnamedOk[f]);

  async function payload() {
    const w = await lib();
    const rows = w.extractRows(read!, mapping);
    return {
      fileName: fileName ?? undefined,
      sheetName: read!.sheet,
      mapping: {
        company: colOf(mapping.company)!.label,
        coordinator: mapping.coordinator === null ? null : colOf(mapping.coordinator)!.label,
        paymentTerms: mapping.paymentTerms === null ? null : colOf(mapping.paymentTerms)!.label,
      },
      ignoredColumns: notImported.map((c) => ({ column: c.letter, header: c.header, filled: c.filled })),
      // Sent so the server can refuse an unconfirmed mapping; recorded in the import's audit row.
      confirmedColumns: Object.fromEntries(unnamedMapped.filter((f) => unnamedOk[f]).map((f) => [f, true as const])),
      rows,
    };
  }

  async function check() {
    setBusy("check");
    setError(null);
    setResult(null);
    try {
      const res = await previewCollectionMaster(await payload());
      if (!res.ok) setError(res.error);
      else {
        setPreview(res.preview);
        setAccept(new Set());
        setConfirmed(false);
        setPage(0);
        setFilter("all");
      }
    } catch {
      setError("The check failed. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function runImport() {
    setBusy("import");
    setError(null);
    try {
      const res = await importCollectionMaster({ ...(await payload()), acceptChanges: [...accept], confirm: confirmed ? true : undefined });
      if (!res.ok) setError(res.error);
      else {
        setResult(res.result);
        setPreview(null);
        router.refresh();
      }
    } catch {
      setError("The import did not complete. Preview again to see what was saved.");
    } finally {
      setBusy(null);
    }
  }

  const rowsShown = (preview?.rows ?? []).filter((r) => filter === "all" || r.status === filter);
  const pages = Math.max(1, Math.ceil(rowsShown.length / PAGE));
  const slice = rowsShown.slice(page * PAGE, page * PAGE + PAGE);
  const changedRows = (preview?.rows ?? []).filter((r) => r.status === "changed");
  const willWrite = (preview?.summary.new ?? 0) + accept.size;
  const canImport = !!preview && preview.storageReady && storageReady && confirmed && willWrite > 0 && busy === null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      {!storageReady && (
        <p role="status" className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-[13px] font-semibold" style={{ background: "#FFFBEB", border: "1px solid #FCD9A0", color: "#92400E" }}>
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
          Collection Master storage isn&apos;t set up yet (migration 0112 is pending). You can read a file and preview it, but importing is disabled.
        </p>
      )}

      <section className={CARD} style={LINE} aria-labelledby="cm-file">
        <Step n={1}>
          <span id="cm-file">Choose the company master file</span>
        </Step>
        <label htmlFor="cm-input" className="mt-3 flex cursor-pointer items-center gap-3 rounded-lg px-4 py-3" style={{ border: "1.5px dashed #BFD0EA", background: "#F8FAFF" }}>
          <UploadCloud size={22} strokeWidth={1.8} className="shrink-0 text-[#0A6CFF]" aria-hidden />
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-bold text-ink-strong">{fileName ?? "Select a file"}</span>
            <span className="block text-[12.5px] text-ink-muted">Excel (.xlsx, .xls) or CSV · read in your browser</span>
          </span>
          <input id="cm-input" type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        {readError && (
          <p role="alert" className="mt-2 flex items-start gap-2 text-[13px] font-semibold text-[#B91C1C]">
            <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden /> {readError}
          </p>
        )}
        {wb && read && (
          <div className="mt-3 flex flex-wrap items-end gap-3 text-[13px]">
            {wb.SheetNames.length > 1 && (
              <label className="block">
                <span className="mb-1 block text-[12px] font-bold text-ink-soft">Worksheet</span>
                <select aria-label="Worksheet" className={SELECT} value={read.sheet} onChange={(e) => void load(wb, e.target.value)}>
                  {wb.SheetNames.map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
            )}
            <label className="block">
              <span className="mb-1 block text-[12px] font-bold text-ink-soft">Header row</span>
              <input
                type="number"
                min={read.origin + 1}
                aria-label="Header row"
                className="h-9 w-24 rounded-lg border border-hairline-strong px-2.5 text-[13px] font-semibold"
                value={read.origin + read.headerRow + 1}
                onChange={(e) => {
                  const n = Math.max(read.origin + 1, Math.floor(Number(e.target.value) || 1));
                  void load(wb, read.sheet, Math.min(n - 1 - read.origin, Math.max(0, read.rows.length - 1)));
                }}
              />
            </label>
            <p className="text-[12.5px] text-ink-subtle">{columns.length} column{columns.length === 1 ? "" : "s"} found.</p>
          </div>
        )}
      </section>

      {read && (
        <section className={CARD} style={LINE} aria-labelledby="cm-map">
          <Step n={2}>
            <span id="cm-map">Map the columns</span>
          </Step>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            Only these three fields are imported. Columns without a header are never picked automatically.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {FIELDS.map((f) => (
              <label key={f} className="block">
                <span className="mb-1 block text-[12px] font-bold text-ink-soft">
                  {FIELD_LABELS[f]}
                  {f === "company" ? " (required)" : ""}
                </span>
                <select
                  aria-label={FIELD_LABELS[f]}
                  className={SELECT}
                  value={mapping[f] ?? ""}
                  onChange={(e) => {
                    const v = e.target.value === "" ? null : Number(e.target.value);
                    setMapping((m) => {
                      const next = { ...m };
                      for (const k of FIELDS) if (k !== f && next[k] === v && v !== null) next[k] = null;
                      next[f] = v;
                      return next;
                    });
                    setUnnamedOk((u) => ({ ...u, [f]: false }));
                    if (f === "coordinator") setCoordinatorHint(v === null ? null : "Chosen by you.");
                    resetPreview();
                  }}
                >
                  <option value="">{f === "company" ? "Choose a column…" : "— Not in this file —"}</option>
                  {columns.map((c) => (
                    <option key={c.index} value={c.index}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          {coordinatorHint && (
            <p className="mt-2 text-[12.5px] text-ink-muted">
              <strong className="text-ink-soft">Sales Coordinator:</strong> {coordinatorHint}
            </p>
          )}

          {unnamedMapped.map((f) => {
            const c = colOf(mapping[f])!;
            return (
              <label key={f} className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-[13px]" style={{ background: "#FFFBEB", border: "1px solid #FCD9A0" }}>
                <input type="checkbox" className="mt-0.5 size-4" checked={unnamedOk[f]} onChange={(e) => setUnnamedOk((u) => ({ ...u, [f]: e.target.checked }))} />
                <span>
                  {c.header === null ? (
                    <>
                      <strong>{c.label}</strong> has no header.{" "}
                    </>
                  ) : null}
                  I confirm <strong>{c.label}</strong> holds the <strong>{FIELD_LABELS[f]}</strong>
                  {f === "coordinator" ? " for every company in this file" : ""}
                  {c.topValues.length > 0 ? ` (e.g. ${c.topValues.slice(0, 3).map((v) => v.value).join(", ")})` : ""}.
                </span>
              </label>
            );
          })}

          {notImported.length > 0 && (
            <div className="mt-3 rounded-lg px-3 py-2.5" style={{ border: "1px solid #E6ECF5", background: "#FAFCFF" }}>
              <p className="flex items-center gap-2 text-[12.5px] font-bold text-ink-soft">
                <FileSpreadsheet size={14} aria-hidden /> Not imported — shown so nothing is silently dropped
              </p>
              <ul className="mt-1.5 grid gap-1.5">
                {notImported.map((c) => (
                  <li key={c.index} className="text-[12.5px] text-ink-muted">
                    <strong className="text-ink-strong">{c.label}</strong> — {c.filled} filled cell{c.filled === 1 ? "" : "s"}, {c.distinctValues} distinct value
                    {c.distinctValues === 1 ? "" : "s"}
                    {c.topValues.length > 0 && (
                      <span className="ml-1">
                        : {c.topValues.map((v) => `${v.value} (${v.count})`).join(", ")}
                        {c.distinctValues > c.topValues.length ? ", …" : ""}
                      </span>
                    )}
                    {c.header === null && <span className="ml-1 font-semibold text-[#B45309]">· meaning unconfirmed</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" className={BTN} style={canCheck && !busy ? PRIMARY : MUTED} disabled={!canCheck || busy !== null} onClick={() => void check()}>
              {busy === "check" && <Loader2 size={15} className="animate-spin" aria-hidden />}
              Preview import
            </button>
            {!canCheck && (
              <span className="text-[12.5px] text-ink-subtle">
                {mapping.company === null ? "Choose the company name column." : "Confirm the highlighted column mapping first."}
              </span>
            )}
          </div>
          {error && !preview && (
            <p role="alert" className="mt-2 flex items-start gap-2 text-[13px] font-semibold text-[#B91C1C]">
              <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden /> {error}
            </p>
          )}
        </section>
      )}

      {preview && (
        <section className={CARD} style={LINE} aria-labelledby="cm-preview">
          <Step n={3}>
            <span id="cm-preview">Preview (nothing has been saved)</span>
          </Step>
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Tile label="New" value={preview.summary.new} tone="#047857" />
            <Tile label="Unchanged" value={preview.summary.unchanged} />
            <Tile label="Changed" value={preview.summary.changed} tone={preview.summary.changed ? "#B45309" : undefined} />
            <Tile label="Duplicates" value={preview.summary.duplicate} tone={preview.summary.duplicate ? "#0B4FB8" : undefined} />
            <Tile label="Rejected" value={preview.summary.rejected} tone={preview.summary.rejected ? "#B91C1C" : undefined} />
          </div>
          <p className="mt-2 text-[12.5px] text-ink-muted tabular-nums">
            {preview.summary.rows} rows · {preview.summary.newWithoutCoordinator} new without a coordinator · {preview.summary.placeholderCoordinators} placeholder coordinators (XXX / -) treated as Unassigned ·{" "}
            {preview.summary.newWithoutPaymentTerms} new without payment terms · {preview.summary.conflictGroups} conflicting duplicate group{preview.summary.conflictGroups === 1 ? "" : "s"}
          </p>
          {preview.summary.coordinatorLabels.length > 0 && (
            <div className="mt-2 rounded-lg px-3 py-2 text-[12.5px]" style={{ border: "1px solid #E6ECF5", background: "#FAFCFF" }}>
              <p className="font-bold text-ink-soft">Sales Coordinators in this file (taken as each company&apos;s collection person)</p>
              <p className="mt-0.5 text-ink-muted">{preview.summary.coordinatorLabels.map((c) => `${c.label} (${c.rows})`).join(" · ")}</p>
              {preview.summary.newCoordinatorLabels.length > 0 && (
                <p className="mt-1 font-semibold text-[#B45309]">
                  Not yet in the Collection Master — check these are real people before importing: {preview.summary.newCoordinatorLabels.join(", ")}
                </p>
              )}
              {preview.summary.coordinatorSpellingsUnified > 0 && (
                <p className="mt-1 text-ink-muted">
                  {preview.summary.coordinatorSpellingsUnified} row{preview.summary.coordinatorSpellingsUnified === 1 ? "" : "s"} wrote a coordinator in another capitalisation; shown in one spelling per person.
                </p>
              )}
              {preview.summary.invalidCoordinators > 0 && (
                <p className="mt-1 font-semibold text-[#B91C1C]">
                  {preview.summary.invalidCoordinators} coordinator cell{preview.summary.invalidCoordinators === 1 ? " isn't a name" : "s aren't names"} (no letters) — imported as Unassigned; see the rows marked below.
                </p>
              )}
            </div>
          )}
          {!preview.storageReady && (
            <p role="status" className="mt-2 text-[12.5px] font-semibold text-[#92400E]">
              Collection Master storage isn&apos;t set up in this database (migration 0112 hasn&apos;t been applied), so companies already stored can&apos;t be
              recognised — every row shows as New — and nothing can be imported.
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12.5px]">
            {(["all", "new", "changed", "unchanged", "duplicate", "rejected"] as const).map((s) => {
              const n = s === "all" ? preview.rows.length : preview.rows.filter((r) => r.status === s).length;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => {
                    setFilter(s);
                    setPage(0);
                  }}
                  className="rounded-full px-2.5 py-0.5 font-bold"
                  style={filter === s ? { background: "#0A6CFF", color: "#fff" } : { background: "#EEF4FF", color: "#0B4FB8" }}
                >
                  {s === "all" ? "All" : STATUS_LABEL[s]} ({n})
                </button>
              );
            })}
            {changedRows.length > 0 && (
              <label className="ml-auto flex items-center gap-1.5 font-semibold text-ink-soft">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={accept.size === changedRows.length}
                  onChange={(e) => setAccept(e.target.checked ? new Set(changedRows.map((r) => r.rowNo)) : new Set())}
                />
                Accept all {changedRows.length} change{changedRows.length === 1 ? "" : "s"}
              </label>
            )}
          </div>

          <div className="mt-2 max-h-[460px] overflow-auto rounded-lg" style={{ border: "1px solid #E6ECF5" }}>
            <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
              <thead className="sticky top-0" style={{ background: "#F5F7FB" }}>
                <tr className="text-left text-ink-soft">
                  {/* Business data: Company, Sales Coordinator, Payment Terms — the only fields imported. */}
                  {["Row", "Company", "Sales Coordinator", "Payment Terms", "Status", "Notes"].map((h) => (
                    <th key={h} className="px-3 py-1.5 font-bold">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slice.map((r) => (
                  <PreviewRow
                    key={r.rowNo}
                    r={r}
                    accepted={accept.has(r.rowNo)}
                    onAccept={(on) =>
                      setAccept((s) => {
                        const n = new Set(s);
                        if (on) n.add(r.rowNo);
                        else n.delete(r.rowNo);
                        return n;
                      })
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <div className="mt-2 flex items-center justify-end gap-2 text-[12.5px]">
              <button type="button" disabled={page === 0} onClick={() => setPage(page - 1)} className="h-8 rounded-lg border border-hairline-strong px-3 font-semibold disabled:opacity-40">
                Previous
              </button>
              <span className="tabular-nums text-ink-subtle">
                Page {page + 1} of {pages}
              </span>
              <button type="button" disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className="h-8 rounded-lg border border-hairline-strong px-3 font-semibold disabled:opacity-40">
                Next
              </button>
            </div>
          )}

          <div className="mt-4 border-t border-hairline pt-3">
            <Step n={4}>Confirm</Step>
            <p className="mt-2 text-[13.5px] text-ink-strong">
              This will add <strong>{preview.summary.new}</strong> compan{preview.summary.new === 1 ? "y" : "ies"} and apply <strong>{accept.size}</strong> accepted change
              {accept.size === 1 ? "" : "s"}. {preview.summary.changed - accept.size} change{preview.summary.changed - accept.size === 1 ? "" : "s"} not accepted keep the stored values.
              Duplicates and rejected rows are skipped. Nothing is deleted, and no Client Master record is created or edited.
            </p>
            <label className="mt-2 flex items-start gap-2 text-[13px] text-ink-muted">
              <input type="checkbox" className="mt-0.5 size-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              I have reviewed the preview and the column mapping.
            </label>
            {error && (
              <p role="alert" className="mt-2 flex items-start gap-2 text-[13px] font-semibold text-[#B91C1C]">
                <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden /> {error}
              </p>
            )}
            <button type="button" className={`${BTN} mt-3`} style={canImport ? PRIMARY : MUTED} disabled={!canImport} onClick={() => void runImport()}>
              {busy === "import" && <Loader2 size={15} className="animate-spin" aria-hidden />}
              Import
            </button>
          </div>
        </section>
      )}

      {result && <ImportResult result={result} />}
    </div>
  );
}

function PreviewRow({ r, accepted, onAccept }: { r: PlannedRow; accepted: boolean; onAccept: (on: boolean) => void }) {
  const tone = STATUS_TONE[r.status];
  return (
    <tr className="border-t border-[#EEF1F6] align-top">
      <td className="px-3 py-1.5 tabular-nums text-ink-subtle">{r.rowNo}</td>
      <td className="px-3 py-1.5 font-semibold text-ink-strong">{r.companyName || <span className="text-ink-subtle">(blank)</span>}</td>
      <td className="px-3 py-1.5">{r.coordinatorLabel ?? <span className="text-ink-subtle">Unassigned</span>}</td>
      <td className="px-3 py-1.5">{r.paymentTerms ?? <span className="text-ink-subtle">—</span>}</td>
      <td className="px-3 py-1.5">
        <span className="rounded-full px-2 py-0.5 text-[11.5px] font-bold" style={{ background: tone.bg, color: tone.fg }}>
          {STATUS_LABEL[r.status]}
        </span>
      </td>
      <td className="px-3 py-1.5">
        {r.changes.map((c) => (
          <p key={c.field} className="font-semibold text-[#B45309]">
            {c.field === "coordinatorLabel" ? "Coordinator" : "Payment terms"}: {c.from ?? "—"} → {c.to ?? "—"}
          </p>
        ))}
        {r.messages.filter((m) => m.topic !== "client-master").map((m, i) => (
          <p key={i} style={{ color: m.level === "error" ? "#B91C1C" : m.level === "warning" ? "#B45309" : "#475569" }}>
            {m.text}
          </p>
        ))}
        {r.status === "changed" && (
          <label className="mt-1 flex items-center gap-1.5 font-semibold text-ink-strong">
            <input type="checkbox" className="size-4" checked={accepted} onChange={(e) => onAccept(e.target.checked)} aria-label={`Accept the change in row ${r.rowNo}`} />
            Accept this change
          </label>
        )}
      </td>
    </tr>
  );
}

const OUTCOME_LABEL: Record<MasterImportResult["rows"][number]["outcome"], string> = {
  inserted: "Added",
  updated: "Updated",
  unchanged: "Unchanged",
  "kept-existing": "Kept stored values",
  "skipped-duplicate": "Duplicate — skipped",
  rejected: "Rejected",
  "skipped-conflict": "Changed meanwhile — skipped",
};

function ImportResult({ result }: { result: MasterImportResult }) {
  const [all, setAll] = React.useState(false);
  const t = result.totals;
  const problems = result.rows.filter((r) => r.outcome === "rejected" || r.outcome === "skipped-conflict");
  const shown = all ? result.rows : problems;
  return (
    <section className={CARD} style={{ border: "1px solid #A7F3D0" }} aria-live="polite">
      <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink-strong">
        <CheckCircle2 size={18} className="text-[#059669]" aria-hidden /> Import finished
      </h2>
      <p className="mt-1 text-[12.5px] text-ink-subtle">
        Recorded as import <span className="font-mono">{result.importId}</span>.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Tile label="Added" value={t.inserted} tone="#047857" />
        <Tile label="Updated" value={t.updated} tone="#B45309" />
        <Tile label="Unchanged" value={t.unchanged} />
        <Tile label="Kept stored" value={t.keptExisting} />
        <Tile label="Duplicates" value={t.duplicates} />
        <Tile label="Rejected" value={t.rejected} tone={t.rejected ? "#B91C1C" : undefined} />
        <Tile label="Conflicts" value={t.conflicts} tone={t.conflicts ? "#B91C1C" : undefined} />
      </div>
      <div className="mt-3 flex items-center gap-3 text-[12.5px]">
        <span className="font-bold text-ink-soft">{all ? "All rows" : `Row-level problems (${problems.length})`}</span>
        <button type="button" className="font-bold text-[#0B4FB8] underline" onClick={() => setAll(!all)}>
          {all ? "Show problems only" : "Show all rows"}
        </button>
      </div>
      {shown.length > 0 && (
        <div className="mt-2 max-h-[320px] overflow-auto rounded-lg" style={{ border: "1px solid #E6ECF5" }}>
          <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
            <tbody>
              {shown.map((r) => (
                <tr key={r.rowNo} className="border-t border-[#EEF1F6] align-top">
                  <td className="px-3 py-1.5 tabular-nums text-ink-subtle">{r.rowNo}</td>
                  <td className="px-3 py-1.5 font-semibold">{r.companyName || "(blank)"}</td>
                  <td className="px-3 py-1.5">{OUTCOME_LABEL[r.outcome]}</td>
                  <td className="px-3 py-1.5 text-ink-muted">{r.message ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
