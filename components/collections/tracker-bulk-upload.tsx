"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Loader2, UploadCloud, XCircle } from "lucide-react";
import type { BalanceSheet } from "@/lib/collections/balances/workbook";
import type { BalanceRowStatus, PlannedBalanceRow } from "@/lib/collections/balances/plan";
import {
  importCollectionBalances,
  previewCollectionBalances,
  type BalanceImportResult,
  type BalancePreview,
} from "@/app/(forms-module)/forms/collection/tracker/bulk-actions";
// Paise are shown: a difference of a few paise must stay visible in the preview.
const inr2 = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatInr = (n: number) => inr2.format(n);

/**
 * Tracker Bulk Upload — Tally customer summary (Particulars / Debit / Credit).
 *
 * The file is read in this browser. Nothing is written until the person has seen
 * the server's preview — including exactly which earlier upload it replaces —
 * and confirmed. Only companies already in the Collection Master are matched;
 * none is ever created. Debit and Credit are shown as the file has them.
 */

const BTN = "inline-flex h-9 items-center justify-center gap-2 rounded-lg px-4 text-[13.5px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY = { background: "#0A6CFF", color: "#fff" } as const;
const MUTED = { background: "#EEF0F3", color: "#8A93A0" } as const;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const PAGE = 50;

const STATUS_LABEL: Record<BalanceRowStatus, string> = {
  matched: "Matched",
  unmatched: "Not in Master",
  duplicate: "Repeat (ignored)",
  conflict: "Conflicting duplicate",
  rejected: "Invalid",
};
const STATUS_TONE: Record<BalanceRowStatus, { bg: string; fg: string }> = {
  matched: { bg: "#ECFDF5", fg: "#047857" },
  unmatched: { bg: "#FFFBEB", fg: "#B45309" },
  duplicate: { bg: "#EEF4FF", fg: "#0B4FB8" },
  conflict: { bg: "#FEF2F2", fg: "#B91C1C" },
  rejected: { bg: "#FEF2F2", fg: "#B91C1C" },
};

const money = (n: number | null) => (n === null ? "—" : formatInr(n));
const day = (iso: string | null) => {
  if (!iso) return null;
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
};
const period = (from: string | null, to: string | null) => (from && to ? `${day(from)} to ${day(to)}` : "not printed in the file");

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

export function TrackerBulkUpload({ canImport, onClose }: { canImport: boolean; onClose: () => void }) {
  const router = useRouter();
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [sheet, setSheet] = React.useState<BalanceSheet | null>(null);
  /** The sheet's raw cells — the only thing sent to the server, which re-reads everything from them. */
  const [grid, setGrid] = React.useState<string[][] | null>(null);
  const [readError, setReadError] = React.useState<string | null>(null);
  const [preview, setPreview] = React.useState<BalancePreview | null>(null);
  const [confirmed, setConfirmed] = React.useState(false);
  const [busy, setBusy] = React.useState<"read" | "check" | "import" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<BalanceImportResult | null>(null);
  const [filter, setFilter] = React.useState<BalanceRowStatus | "all" | "negative">("all");
  const [page, setPage] = React.useState(0);

  if (!canImport) {
    return (
      <div>
        <p role="status" className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-[13.5px] font-semibold" style={{ background: "#FFFBEB", border: "1px solid #FCD9A0", color: "#92400E" }}>
          <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden />
          You don&apos;t have permission to upload balances. This needs the &ldquo;Collections — Import balances&rdquo; permission, which a super-admin grants in Field Permissions.
        </p>
        <div className="mt-4 flex justify-end">
          <button type="button" className={BTN} style={MUTED} onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    );
  }

  function resetPreview() {
    setPreview(null);
    setConfirmed(false);
    setError(null);
    setResult(null);
    setPage(0);
    setFilter("all");
  }

  async function onFile(file: File | undefined) {
    setReadError(null);
    setSheet(null);
    setGrid(null);
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
    setBusy("read");
    try {
      const lib = await import("@/lib/collections/balances/workbook");
      const isCsv = /\.csv$/i.test(file.name);
      const data = isCsv ? await file.text() : await file.arrayBuffer();
      const res = lib.readBalanceSheet(lib.readBalanceWorkbook(data));
      if (!res.ok) {
        setReadError(res.error);
        return;
      }
      const size = JSON.stringify(res.grid).length;
      if (size > lib.GRID_LIMITS.jsonBytes || res.grid.length > lib.GRID_LIMITS.rows || res.grid.some((r) => r.length > lib.GRID_LIMITS.columns || r.some((c) => c.length > lib.GRID_LIMITS.cellChars))) {
        setReadError("This sheet is too large to upload in one go. Export the customer summary on its own and try again.");
        return;
      }
      setSheet(res.sheet);
      setGrid(res.grid);
    } catch {
      setReadError("This file could not be read. Is it a valid Excel or CSV file?");
    } finally {
      setBusy(null);
    }
  }

  function payload() {
    // Raw cells only. The server finds the rows, Grand Total, period and title itself.
    return { fileName: fileName ?? undefined, sheetName: sheet!.sheet, grid: grid! };
  }

  async function check() {
    setBusy("check");
    setError(null);
    setResult(null);
    try {
      const res = await previewCollectionBalances(payload());
      if (!res.ok) setError(res.error);
      else {
        setPreview(res.preview);
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
    if (!preview) return;
    setBusy("import");
    setError(null);
    try {
      const fp = preview.summary.fingerprint;
      const res = await importCollectionBalances({
        ...payload(),
        previousSnapshotId: preview.replacement.previous?.id ?? null,
        expected: { matched: fp.matched, debitPaise: fp.debitPaise, creditPaise: fp.creditPaise },
        confirm: confirmed ? true : undefined,
      });
      if (!res.ok) setError(res.error);
      else {
        setResult(res.result);
        setPreview(null);
        router.refresh();
      }
    } catch {
      setError("The upload did not complete. Preview again to see what was saved.");
    } finally {
      setBusy(null);
    }
  }

  const rows = preview?.rows ?? [];
  const shown = rows.filter((r) => (filter === "all" ? true : filter === "negative" ? r.negative : r.status === filter));
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const slice = shown.slice(page * PAGE, page * PAGE + PAGE);
  const canImportNow = !!preview && preview.storageReady && preview.summary.verification.status === "ok" && confirmed && preview.summary.matched > 0 && busy === null;

  if (result) {
    return (
      <div aria-live="polite">
        <p className="flex items-center gap-2 text-[15px] font-bold text-ink-strong">
          <CheckCircle2 size={18} className="text-[#059669]" aria-hidden /> Balances uploaded
        </p>
        <p className="mt-1 text-[13px] text-ink-muted">
          {result.written} compan{result.written === 1 ? "y" : "ies"} now show Debit {formatInr(result.totals.debit)} and Credit {formatInr(result.totals.credit)} in total. Snapshot{" "}
          <span className="font-mono">{result.snapshotId}</span>.
        </p>
        <p className="mt-1 text-[12.5px] text-ink-subtle tabular-nums">
          Skipped: {result.skipped.unmatched} not in the Collection Master · {result.skipped.duplicates} repeats · {result.skipped.conflicts} conflicting duplicates · {result.skipped.rejected} invalid.
        </p>
        <div className="mt-4 flex justify-end">
          <button type="button" className={BTN} style={PRIMARY} onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <section aria-labelledby="bu-file">
        <h3 id="bu-file" className="text-[14px] font-bold text-ink-strong">
          1. Choose the Tally customer summary
        </h3>
        <label htmlFor="bu-input" className="mt-2 flex cursor-pointer items-center gap-3 rounded-lg px-4 py-3" style={{ border: "1.5px dashed #BFD0EA", background: "#F8FAFF" }}>
          <UploadCloud size={22} strokeWidth={1.8} className="shrink-0 text-[#0A6CFF]" aria-hidden />
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-bold text-ink-strong">{fileName ?? "Select a file"}</span>
            <span className="block text-[12.5px] text-ink-muted">Sundry Debtors &ldquo;Particulars / Debit / Credit&rdquo; · Excel or CSV · read in your browser</span>
          </span>
          <input id="bu-input" type="file" accept=".xlsx,.xls,.csv" className="sr-only" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        {busy === "read" && <p className="mt-2 text-[12.5px] text-ink-subtle">Reading the file…</p>}
        {readError && (
          <p role="alert" className="mt-2 flex items-start gap-2 text-[13px] font-semibold text-[#B91C1C]">
            <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden /> {readError}
          </p>
        )}
        {sheet && (
          <div className="mt-2 rounded-lg px-3 py-2 text-[12.5px] text-ink-muted" style={{ border: "1px solid #E6ECF5", background: "#FAFCFF" }}>
            <p>
              <strong className="text-ink-soft">Sheet:</strong> {sheet.sheet}
              {sheet.reportTitle ? ` · ${sheet.reportTitle}` : ""}
            </p>
            <p>
              <strong className="text-ink-soft">Reporting period:</strong> {period(sheet.periodFrom, sheet.periodTo)}
            </p>
            <p className="tabular-nums">
              <strong className="text-ink-soft">Customer rows:</strong> {sheet.rows.length} · {sheet.skipped.totals} total row{sheet.skipped.totals === 1 ? "" : "s"} and {sheet.skipped.blank} blank row
              {sheet.skipped.blank === 1 ? "" : "s"} left out
              {sheet.sourceTotal ? ` · Grand Total as read in your browser: Debit ${sheet.sourceTotal.debit || "—"}, Credit ${sheet.sourceTotal.credit || "—"}` : " · no Grand Total row"}
            </p>
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" className={BTN} style={sheet && busy === null ? PRIMARY : MUTED} disabled={!sheet || busy !== null} onClick={() => void check()}>
            {busy === "check" && <Loader2 size={15} className="animate-spin" aria-hidden />}
            Preview upload
          </button>
          <span className="text-[12.5px] text-ink-subtle">Nothing is saved until you confirm.</span>
        </div>
        {error && !preview && (
          <p role="alert" className="mt-2 flex items-start gap-2 text-[13px] font-semibold text-[#B91C1C]">
            <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden /> {error}
          </p>
        )}
      </section>

      {preview && (
        <section aria-labelledby="bu-preview">
          <h3 id="bu-preview" className="text-[14px] font-bold text-ink-strong">
            2. Preview (nothing has been saved)
          </h3>

          {!preview.storageReady && (
            <p role="status" className="mt-2 text-[12.5px] font-semibold text-[#92400E]">
              Balance storage isn&apos;t set up in this database (migration 0117 hasn&apos;t been applied), so nothing can be uploaded yet.
            </p>
          )}

          <div className="mt-2 rounded-lg px-3 py-2.5 text-[13px]" style={{ background: "#EEF4FF", border: "1px solid #C9DAFB", color: "#0B4FB8" }}>
            <p className="font-bold">What this upload does</p>
            <p className="mt-0.5">
              It becomes the new balance snapshot for {period(preview.report.periodFrom, preview.report.periodTo)} and <strong>replaces</strong>, on the Tracker, the balances from the previous upload —
              figures are never added together.{" "}
              {preview.replacement.previous ? (
                <>
                  Replaced: {preview.replacement.previous.fileName ?? "an earlier file"} ({period(preview.replacement.previous.periodFrom, preview.replacement.previous.periodTo)}, uploaded{" "}
                  {day(preview.replacement.previous.uploadedAt.slice(0, 10))}, {preview.replacement.previous.companies} companies). The earlier snapshot is kept for audit.
                </>
              ) : (
                "There is no earlier upload."
              )}{" "}
              {preview.replacement.wouldGoBlank > 0 && (
                <strong>
                  {preview.replacement.wouldGoBlank} compan{preview.replacement.wouldGoBlank === 1 ? "y" : "ies"} that show a balance now are not in this file and will show blank.
                </strong>
              )}
            </p>
            {preview.replacement.sameFileAsPrevious && <p className="mt-1 font-bold text-[#B45309]">This is the same file as the last upload; applying it changes nothing on the Tracker.</p>}
            <p className="mt-1">Collection persons, follow-ups, comments, commitments, confirmations and escalations are not touched. No company is created.</p>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
            <Tile label="File rows" value={preview.summary.rows} />
            <Tile label="Matched" value={preview.summary.matched} tone="#047857" />
            <Tile label="Not in Master" value={preview.summary.unmatched} tone={preview.summary.unmatched ? "#B45309" : undefined} />
            <Tile label="Repeats" value={preview.summary.duplicates} tone={preview.summary.duplicates ? "#0B4FB8" : undefined} />
            <Tile label="Conflicts" value={preview.summary.conflicts} tone={preview.summary.conflicts ? "#B91C1C" : undefined} />
            <Tile label="Invalid" value={preview.summary.rejected} tone={preview.summary.rejected ? "#B91C1C" : undefined} />
            <Tile label="Negative" value={preview.summary.negatives} tone={preview.summary.negatives ? "#B45309" : undefined} />
          </div>

          <div className="mt-3 overflow-x-auto rounded-lg" style={{ border: "1px solid #E6ECF5" }}>
            <table className="w-full min-w-[520px] border-collapse text-[12.5px]">
              <caption className="sr-only">Totals</caption>
              <thead style={{ background: "#F5F7FB" }}>
                <tr className="text-left text-ink-soft">
                  <th className="px-3 py-1.5 font-bold">Totals</th>
                  <th className="px-3 py-1.5 text-right font-bold">Debit</th>
                  <th className="px-3 py-1.5 text-right font-bold">Credit</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {(
                  [
                    ["Grand Total in the file", preview.summary.totals.source],
                    ["All valid rows in the file", preview.summary.totals.sheetRows],
                    ["To be imported (matched)", preview.summary.totals.imported],
                    ["Skipped — not in the Collection Master", preview.summary.totals.unmatched],
                    ["Skipped — repeats", preview.summary.totals.ignoredDuplicates],
                    ["Skipped — conflicting duplicates", preview.summary.totals.conflicting],
                  ] as const
                ).map(([label, t]) => (
                  <tr key={label} className="border-t border-[#EEF1F6]">
                    <td className="px-3 py-1.5 font-semibold text-ink-strong">{label}</td>
                    <td className="px-3 py-1.5 text-right">{t ? money(t.debit) : "—"}</td>
                    <td className="px-3 py-1.5 text-right">{t ? money(t.credit) : "—"}</td>
                  </tr>
                ))}
                <tr className="border-t border-[#EEF1F6]">
                  <td className="px-3 py-1.5 font-semibold text-ink-strong">File Grand Total minus rows</td>
                  <td className="px-3 py-1.5 text-right" style={{ color: preview.summary.totals.difference?.debit ? "#B91C1C" : undefined }}>
                    {preview.summary.totals.difference ? money(preview.summary.totals.difference.debit) : "—"}
                  </td>
                  <td className="px-3 py-1.5 text-right" style={{ color: preview.summary.totals.difference?.credit ? "#B91C1C" : undefined }}>
                    {preview.summary.totals.difference ? money(preview.summary.totals.difference.credit) : "—"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          {preview.summary.verification.status !== "ok" ? (
            <p role="alert" className="mt-1.5 flex items-start gap-2 text-[13px] font-semibold text-[#B91C1C]">
              <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden /> {preview.summary.verification.message}
            </p>
          ) : (
            <p className="mt-1.5 text-[12.5px] text-ink-subtle tabular-nums">
              Checked by the server: the rows add up to the file&apos;s Grand Total (allowed rounding gap ₹{(preview.summary.verification.tolerancePaise / 100).toFixed(2)}).
            </p>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-1.5 text-[12.5px]">
            {(["all", "matched", "unmatched", "duplicate", "conflict", "rejected", "negative"] as const).map((s) => {
              const n = s === "all" ? rows.length : s === "negative" ? rows.filter((r) => r.negative).length : rows.filter((r) => r.status === s).length;
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
                  {s === "all" ? "All" : s === "negative" ? "Negative" : STATUS_LABEL[s]} ({n})
                </button>
              );
            })}
          </div>

          <div className="mt-2 max-h-[360px] overflow-auto rounded-lg" style={{ border: "1px solid #E6ECF5" }}>
            <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
              <thead className="sticky top-0" style={{ background: "#F5F7FB" }}>
                <tr className="text-left text-ink-soft">
                  {["Row", "Particulars", "Debit", "Credit", "Status", "Notes"].map((h, i) => (
                    <th key={h} className={`px-3 py-1.5 font-bold ${i === 2 || i === 3 ? "text-right" : ""}`}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slice.map((r) => (
                  <PreviewRow key={r.rowNo} r={r} />
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
            <h3 className="text-[14px] font-bold text-ink-strong">3. Confirm</h3>
            <p className="mt-2 text-[13.5px] text-ink-strong">
              This will save a new balance snapshot for <strong>{preview.summary.matched}</strong> compan{preview.summary.matched === 1 ? "y" : "ies"} (Debit{" "}
              {money(preview.summary.totals.imported.debit)}, Credit {money(preview.summary.totals.imported.credit)}) and use it on the Tracker in place of the previous one. Rows that are not
              matched, repeated, conflicting or invalid are skipped.
            </p>
            <label className="mt-2 flex items-start gap-2 text-[13px] text-ink-muted">
              <input type="checkbox" className="mt-0.5 size-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
              I have reviewed the preview and understand this replaces the balances currently shown.
            </label>
            {error && (
              <p role="alert" className="mt-2 flex items-start gap-2 text-[13px] font-semibold text-[#B91C1C]">
                <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden /> {error}
              </p>
            )}
            <button type="button" className={`${BTN} mt-3`} style={canImportNow ? PRIMARY : MUTED} disabled={!canImportNow} onClick={() => void runImport()}>
              {busy === "import" && <Loader2 size={15} className="animate-spin" aria-hidden />}
              Upload balances
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

function PreviewRow({ r }: { r: PlannedBalanceRow }) {
  const tone = STATUS_TONE[r.status];
  return (
    <tr className="border-t border-[#EEF1F6] align-top">
      <td className="px-3 py-1.5 tabular-nums text-ink-subtle">{r.rowNo}</td>
      <td className="px-3 py-1.5 font-semibold text-ink-strong">
        {r.name || <span className="text-ink-subtle">(blank)</span>}
        {r.companyName && r.companyName !== r.name && <span className="block text-[11.5px] font-normal text-ink-subtle">Master: {r.companyName}</span>}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: (r.debit ?? 0) < 0 ? "#B45309" : undefined }}>
        {money(r.debit)}
      </td>
      <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: (r.credit ?? 0) < 0 ? "#B45309" : undefined }}>
        {money(r.credit)}
      </td>
      <td className="px-3 py-1.5">
        <span className="whitespace-nowrap rounded-full px-2 py-0.5 text-[11.5px] font-bold" style={{ background: tone.bg, color: tone.fg }}>
          {STATUS_LABEL[r.status]}
        </span>
      </td>
      <td className="px-3 py-1.5">
        {r.messages.map((m, i) => (
          <p key={i} style={{ color: m.level === "error" ? "#B91C1C" : m.level === "warning" ? "#B45309" : "#475569" }}>
            {m.text}
          </p>
        ))}
      </td>
    </tr>
  );
}
