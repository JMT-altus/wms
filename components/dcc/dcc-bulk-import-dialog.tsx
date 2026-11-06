"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { X, Loader2, Upload, Eye, Download, ChevronRight } from "lucide-react";
import { DCC_BULK_FORMAT_GUIDE, DCC_BULK_SAMPLE, DCC_BULK_SAMPLE_FILENAME } from "@/lib/dcc/bulk-sample";
import { previewDccBulkImport, applyDccBulkImport, type BulkPreview, type BulkApplySummary } from "@/app/(app)/dcc/actions";
import { DCC_INPUT_TYPE_LABELS } from "@/lib/dcc/util";
import { parseBulkImport, countLines } from "@/lib/dcc/bulk-import";
import type { DccTabPerson } from "@/components/dcc/dcc-tabs";

const FIELD = "w-full rounded-[10px] border border-hairline bg-surface-input px-3 py-2 text-[13px] text-ink-strong outline-none transition focus:border-[#0A6CFF]";
const LABEL = "mb-1.5 block text-[11px] font-bold uppercase tracking-[0.08em] text-ink-subtle";

const PLACEHOLDER = `# Sheet tab label, e.g. "BH – Bhavisha"
1 | Tally - Total Value of SO Recd | Daily | Number
2 | Sales - Weekly Calls Sheet Done? (Y/N) | Daily | Yes/No
9 | Sales - Enquiry Funnel - Updated? | Sat / Tues | Yes/No
4.1 | To whom & what brand? | | Text

# Next tab …`;

export interface DccBulkImportDialogProps {
  open: boolean;
  onClose: (applied: boolean) => void;
  /** Everyone the viewer can configure: the mapping choices. */
  people: DccTabPerson[];
}

/**
 * Bulk KPI setup: paste the checklist, preview every group and line with the
 * person it will go to, fix the mapping, apply once. The server parses and
 * validates the same text again, so the preview is a courtesy and the action
 * is the control. Nothing is written until Apply, and then in one transaction.
 */
export function DccBulkImportDialog({ open, onClose, people }: DccBulkImportDialogProps) {
  // Portal target exists only in the browser; this reads that fact without a setState-in-effect.
  const mounted = React.useSyncExternalStore(() => () => {}, () => true, () => false);
  const [text, setText] = React.useState("");
  const [mapping, setMapping] = React.useState<Record<string, string | null>>({});
  const [updateDiffering, setUpdateDiffering] = React.useState(false);
  const [preview, setPreview] = React.useState<BulkPreview | null>(null);
  const [summary, setSummary] = React.useState<BulkApplySummary | null>(null);
  const [busy, setBusy] = React.useState<"preview" | "apply" | null>(null);
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose(Boolean(summary));
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose, summary]);
  if (!mounted || !open) return null;

  const local = text.trim() ? countLines(parseBulkImport(text).groups) : null;

  async function runPreview(nextMapping = mapping) {
    setBusy("preview");
    const res = await previewDccBulkImport({ text, mapping: nextMapping });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setPreview(res.preview);
    // Adopt the server's suggestions for labels the admin has not chosen yet.
    const m: Record<string, string | null> = { ...nextMapping };
    for (const g of res.preview.groups) if (!(g.label in m)) m[g.label] = g.employeeId;
    setMapping(m);
  }

  async function runApply() {
    if (!preview) return;
    setBusy("apply");
    const res = await applyDccBulkImport({ text, mapping, updateDiffering });
    setBusy(null);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setSummary(res.summary);
    toast.success(`Bulk setup applied: ${res.summary.created} created, ${res.summary.updated} updated, ${res.summary.skipped} already there`);
  }

  const canApply = Boolean(preview) && preview!.applicable > 0 && preview!.blocking.length === 0 && busy === null;

  /** Save the paste-ready sample as a .txt — built in the browser, no request. */
  function downloadSample() {
    const url = URL.createObjectURL(new Blob([DCC_BULK_SAMPLE], { type: "text/plain;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = DCC_BULK_SAMPLE_FILENAME;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[200] flex items-start justify-center overflow-y-auto bg-ink-strong/40 p-4 backdrop-blur-[2px] sm:p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose(Boolean(summary));
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Bulk KPI setup" className="my-auto w-full max-w-[1040px] rounded-[22px] border border-hairline bg-surface-card shadow-2xl">
        <header className="flex items-center justify-between border-b border-hairline px-6 py-4">
          <div>
            <h2 className="text-[18px] font-bold text-[#0B1F44]">
              Bulk KPI setup
            </h2>
            <p className="text-[12.5px] text-ink-subtle">Paste one group per sheet tab, one KPI per line: Sr No | Title | Frequency | Input type. Preview, map each tab to a person, then apply once.</p>
          </div>
          <button type="button" onClick={() => onClose(Boolean(summary))} aria-label="Close" className="rounded-full p-1.5 text-ink-subtle transition hover:bg-surface-track hover:text-ink-strong">
            <X size={18} />
          </button>
        </header>

        <div className="space-y-4 px-6 py-5">
          {!summary && (
            <>
              <div>
                <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                  <label className={`${LABEL} !mb-0`} htmlFor="dcc-bulk-text">
                    Checklist text
                  </label>
                  <button
                    type="button"
                    onClick={downloadSample}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#C9DAFB] bg-white px-3 text-[12.5px] font-semibold text-[#0B4FB8] transition-colors hover:bg-[#EEF4FF] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#0A6CFF]/20"
                    title="A paste-ready sample in the format below"
                  >
                    <Download size={14} aria-hidden /> Download sample
                  </button>
                </div>
                <textarea
                  id="dcc-bulk-text"
                  className={`${FIELD} min-h-[180px] font-mono text-[12.5px] leading-snug`}
                  value={text}
                  onChange={(e) => {
                    setText(e.target.value);
                    setPreview(null);
                  }}
                  placeholder={PLACEHOLDER}
                  spellCheck={false}
                />
                {local && (
                  <p className="mt-1.5 text-[12px] text-ink-subtle">
                    {local.groups} {local.groups === 1 ? "group" : "groups"}, {local.lines} {local.lines === 1 ? "line" : "lines"}
                    {local.invalid > 0 && <span className="text-red-deep"> · {local.invalid} with problems</span>}
                  </p>
                )}
                <details className="group mt-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFD] text-[12px]">
                  <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-1.5 font-semibold text-[#334155] [&::-webkit-details-marker]:hidden">
                    <ChevronRight size={13} aria-hidden className="transition-transform group-open:rotate-90" /> Format guide
                  </summary>
                  <dl className="grid gap-x-4 gap-y-1 border-t border-[#E2E8F0] px-3 py-2 sm:grid-cols-[130px_minmax(0,1fr)]">
                    {DCC_BULK_FORMAT_GUIDE.map((g) => (
                      <React.Fragment key={g.rule}>
                        <dt className="font-semibold text-[#0B1F44]">{g.rule}</dt>
                        <dd className="text-[#475569]">{g.detail}</dd>
                      </React.Fragment>
                    ))}
                  </dl>
                </details>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => runPreview()}
                  disabled={!text.trim() || busy !== null}
                  className="inline-flex items-center gap-1.5 rounded-[10px] border border-hairline px-4 py-2 text-[13px] font-semibold text-ink-soft transition hover:bg-surface-track disabled:opacity-40"
                >
                  {busy === "preview" ? <Loader2 size={14} className="animate-spin" /> : <Eye size={14} />} Preview
                </button>
                <label className="flex cursor-pointer items-center gap-2 text-[12.5px] text-ink-soft">
                  <input type="checkbox" className="size-4 accent-[#0A6CFF]" checked={updateDiffering} onChange={(e) => setUpdateDiffering(e.target.checked)} />
                  Update existing KPIs whose frequency, type or code differs (titles are never changed; nothing is removed)
                </label>
              </div>

              {preview && (
                <div className="space-y-4">
                  {preview.errors.length > 0 && (
                    <ul className="rounded-[12px] border px-3 py-2 text-[12.5px]" style={{ background: "var(--color-red-bg)", borderColor: "var(--color-red)", color: "var(--color-red-deep)" }}>
                      {preview.errors.map((e, i) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  )}
                  {preview.groups.map((g) => (
                    <section key={g.label} className="rounded-[14px] border border-hairline">
                      <header className="flex flex-wrap items-center gap-3 border-b border-hairline bg-surface-soft px-3 py-2">
                        <span className="text-[13.5px] font-bold text-ink-strong">{g.label}</span>
                        <span className="text-[12px] text-ink-subtle">{g.lines.length} KPIs</span>
                        <label className="ml-auto flex items-center gap-2 text-[12px] text-ink-subtle">
                          Goes to
                          <select
                            aria-label={`Employee for ${g.label}`}
                            className="rounded-[8px] border border-hairline bg-surface-input px-2 py-1 text-[12.5px] font-semibold text-ink-strong outline-none focus:border-[#0A6CFF]"
                            value={mapping[g.label] ?? ""}
                            onChange={(e) => {
                              const m = { ...mapping, [g.label]: e.target.value || null };
                              setMapping(m);
                              void runPreview(m);
                            }}
                          >
                            <option value="">— leave unassigned (skip) —</option>
                            {people.map((p) => (
                              <option key={p.id} value={p.id}>
                                {p.name}
                                {p.designation || p.department ? ` · ${[p.designation, p.department].filter(Boolean).join(" · ")}` : ""}
                              </option>
                            ))}
                          </select>
                        </label>
                        {g.employeeId == null ? (
                          <span className="rounded-full px-2 py-0.5 text-[11px] font-bold" style={{ background: "var(--color-amber-bg)", color: "var(--color-amber-deep)" }}>
                            needs employee mapping — will be skipped
                          </span>
                        ) : g.suggested ? (
                          <span className="text-[11px] text-ink-subtle">suggested from the label — confirm</span>
                        ) : null}
                        {!g.canManage && g.employeeId && <span className="text-[11px] font-bold text-red-deep">you can&apos;t configure this person</span>}
                      </header>
                      {g.errors.length > 0 && <p className="px-3 pt-2 text-[12px] text-red-deep">{g.errors.join("; ")}</p>}
                      <table className="w-full text-[12.5px]">
                        <thead className="text-[11px] uppercase tracking-wide text-ink-subtle">
                          <tr className="border-b border-hairline">
                            <th className="px-3 py-1.5 text-left">Sr</th>
                            <th className="px-3 py-1.5 text-left">Title</th>
                            <th className="px-3 py-1.5 text-left">Frequency</th>
                            <th className="px-3 py-1.5 text-left">Type</th>
                            <th className="px-3 py-1.5 text-left">Result</th>
                          </tr>
                        </thead>
                        <tbody>
                          {g.lines.map((l) => (
                            <tr key={l.line} className="border-b border-hairline last:border-0">
                              <td className="px-3 py-1 tabular-nums text-ink-subtle">{l.sr ?? "–"}</td>
                              <td className="px-3 py-1 text-ink-strong">{l.title || <em className="text-ink-subtle">missing</em>}</td>
                              <td className="px-3 py-1 text-ink-soft">
                                {l.frequency ?? <em className="text-ink-subtle">none</em>}
                                <span className="ml-1 text-[11px] text-ink-subtle">({l.reads})</span>
                              </td>
                              <td className="px-3 py-1 text-ink-soft">{l.inputType ? DCC_INPUT_TYPE_LABELS[l.inputType] : "?"}</td>
                              <td className="px-3 py-1">
                                <Status status={l.status} />
                                {l.errors.length > 0 && <div className="text-[11.5px] text-red-deep">{l.errors.join("; ")}</div>}
                                {l.notes.length > 0 && <div className="text-[11.5px] text-ink-subtle">{l.notes.join("; ")}</div>}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </section>
                  ))}
                  <p className="text-[12.5px] text-ink-soft">
                    Will create <strong>{preview.willCreate}</strong>, update <strong>{preview.willUpdate}</strong>, leave <strong>{preview.willSkip}</strong> already-existing as they are;{" "}
                    <strong>{preview.unresolved}</strong> {preview.unresolved === 1 ? "group" : "groups"} unassigned.
                    {preview.blocking.length > 0 && <span className="block text-red-deep">Fix before applying: {preview.blocking.join("; ")}</span>}
                  </p>
                </div>
              )}
            </>
          )}

          {summary && (
            <div className="space-y-3">
              <p className="text-[14px] font-bold text-ink-strong">
                Applied in one transaction: {summary.created} created, {summary.updated} updated, {summary.skipped} already existed, {summary.unresolved} {summary.unresolved === 1 ? "group" : "groups"} left unassigned.
              </p>
              <ul className="space-y-1 text-[12.5px] text-ink-soft">
                {summary.groups.map((g) => (
                  <li key={g.label} className="rounded-[10px] border border-hairline px-3 py-1.5">
                    <strong className="text-ink-strong">{g.label}</strong> → {g.employeeName ?? <em>unassigned (skipped)</em>}: {g.created} created, {g.updated} updated, {g.skipped} kept
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-hairline px-6 py-4">
          <button type="button" onClick={() => onClose(Boolean(summary))} disabled={busy !== null} className="rounded-[10px] border border-hairline px-4 py-2 text-[13px] font-semibold text-ink-soft transition hover:bg-surface-track disabled:opacity-40">
            {summary ? "Done" : "Cancel"}
          </button>
          {!summary && (
            <button
              type="button"
              onClick={runApply}
              disabled={!canApply}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#0A6CFF] px-4 text-[13px] font-semibold text-white shadow-[0_1px_2px_rgba(10,108,255,0.25)] transition-colors hover:bg-[#0058D6] disabled:cursor-not-allowed disabled:bg-[#5B9BFF]"
            >
              {busy === "apply" ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />} Apply
            </button>
          )}
        </footer>
      </div>
    </div>,
    document.body,
  );
}

function Status({ status }: { status: BulkPreview["groups"][number]["lines"][number]["status"] }) {
  const map: Record<typeof status, [string, string]> = {
    create: ["will create", "var(--color-green-deep)"],
    same: ["already exists — kept", "var(--color-ink-subtle)"],
    differs: ["exists with a different frequency/type — kept unless 'update' is ticked", "var(--color-amber-deep)"],
    update: ["exists — will be updated", "var(--color-amber-deep)"],
    invalid: ["invalid", "var(--color-red-deep)"],
    unassigned: ["skipped (no employee)", "var(--color-ink-subtle)"],
  };
  const [label, color] = map[status];
  return (
    <span className="text-[12px] font-semibold" style={{ color }}>
      {label}
    </span>
  );
}
