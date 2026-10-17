"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Info, Loader2, UploadCloud, XCircle } from "lucide-react";
import { Select } from "@/components/ui/select";
import type { ParsedReport, SourceEmployee } from "@/lib/attendance/import/parse-report";
import { SKIP_EMPLOYEE, type PlanSummary } from "@/lib/attendance/import/plan";
import { periodWarnings, summarizeDates } from "@/lib/attendance/import/period";
import { buildPayload, payloadTooLarge } from "@/lib/attendance/import/payload";
import {
  previewAttendanceImport,
  runAttendanceImport,
  type ImportPreview,
  type ImportRunResult,
} from "@/app/(app)/hr/attendance-import/actions";
import {
  lookupSavedMappings,
  saveConfirmedMappings,
  type MappingConflict,
} from "@/app/(app)/hr/attendance-import/mapping-actions";
import { usableCode, type Suggestion } from "@/lib/attendance/import/auto-map";

/**
 * HR → Attendance Import.
 *
 * The file is read in this browser (nothing is uploaded to read it). The admin
 * maps every biometric employee to a JMT employee, checks a server-side preview
 * (which writes nothing), confirms the mappings and the reporting period, then
 * imports. Only punch times are imported; statuses such as Absent / WeeklyOff /
 * ½Present are shown for reference and never turned into attendance, leave or pay.
 */

export interface ImportableEmployee {
  id: string;
  name: string;
  email: string;
}

const CARD = "rounded-xl bg-white p-4 max-md:p-3";
const LINE = { border: "1px solid #DCE4F0" } as const;
const BTN =
  "inline-flex h-9 items-center justify-center gap-2 rounded-lg px-4 text-[13.5px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50";
const PRIMARY = { background: "#0A6CFF", color: "#fff" } as const;

const MAX_FILE_BYTES = 8 * 1024 * 1024;

function StepTitle({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink-strong">
      <span
        className="inline-flex size-6 items-center justify-center rounded-full text-[12px] font-bold"
        style={{ background: "#EEF4FF", color: "#0B4FB8" }}
      >
        {n}
      </span>
      {children}
    </h2>
  );
}

function Tile({ label, value, tone }: { label: string; value: number | string; tone?: "good" | "warn" | "bad" | "info" }) {
  const color = tone === "good" ? "#047857" : tone === "warn" ? "#B45309" : tone === "bad" ? "#B91C1C" : tone === "info" ? "#0B4FB8" : "#1E293B";
  return (
    <div className="rounded-lg px-3 py-2" style={{ border: "1px solid #E6ECF5", background: "#FAFCFF" }}>
      <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-ink-subtle">{label}</p>
      <p className="text-[20px] font-extrabold tabular-nums leading-tight" style={{ color }}>
        {value}
      </p>
    </div>
  );
}

function suggestions(src: SourceEmployee, people: ImportableEmployee[]): ImportableEmployee[] {
  const n = src.name.trim().toLowerCase();
  if (!n) return [];
  return people.filter((p) => {
    const full = p.name.toLowerCase();
    return full === n || full.split(/\s+/)[0] === n.split(/\s+/)[0];
  });
}

function punchDays(e: SourceEmployee): number {
  return e.days.filter((d) => d.inTime || d.outTime).length;
}

export function AttendanceImportShell({ people = [] }: { people?: ImportableEmployee[] }) {
  const [fileName, setFileName] = React.useState<string | null>(null);
  const [wb, setWb] = React.useState<import("xlsx").WorkBook | null>(null);
  const [sheet, setSheet] = React.useState<string>("");
  const [report, setReport] = React.useState<ParsedReport | null>(null);
  const [readError, setReadError] = React.useState<string | null>(null);
  const [mapping, setMapping] = React.useState<Record<string, string>>({});
  const [preview, setPreview] = React.useState<ImportPreview | null>(null);
  const [busy, setBusy] = React.useState<"check" | "import" | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [mappingsOk, setMappingsOk] = React.useState(false);
  const [periodOk, setPeriodOk] = React.useState(false);
  const [result, setResult] = React.useState<ImportRunResult | null>(null);
  const [level, setLevel] = React.useState<"all" | "error" | "warning" | "info">("all");
  // Saved biometric-code matches: what the server found for each file row.
  const [suggest, setSuggest] = React.useState<Record<string, Suggestion>>({});
  const [lookupNote, setLookupNote] = React.useState<string | null>(null);
  // "Remember these matches" panel.
  const [rememberOpen, setRememberOpen] = React.useState(false);
  const [rememberOk, setRememberOk] = React.useState(false);
  const [rememberBusy, setRememberBusy] = React.useState(false);
  const [rememberMsg, setRememberMsg] = React.useState<{ ok: boolean; text: string } | null>(null);
  const [conflicts, setConflicts] = React.useState<MappingConflict[]>([]);
  const [replaceOk, setReplaceOk] = React.useState<Record<string, boolean>>({});

  const peopleById = React.useMemo(() => new Map(people.map((p) => [p.id, p])), [people]);

  const options = React.useMemo(
    () => [
      { value: SKIP_EMPLOYEE, label: "Don't import this person" },
      ...people.map((p) => ({ value: p.id, label: `${p.name} · ${p.email}` })),
    ],
    [people],
  );

  function resetCheck() {
    setPreview(null);
    setMappingsOk(false);
    setPeriodOk(false);
    setResult(null);
    setError(null);
  }

  /**
   * Ask the server which rows have a saved, still-valid match. Matched people are
   * pre-selected (HR can change any of them); everything else stays unselected
   * with the reason. A first name never produces a match.
   */
  async function loadSuggestions(emps: SourceEmployee[], applyMatched: boolean) {
    setLookupNote(null);
    try {
      const res = await lookupSavedMappings({ sources: emps.map((e) => ({ key: e.key, code: e.code, name: e.name })) });
      if (!res.ok) {
        setSuggest({});
        setLookupNote(`Saved matches could not be loaded (${res.error}). Choose the people yourself.`);
        return;
      }
      setSuggest(res.suggestions);
      if (applyMatched) {
        const auto: Record<string, string> = {};
        for (const [key, s] of Object.entries(res.suggestions)) {
          if (s.status === "matched" && peopleById.has(s.employeeId)) auto[key] = s.employeeId;
        }
        setMapping(auto);
      }
    } catch {
      setSuggest({});
      setLookupNote("Saved matches could not be loaded. Choose the people yourself.");
    }
  }

  async function parseWith(book: import("xlsx").WorkBook, name: string) {
    const { parseSheet } = await import("@/lib/attendance/import/parse-report");
    const parsed = parseSheet(book, name);
    setSheet(name);
    setReport(parsed);
    setMapping({});
    setSuggest({});
    setRememberOpen(false);
    setRememberOk(false);
    setRememberMsg(null);
    setConflicts([]);
    setReplaceOk({});
    resetCheck();
    if (parsed.employees.length > 0) await loadSuggestions(parsed.employees, true);
  }

  async function onFile(file: File | undefined) {
    setReadError(null);
    setReport(null);
    setWb(null);
    resetCheck();
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
      setReadError("This file is larger than 8 MB. Split it by month and try again.");
      return;
    }
    try {
      const { readWorkbook } = await import("@/lib/attendance/import/parse-report");
      const isCsv = /\.csv$/i.test(file.name);
      const book = readWorkbook(isCsv ? await file.text() : await file.arrayBuffer());
      setWb(book);
      const first = book.SheetNames[0];
      if (!first) {
        setReadError("The workbook has no sheets.");
        return;
      }
      await parseWith(book, first);
    } catch {
      setReadError("This file could not be read. Is it a valid Excel or CSV file?");
    }
  }

  const employees = React.useMemo(() => report?.employees ?? [], [report]);
  const decided = employees.filter((e) => mapping[e.key]).length;
  const allDecided = employees.length > 0 && decided === employees.length;
  const mappedTwice = React.useMemo(() => {
    const seen = new Map<string, number>();
    for (const v of Object.values(mapping)) if (v && v !== SKIP_EMPLOYEE) seen.set(v, (seen.get(v) ?? 0) + 1);
    return new Set([...seen].filter(([, n]) => n > 1).map(([id]) => id));
  }, [mapping]);
  const codeCount = React.useMemo(() => {
    const m = new Map<string, number>();
    for (const e of employees) m.set(e.key, (m.get(e.key) ?? 0) + 1);
    return m;
  }, [employees]);

  // Rows HR could ask us to remember: a real person chosen for a real code, and not
  // already exactly the saved match. Rows listed twice in the file are never offered.
  const rememberable = React.useMemo(
    () =>
      employees.filter((e) => {
        const chosen = mapping[e.key];
        if (!chosen || chosen === SKIP_EMPLOYEE || !usableCode(e.code) || (codeCount.get(e.key) ?? 1) > 1) return false;
        const s = suggest[e.key];
        return !(s && s.status === "matched" && s.employeeId === chosen);
      }),
    [employees, mapping, suggest, codeCount],
  );

  async function saveMatches() {
    setRememberBusy(true);
    setRememberMsg(null);
    try {
      const res = await saveConfirmedMappings({
        items: rememberable.map((e) => ({
          code: e.code,
          name: e.name,
          employeeId: mapping[e.key]!,
          replace: replaceOk[e.code] === true ? true : undefined,
        })),
        acknowledged: rememberOk ? true : undefined,
      });
      if (res.ok) {
        const s = res.saved;
        setRememberMsg({
          ok: true,
          text: `Saved: ${s.created} new, ${s.changed} changed, ${s.confirmed} re-confirmed. They will be selected automatically next time.`,
        });
        setConflicts([]);
        setReplaceOk({});
        setRememberOk(false);
        setRememberOpen(false);
        await loadSuggestions(employees, false);
      } else {
        setRememberMsg({ ok: false, text: res.error });
        setConflicts("conflicts" in res ? res.conflicts : []);
      }
    } catch {
      setRememberMsg({ ok: false, text: "The matches could not be saved. Nothing was changed." });
    } finally {
      setRememberBusy(false);
    }
  }

  // The period found in the DATA — not the file name — is what gets confirmed.
  const dates = React.useMemo(() => summarizeDates(employees.flatMap((e) => e.days.map((d) => d.date))), [employees]);
  const warnings = React.useMemo(
    () => periodWarnings({ fileName, dates, declared: report?.period ?? null }),
    [fileName, dates, report],
  );
  const confirmedPeriod = React.useMemo(
    () => (dates.first && dates.last ? { from: dates.first, to: dates.last } : null),
    [dates],
  );

  const payload = React.useCallback(
    (ack?: { mappings: boolean; period: boolean }) =>
      report
        ? buildPayload(report, mapping, { fileName: fileName ?? undefined, confirmedPeriod, acknowledged: ack })
        : null,
    [report, mapping, fileName, confirmedPeriod],
  );

  async function check() {
    const p = payload();
    if (!p) return;
    const big = payloadTooLarge(p);
    if (big) {
      setError(big);
      return;
    }
    setBusy("check");
    setError(null);
    setMappingsOk(false);
    setPeriodOk(false);
    setResult(null);
    try {
      const res = await previewAttendanceImport(p);
      if (!res.ok) setError(res.error);
      else setPreview(res.preview);
    } catch {
      setError("The check failed. Please try again.");
    } finally {
      setBusy(null);
    }
  }

  async function runImport() {
    const p = payload({ mappings: true, period: true });
    if (!p) return;
    const big = payloadTooLarge(p);
    if (big) {
      setError(big);
      return;
    }
    setBusy("import");
    setError(null);
    try {
      const res = await runAttendanceImport(p);
      if (!res.ok) setError(res.error);
      else {
        setResult(res.result);
        setPreview(null);
      }
    } catch {
      setError("The import did not complete. Run the check again to see what was already saved.");
    } finally {
      setBusy(null);
    }
  }

  const canImport =
    !!preview &&
    preview.blockers.length === 0 &&
    preview.summary.readyPunches > 0 &&
    mappingsOk &&
    periodOk &&
    busy === null;
  const issues = (preview?.issues ?? []).filter((i) => level === "all" || i.level === level);
  const sample = employees.find((e) => e.days.some((d) => d.inTime || d.outTime));
  const totalDays = employees.reduce((n, e) => n + e.days.length, 0);
  const withPunches = employees.reduce((n, e) => n + punchDays(e), 0);

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <section className={CARD} style={LINE} aria-labelledby="att-upload">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <StepTitle n={1}>
            <span id="att-upload">Choose the attendance file</span>
          </StepTitle>
          <p className="text-[12.5px] text-ink-subtle">
            Excel (.xlsx, .xls) or CSV · read in your browser, not uploaded to read it
          </p>
        </div>
        <label
          htmlFor="att-file"
          className="mt-3 flex cursor-pointer items-center gap-3 rounded-lg px-4 py-3"
          style={{ border: "1.5px dashed #BFD0EA", background: "#F8FAFF" }}
        >
          <UploadCloud size={22} strokeWidth={1.8} className="shrink-0 text-[#0A6CFF]" aria-hidden />
          <span className="min-w-0">
            <span className="block truncate text-[14px] font-bold text-ink-strong">{fileName ?? "Select a file"}</span>
            <span className="block text-[12.5px] text-ink-muted">Daily Attendance Report (.xlsx), or a table with employee, date, in and out columns</span>
          </span>
          <input
            id="att-file"
            type="file"
            accept=".xlsx,.xls,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
            className="sr-only"
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>
        {readError && (
          <p role="alert" className="mt-2 flex items-start gap-2 text-[13px] font-semibold text-[#B91C1C]">
            <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden /> {readError}
          </p>
        )}

        {wb && wb.SheetNames.length > 1 && (
          <div className="mt-3 flex items-center gap-2 text-[13px]">
            <span className="font-bold text-ink-soft">Worksheet</span>
            <select
              aria-label="Worksheet"
              value={sheet}
              onChange={(e) => void parseWith(wb, e.target.value)}
              className="h-8 rounded-lg border border-hairline-strong bg-white px-2 text-[13px] font-semibold"
            >
              {wb.SheetNames.map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </div>
        )}

        {report && (
          <div className="mt-3 grid gap-3">
            {report.warnings.map((w) => (
              <p key={w} className="flex items-start gap-2 text-[13px] font-semibold text-[#B45309]">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> {w}
              </p>
            ))}
            {employees.length > 0 && (
              <>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Tile label="Employees" value={employees.length} />
                  <Tile label="Day rows" value={totalDays} />
                  <Tile label="Days with punches" value={withPunches} tone="info" />
                  <Tile label="Days without times" value={totalDays - withPunches} />
                </div>
                <div className="rounded-lg px-3 py-2.5" style={{ border: "1px solid #CFE0FA", background: "#F4F8FF" }}>
                  <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#0B4FB8]">Dates found in the data</p>
                  <p className="mt-0.5 text-[14px] font-bold text-ink-strong tabular-nums">
                    {dates.first ?? "—"} → {dates.last ?? "—"}
                    <span className="ml-2 font-semibold text-ink-soft">
                      · {dates.label} · {dates.distinct} distinct date{dates.distinct === 1 ? "" : "s"}
                    </span>
                  </p>
                  {report.period && (
                    <p className="mt-0.5 text-[12.5px] text-ink-muted tabular-nums">
                      The file&rsquo;s own header says {report.period.from} to {report.period.to}.
                    </p>
                  )}
                </div>
                {warnings.map((w) => (
                  <p key={w} className="flex items-start gap-2 text-[13px] font-semibold text-[#B45309]">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0" aria-hidden /> {w}
                  </p>
                ))}
                <p className="flex items-start gap-2 text-[12.5px] text-ink-muted">
                  <FileSpreadsheet size={15} className="mt-0.5 shrink-0 text-ink-subtle" aria-hidden />
                  <span>
                    Layout: {report.layout === "block-report" ? "Daily Attendance Report (one block per employee)" : "table"}. Fields read:
                    employee code and name, date, in time, out time, shift, duration, status.
                  </span>
                </p>
                {sample && (
                  <details className="rounded-lg" style={{ border: "1px solid #E6ECF5" }}>
                    <summary className="cursor-pointer px-3 py-2 text-[13px] font-bold text-ink-soft">
                      Sample rows ({sample.code}
                      {sample.name ? ` · ${sample.name}` : ""})
                    </summary>
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[520px] border-collapse text-[12.5px]">
                        <thead>
                          <tr className="text-left text-ink-subtle">
                            {["Date", "In", "Out", "Shift", "Duration", "Status (reference only)"].map((h) => (
                              <th key={h} className="px-3 py-1.5 font-bold">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sample.days.slice(0, 8).map((d) => (
                            <tr key={d.rowNo} className="border-t border-[#EEF1F6]">
                              <td className="px-3 py-1.5 tabular-nums">{d.date ?? d.dateRaw}</td>
                              <td className="px-3 py-1.5 tabular-nums">{d.inTime ?? "—"}</td>
                              <td className="px-3 py-1.5 tabular-nums">{d.outTime ?? "—"}</td>
                              <td className="px-3 py-1.5">{d.shift ?? "—"}</td>
                              <td className="px-3 py-1.5 tabular-nums">{d.duration ?? "—"}</td>
                              <td className="px-3 py-1.5">{d.status ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}
              </>
            )}
          </div>
        )}
      </section>

      {employees.length > 0 && (
        <section className={CARD} style={LINE} aria-labelledby="att-map">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <StepTitle n={2}>
              <span id="att-map">Match each person to a JMT employee</span>
            </StepTitle>
            <p className="text-[12.5px] font-semibold text-ink-subtle tabular-nums">
              {decided} of {employees.length} decided
            </p>
          </div>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            Biometric codes are not JMT employee ids, and first names can repeat, so nothing is matched automatically. Pick the
            person for every row, or choose &ldquo;Don&rsquo;t import&rdquo;.
          </p>
          <div className="mt-3 overflow-x-auto rounded-lg" style={{ border: "1px solid #E6ECF5" }}>
            <table className="w-full min-w-[640px] border-collapse text-[13px]">
              <thead>
                <tr className="text-left" style={{ background: "#F5F7FB" }}>
                  <th className="px-3 py-2 font-bold text-ink-soft">Code</th>
                  <th className="px-3 py-2 font-bold text-ink-soft">Name in file</th>
                  <th className="px-3 py-2 font-bold text-ink-soft">Department</th>
                  <th className="px-3 py-2 text-center font-bold text-ink-soft">Days with punches</th>
                  <th className="px-3 py-2 font-bold text-ink-soft">JMT employee</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e, idx) => {
                  const chosen = mapping[e.key] ?? "";
                  const dup = chosen && chosen !== SKIP_EMPLOYEE && mappedTwice.has(chosen);
                  const repeats = codeCount.get(e.key) ?? 1;
                  const sugg = chosen ? [] : suggestions(e, people);
                  return (
                    <tr key={`${e.key}-${idx}`} className="border-t border-[#EEF1F6] align-top">
                      <td className="px-3 py-2 font-bold tabular-nums">
                        {e.code}
                        {repeats > 1 && (
                          <span className="ml-2 rounded-full px-2 py-0.5 text-[11px] font-bold text-[#B91C1C]" style={{ background: "#FEF2F2" }}>
                            listed {repeats}× in the file
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2 font-semibold">{e.name || "—"}</td>
                      <td className="px-3 py-2 text-ink-muted">{e.department ?? "—"}</td>
                      <td className="px-3 py-2 text-center tabular-nums">{punchDays(e)}</td>
                      <td className="px-3 py-2">
                        <div className="w-[300px] max-w-full">
                          <Select
                            options={options}
                            value={chosen}
                            onValueChange={(v) => {
                              setMapping((m) => ({ ...m, [e.key]: v }));
                              resetCheck();
                            }}
                            placeholder="Choose employee…"
                            searchPlaceholder="Search employees…"
                            ariaLabel={`JMT employee for code ${e.code}`}
                          />
                        </div>
                        {dup && <p className="mt-1 text-[12px] font-semibold text-[#B91C1C]">Already used for another row.</p>}
                        {(() => {
                          const s = suggest[e.key];
                          if (!s) return null;
                          if (s.status === "matched") {
                            return chosen === s.employeeId ? (
                              <p className="mt-1 text-[12px] font-semibold text-[#047857]">
                                Matched from your saved match for code {e.code} · {s.name} · {s.email}
                              </p>
                            ) : (
                              <p className="mt-1 text-[12px] font-semibold text-[#B45309]">
                                You changed the saved match for code {e.code} ({s.name}).
                              </p>
                            );
                          }
                          return chosen ? (
                            s.reason === "unknown_code" ? (
                              <p className="mt-1 text-[12px] text-ink-subtle">Not saved yet.</p>
                            ) : (
                              <p className="mt-1 text-[12px] font-semibold text-[#B45309]">{s.message}</p>
                            )
                          ) : (
                            <p className="mt-1 text-[12px] font-semibold text-[#B45309]">Needs your choice. {s.message}</p>
                          );
                        })()}
                        {repeats > 1 && (
                          <p className="mt-1 text-[12px] font-semibold text-[#B91C1C]">
                            This code is listed more than once, so the import is blocked until the file is fixed.
                          </p>
                        )}
                        {sugg.length > 0 && (
                          <p className="mt-1 flex flex-wrap items-center gap-1 text-[12px] text-ink-subtle">
                            Possible:
                            {sugg.slice(0, 3).map((p) => (
                              <button
                                key={p.id}
                                type="button"
                                className="rounded-full px-2 py-0.5 font-bold text-[#0B4FB8] hover:underline"
                                style={{ background: "#EEF4FF" }}
                                onClick={() => {
                                  setMapping((m) => ({ ...m, [e.key]: p.id }));
                                  resetCheck();
                                }}
                              >
                                {p.name}
                              </button>
                            ))}
                          </p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {lookupNote && (
            <p className="mt-2 flex items-start gap-2 text-[12.5px] font-semibold text-[#B45309]">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden /> {lookupNote}
            </p>
          )}

          <div className="mt-3">
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                className={BTN}
                style={rememberable.length > 0 && mappedTwice.size === 0 ? { background: "#EEF4FF", color: "#0B4FB8" } : { background: "#EEF0F3", color: "#8A93A0" }}
                disabled={rememberable.length === 0 || mappedTwice.size > 0 || rememberBusy}
                onClick={() => setRememberOpen((v) => !v)}
              >
                Remember these matches for next time ({rememberable.length})
              </button>
              <span className="text-[12px] text-ink-subtle">
                Saves only the matches you review below. Nothing is saved automatically.
              </span>
            </div>

            {rememberMsg && (
              <p
                role={rememberMsg.ok ? "status" : "alert"}
                className="mt-2 text-[12.5px] font-semibold"
                style={{ color: rememberMsg.ok ? "#047857" : "#B91C1C" }}
              >
                {rememberMsg.text}
              </p>
            )}

            {rememberOpen && (
              <div className="mt-2 rounded-lg p-3" style={{ border: "1px solid #CFE0FA", background: "#F4F8FF" }}>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[520px] border-collapse text-[12.5px]">
                    <thead>
                      <tr className="text-left text-ink-soft">
                        <th className="px-2 py-1 font-bold">Code</th>
                        <th className="px-2 py-1 font-bold">Name in file</th>
                        <th className="px-2 py-1 font-bold">JMT employee</th>
                        <th className="px-2 py-1 font-bold">Email</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rememberable.map((e) => {
                        const p = peopleById.get(mapping[e.key]!);
                        const c = conflicts.find((x) => x.code === e.code);
                        return (
                          <React.Fragment key={e.key}>
                            <tr className="border-t border-[#DCE7FA]">
                              <td className="px-2 py-1 font-bold tabular-nums">{e.code}</td>
                              <td className="px-2 py-1">{e.name || "—"}</td>
                              <td className="px-2 py-1 font-bold text-ink-strong">{p?.name ?? "—"}</td>
                              <td className="px-2 py-1 text-ink-muted">{p?.email ?? ""}</td>
                            </tr>
                            {c && (
                              <tr>
                                <td colSpan={4} className="px-2 pb-2">
                                  <div className="rounded-md px-3 py-2" style={{ background: "#FFFBEB", border: "1px solid #FCD9A0" }}>
                                    {c.messages.map((m) => (
                                      <p key={m} className="text-[12.5px] font-semibold text-[#B45309]">
                                        {m}
                                      </p>
                                    ))}
                                    <label className="mt-1 flex items-start gap-2 text-[12.5px] text-ink-strong">
                                      <input
                                        type="checkbox"
                                        className="mt-0.5 size-4"
                                        checked={replaceOk[e.code] === true}
                                        onChange={(ev) => setReplaceOk((r) => ({ ...r, [e.code]: ev.target.checked }))}
                                      />
                                      Yes, change the existing link for code {e.code}.
                                    </label>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <label className="mt-2 flex items-start gap-2 text-[13px] text-ink-muted">
                  <input type="checkbox" className="mt-0.5 size-4" checked={rememberOk} onChange={(e) => setRememberOk(e.target.checked)} />
                  I have reviewed these matches and each person is the right one for that code.
                </label>
                <button
                  type="button"
                  className={`${BTN} mt-2`}
                  style={rememberOk && !rememberBusy ? PRIMARY : { background: "#EEF0F3", color: "#8A93A0" }}
                  disabled={!rememberOk || rememberBusy}
                  onClick={() => void saveMatches()}
                >
                  {rememberBusy && <Loader2 size={15} className="animate-spin" aria-hidden />}
                  Save {rememberable.length} match{rememberable.length === 1 ? "" : "es"}
                </button>
              </div>
            )}
          </div>
        </section>
      )}

      {employees.length > 0 && (
        <section className={CARD} style={LINE} aria-labelledby="att-check">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <StepTitle n={3}>
              <span id="att-check">Check before importing</span>
            </StepTitle>
            <button
              type="button"
              className={BTN}
              style={allDecided && mappedTwice.size === 0 ? PRIMARY : { background: "#EEF0F3", color: "#8A93A0" }}
              disabled={!allDecided || mappedTwice.size > 0 || busy !== null}
              onClick={() => void check()}
            >
              {busy === "check" && <Loader2 size={15} className="animate-spin" aria-hidden />}
              Check import
            </button>
          </div>
          <p className="mt-1 text-[12.5px] text-ink-muted">
            This only checks. Nothing is saved until you confirm in step 4. Existing punches are never overwritten.
          </p>
          {error && (
            <p role="alert" className="mt-2 flex items-start gap-2 text-[13px] font-semibold text-[#B91C1C]">
              <XCircle size={15} className="mt-0.5 shrink-0" aria-hidden /> {error}
            </p>
          )}

          {preview && <PreviewBlock summary={preview.summary} blockers={preview.blockers} />}

          {preview && preview.issues.length > 0 && (
            <div className="mt-3">
              <div className="flex items-center gap-2 text-[12.5px] flex-wrap">
                <span className="font-bold text-ink-soft">Row messages</span>
                {(["all", "error", "warning", "info"] as const).map((l) => (
                  <button
                    key={l}
                    type="button"
                    onClick={() => setLevel(l)}
                    className="rounded-full px-2.5 py-0.5 font-bold"
                    style={level === l ? { background: "#0A6CFF", color: "#fff" } : { background: "#EEF4FF", color: "#0B4FB8" }}
                  >
                    {l === "info" ? "Already exist" : l === "error" ? "Rejected" : l === "warning" ? "Warnings" : "All"}
                  </button>
                ))}
              </div>
              <div className="mt-2 max-h-[300px] overflow-auto rounded-lg" style={{ border: "1px solid #E6ECF5" }}>
                <table className="w-full min-w-[560px] border-collapse text-[12.5px]">
                  <thead className="sticky top-0 bg-[#F5F7FB]">
                    <tr className="text-left text-ink-soft">
                      <th className="px-3 py-1.5 font-bold">Employee</th>
                      <th className="px-3 py-1.5 font-bold">Date</th>
                      <th className="px-3 py-1.5 font-bold">Row</th>
                      <th className="px-3 py-1.5 font-bold">Result</th>
                    </tr>
                  </thead>
                  <tbody>
                    {issues.slice(0, 500).map((i, ix) => (
                      <tr key={ix} className="border-t border-[#EEF1F6] align-top">
                        <td className="px-3 py-1.5 font-semibold">{i.name || i.sourceKey}</td>
                        <td className="px-3 py-1.5 tabular-nums">{i.date ?? "—"}</td>
                        <td className="px-3 py-1.5 tabular-nums text-ink-subtle">{i.rowNo ?? "—"}</td>
                        <td
                          className="px-3 py-1.5 font-semibold"
                          style={{ color: i.level === "error" ? "#B91C1C" : i.level === "warning" ? "#B45309" : "#0B4FB8" }}
                        >
                          {i.message}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {issues.length > 500 && <p className="mt-1 text-[12px] text-ink-subtle">Showing the first 500 of {issues.length} messages.</p>}
            </div>
          )}
        </section>
      )}

      {preview && (
        <section className={CARD} style={LINE} aria-labelledby="att-confirm">
          <StepTitle n={4}>
            <span id="att-confirm">Confirm and import</span>
          </StepTitle>

          <h3 className="mt-3 text-[13px] font-bold text-ink-soft">Who will receive these punches</h3>
          <div className="mt-1 overflow-x-auto rounded-lg" style={{ border: "1px solid #E6ECF5" }}>
            <table className="w-full min-w-[720px] border-collapse text-[12.5px]">
              <thead>
                <tr className="text-left text-ink-soft" style={{ background: "#F5F7FB" }}>
                  <th className="px-3 py-1.5 font-bold">Code</th>
                  <th className="px-3 py-1.5 font-bold">Name in file</th>
                  <th className="px-3 py-1.5 font-bold">JMT employee</th>
                  <th className="px-3 py-1.5 font-bold">Email</th>
                  <th className="px-3 py-1.5 font-bold">First date</th>
                  <th className="px-3 py-1.5 font-bold">Last date</th>
                  <th className="px-3 py-1.5 text-center font-bold">Punches to import</th>
                  <th className="px-3 py-1.5 text-center font-bold">Already stored</th>
                </tr>
              </thead>
              <tbody>
                {preview.mapped.map((m) => {
                  const src = employees.find((e) => e.key === m.sourceKey);
                  return (
                    <tr key={m.sourceKey} className="border-t border-[#EEF1F6]">
                      <td className="px-3 py-1.5 font-bold tabular-nums">{src?.code ?? m.sourceKey}</td>
                      <td className="px-3 py-1.5">{src?.name || "—"}</td>
                      <td className="px-3 py-1.5 font-bold text-ink-strong">{m.name}</td>
                      <td className="px-3 py-1.5 text-ink-muted">{m.email || "—"}</td>
                      <td className="px-3 py-1.5 tabular-nums">{m.firstDate ?? "—"}</td>
                      <td className="px-3 py-1.5 tabular-nums">{m.lastDate ?? "—"}</td>
                      <td className="px-3 py-1.5 text-center font-bold tabular-nums text-[#047857]">{m.ready}</td>
                      <td className="px-3 py-1.5 text-center tabular-nums text-ink-muted">
                        {m.duplicate + m.mismatch}
                        {m.mismatch > 0 && <span className="ml-1 font-bold text-[#B45309]">({m.mismatch} differ)</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <label className="mt-2 flex items-start gap-2 text-[13px] text-ink-muted">
            <input
              type="checkbox"
              checked={mappingsOk}
              onChange={(e) => setMappingsOk(e.target.checked)}
              className="mt-0.5 size-4"
              disabled={preview.blockers.length > 0 || preview.summary.readyPunches === 0}
            />
            I have checked that every person in the table is the right JMT employee.
          </label>

          <div className="mt-4 rounded-lg px-3 py-2.5" style={{ border: "1px solid #CFE0FA", background: "#F4F8FF" }}>
            <p className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#0B4FB8]">Reporting period</p>
            <p className="mt-0.5 text-[14px] font-bold text-ink-strong tabular-nums">
              {dates.first} → {dates.last}
              <span className="ml-2 font-semibold text-ink-soft">
                · {dates.label} · {dates.distinct} distinct date{dates.distinct === 1 ? "" : "s"} in the file
              </span>
            </p>
            <p className="mt-0.5 text-[12.5px] text-ink-muted tabular-nums">
              Punches to import fall on {preview.punchDates.distinct} date{preview.punchDates.distinct === 1 ? "" : "s"}
              {preview.punchDates.first ? `, ${preview.punchDates.first} → ${preview.punchDates.last}` : ""}.
            </p>
            {[...warnings, ...preview.periodWarnings.filter((w) => !warnings.includes(w))].map((w) => (
              <p key={w} className="mt-1 flex items-start gap-2 text-[12.5px] font-semibold text-[#B45309]">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden /> {w}
              </p>
            ))}
          </div>
          <label className="mt-2 flex items-start gap-2 text-[13px] text-ink-muted">
            <input
              type="checkbox"
              checked={periodOk}
              onChange={(e) => setPeriodOk(e.target.checked)}
              className="mt-0.5 size-4"
              disabled={preview.blockers.length > 0 || preview.summary.readyPunches === 0}
            />
            I confirm the data covers <strong className="text-ink-strong">{dates.label}</strong> ({dates.first} to {dates.last}), whatever the file is called.
          </label>

          <p className="mt-3 text-[13.5px] text-ink-strong">
            You are about to add <strong>{preview.summary.readyPunches}</strong> punch{preview.summary.readyPunches === 1 ? "" : "es"} for{" "}
            <strong>{preview.summary.mappedEmployees}</strong> employee{preview.summary.mappedEmployees === 1 ? "" : "s"}.{" "}
            {preview.summary.duplicatePunches + preview.summary.mismatchPunches} existing punch
            {preview.summary.duplicatePunches + preview.summary.mismatchPunches === 1 ? "" : "es"} will be left as they are
            {preview.summary.mismatchPunches > 0 ? ` (${preview.summary.mismatchPunches} with a different time)` : ""} and{" "}
            {preview.summary.invalidRows} row{preview.summary.invalidRows === 1 ? "" : "s"} will not be imported. Imported punches are
            recorded as admin entries with the reason &ldquo;import&rdquo; and a batch id; salary, leave and overtime are not calculated.
          </p>
          <div className="mt-3">
            <button
              type="button"
              className={BTN}
              style={canImport ? PRIMARY : { background: "#EEF0F3", color: "#8A93A0" }}
              disabled={!canImport}
              onClick={() => void runImport()}
            >
              {busy === "import" && <Loader2 size={15} className="animate-spin" aria-hidden />}
              Import {preview.summary.readyPunches} punch{preview.summary.readyPunches === 1 ? "" : "es"}
            </button>
          </div>
        </section>
      )}

      {result && <ResultBlock result={result} />}
    </div>
  );
}

function PreviewBlock({ summary, blockers }: { summary: PlanSummary; blockers: string[] }) {
  return (
    <div className="mt-3 grid gap-3">
      {blockers.length > 0 && (
        <ul className="grid gap-1 rounded-lg px-3 py-2 text-[13px] font-semibold text-[#B91C1C]" style={{ background: "#FEF2F2", border: "1px solid #FECACA" }}>
          {blockers.map((b) => (
            <li key={b}>{b}</li>
          ))}
        </ul>
      )}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
        <Tile label="Ready to import" value={summary.readyPunches} tone="good" />
        <Tile label="Already stored" value={summary.duplicatePunches} tone="info" />
        <Tile label="Different time stored" value={summary.mismatchPunches} tone={summary.mismatchPunches ? "warn" : undefined} />
        <Tile label="Rejected rows" value={summary.invalidRows} tone={summary.invalidRows ? "bad" : undefined} />
        <Tile label="One punch only" value={summary.singlePunchDays} tone={summary.singlePunchDays ? "warn" : undefined} />
        <Tile label="No punch times" value={summary.noPunchDays} />
        <Tile label="People skipped" value={summary.skippedEmployees} />
      </div>
    </div>
  );
}

function ResultBlock({ result }: { result: ImportRunResult }) {
  const ok = result.failed === 0;
  return (
    <section className={CARD} style={{ border: `1px solid ${ok ? "#A7F3D0" : "#FCD9A0"}` }} aria-live="polite">
      <h2 className="flex items-center gap-2 text-[15px] font-bold text-ink-strong">
        {ok ? <CheckCircle2 size={18} className="text-[#059669]" aria-hidden /> : <AlertTriangle size={18} className="text-[#B45309]" aria-hidden />}
        {ok ? "Import finished" : "Import finished with problems"}
      </h2>
      <p className="mt-1 text-[12.5px] text-ink-muted">
        Batch <span className="font-mono">{result.batchId}</span> · see &ldquo;Previous imports&rdquo; below to inspect or undo it.
      </p>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Tile label="Punches in plan" value={result.planned} />
        <Tile label="Imported" value={result.inserted} tone="good" />
        <Tile label="Skipped (already stored)" value={result.skippedExisting} tone="info" />
        <Tile label="Failed to save" value={result.failed} tone={result.failed ? "bad" : undefined} />
        <Tile label="Rows rejected" value={result.rejectedRows} tone={result.rejectedRows ? "bad" : undefined} />
      </div>
      <p className="mt-1 text-[12px] text-ink-subtle tabular-nums">
        {result.inserted} + {result.skippedExisting} + {result.failed} = {result.inserted + result.skippedExisting + result.failed} of {result.planned} planned punches.
      </p>
      <div className="mt-3 overflow-x-auto rounded-lg" style={{ border: "1px solid #E6ECF5" }}>
        <table className="w-full min-w-[520px] border-collapse text-[12.5px]">
          <thead>
            <tr className="text-left text-ink-soft" style={{ background: "#F5F7FB" }}>
              <th className="px-3 py-1.5 font-bold">Employee</th>
              <th className="px-3 py-1.5 text-center font-bold">In plan</th>
              <th className="px-3 py-1.5 text-center font-bold">Imported</th>
              <th className="px-3 py-1.5 text-center font-bold">Skipped</th>
              <th className="px-3 py-1.5 text-center font-bold">Failed</th>
              <th className="px-3 py-1.5 font-bold">Result</th>
            </tr>
          </thead>
          <tbody>
            {result.perEmployee.map((r) => (
              <tr key={r.sourceKey} className="border-t border-[#EEF1F6]">
                <td className="px-3 py-1.5 font-semibold">{r.name}</td>
                <td className="px-3 py-1.5 text-center tabular-nums">{r.planned}</td>
                <td className="px-3 py-1.5 text-center tabular-nums">{r.inserted}</td>
                <td className="px-3 py-1.5 text-center tabular-nums">{r.skippedExisting}</td>
                <td className="px-3 py-1.5 text-center tabular-nums">{r.failed}</td>
                <td className="px-3 py-1.5 font-semibold" style={{ color: r.error ? "#B91C1C" : "#047857" }}>
                  {r.error ?? (r.inserted > 0 ? "Saved" : "Nothing new to save")}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!ok && (
        <p className="mt-2 flex items-start gap-2 text-[12.5px] text-ink-muted">
          <Info size={14} className="mt-0.5 shrink-0" aria-hidden />
          Employees marked failed had nothing saved. Running the same import again is safe: it only adds what is missing.
        </p>
      )}
    </section>
  );
}
