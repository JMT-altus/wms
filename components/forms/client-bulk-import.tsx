"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Columns3,
  Download,
  Plus,
  Redo2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import { CancelButton } from "@/components/admin/master/drawer";
import { CenterDialog } from "@/components/ui/center-dialog";
import { KYC_ACCENT, KYC_ACCENT_SOFT } from "./kyc/tokens";
import { parseDelimited } from "@/lib/masters/bulk-parse";
import {
  COLUMN_BY_KEY,
  STANDARD_COLUMN_KEYS,
  groupedColumns,
  isBlankRow,
  matchHeader,
  optionsFor,
  orderColumns,
  splitMulti,
  validateCell,
  type ClientBulkColumn,
  type ClientBulkOptions,
  type SheetRow,
} from "@/lib/forms/client-bulk-columns";
import {
  bulkImportClients,
  type BulkImportRowError,
} from "@/app/(forms-module)/forms/client-kyc/actions";

/**
 * Bulk Import — Clients: a sheet you type into, not a file you hand over.
 *
 * This replaces the file-only upload the Client Master used to open. The old
 * flow's failure mode was structural: you uploaded, the server told you rows
 * 4, 19 and 37 were wrong, and the only way to fix them was to reopen Excel,
 * find those rows, guess what "invalid" meant and upload the whole thing
 * again. Here the file lands *in* the sheet, every flagged cell says what is
 * wrong with it, and you fix it where it sits.
 *
 * The sheet is columns-on-demand: eight to start, ~40 available. See
 * lib/forms/client-bulk-columns.ts, which both this and the server action
 * read, so a column can never exist on screen with nowhere to land.
 */

/** Rows the sheet opens with — enough to paste into without pressing Add row. */
const INITIAL_ROWS = 12;
/** The guard on a very large paste or file. */
const MAX_ROWS = 500;

interface GridState {
  columns: string[];
  rows: SheetRow[];
}

const blankRows = (n: number): SheetRow[] => Array.from({ length: n }, () => ({}));

const initialState = (): GridState => ({
  columns: [...STANDARD_COLUMN_KEYS],
  rows: blankRows(INITIAL_ROWS),
});

/* ── Entry point ─────────────────────────────────────────────────────────── */

export function ClientBulkImport({ options }: { options: ClientBulkOptions }) {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="Bulk Import"
        className="shrink-0 inline-flex items-center gap-1.5 rounded-chip px-3.5 h-10 text-[14px] font-semibold text-ink-soft bg-surface-card border border-hairline whitespace-nowrap transition-colors hover:border-hairline-strong hover:text-ink-strong"
      >
        <Upload size={15} strokeWidth={2.3} className="shrink-0" />
        Bulk Import
      </button>
      {open && <BulkImportSheet options={options} onClose={() => setOpen(false)} />}
    </>
  );
}

/* ── The sheet ───────────────────────────────────────────────────────────── */

function BulkImportSheet({
  options,
  onClose,
}: {
  options: ClientBulkOptions;
  onClose: () => void;
}) {
  const router = useRouter();

  const [state, setState] = React.useState<GridState>(initialState);
  /**
   * Undo/redo over whole grid snapshots.
   *
   * Snapshots rather than a diff log because every mutation here is small and
   * the grid is at most 500 rows: the simple thing is fast enough, and it
   * makes "undo an Add column" and "undo a 200-row paste" the same code path
   * as "undo a keystroke".
   */
  const [past, setPast] = React.useState<GridState[]>([]);
  const [future, setFuture] = React.useState<GridState[]>([]);
  /** Consecutive edits to one cell coalesce, so Ctrl+Z is not per-keystroke. */
  const lastEdit = React.useRef<string | null>(null);

  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ created: number } | null>(null);
  /** Server verdicts, keyed by the sheet row index they came back on. */
  const [rowErrors, setRowErrors] = React.useState<Map<number, string>>(new Map());

  const [active, setActive] = React.useState<{ r: number; c: number } | null>(null);
  const cellRefs = React.useRef(new Map<string, HTMLElement>());
  const fileRef = React.useRef<HTMLInputElement>(null);

  const columns = React.useMemo(
    () => state.columns.map((k) => COLUMN_BY_KEY.get(k)!).filter(Boolean),
    [state.columns],
  );

  /* ── Mutation, with history ────────────────────────────────────────────── */

  const commit = React.useCallback(
    (next: GridState | ((prev: GridState) => GridState), coalesceKey?: string) => {
      setState((prev) => {
        const value = typeof next === "function" ? next(prev) : next;
        const coalesce = coalesceKey != null && coalesceKey === lastEdit.current;
        if (!coalesce) setPast((p) => [...p.slice(-99), prev]);
        lastEdit.current = coalesceKey ?? null;
        return value;
      });
      setFuture([]);
      setRowErrors(new Map());
    },
    [],
  );

  const undo = React.useCallback(() => {
    setPast((p) => {
      if (p.length === 0) return p;
      const previous = p[p.length - 1]!;
      setState((current) => {
        setFuture((f) => [current, ...f]);
        return previous;
      });
      lastEdit.current = null;
      return p.slice(0, -1);
    });
  }, []);

  const redo = React.useCallback(() => {
    setFuture((f) => {
      if (f.length === 0) return f;
      const next = f[0]!;
      setState((current) => {
        setPast((p) => [...p, current]);
        return next;
      });
      lastEdit.current = null;
      return f.slice(1);
    });
  }, []);

  const setCell = React.useCallback(
    (r: number, key: string, value: string) => {
      commit(
        (prev) => {
          const rows = [...prev.rows];
          rows[r] = { ...rows[r], [key]: value };
          return { ...prev, rows };
        },
        `${r}:${key}`,
      );
    },
    [commit],
  );

  const addRows = React.useCallback(
    (n: number) => {
      commit((prev) => ({
        ...prev,
        rows: [...prev.rows, ...blankRows(Math.min(n, MAX_ROWS - prev.rows.length))],
      }));
    },
    [commit],
  );

  const removeRow = React.useCallback(
    (r: number) => {
      commit((prev) => ({
        ...prev,
        rows: prev.rows.length === 1 ? blankRows(1) : prev.rows.filter((_, i) => i !== r),
      }));
    },
    [commit],
  );

  const addColumn = React.useCallback(
    (key: string) => {
      commit((prev) =>
        prev.columns.includes(key)
          ? prev
          : { ...prev, columns: orderColumns([...prev.columns, key]) },
      );
    },
    [commit],
  );

  const removeColumn = React.useCallback(
    (key: string) => {
      commit((prev) => ({
        columns: prev.columns.filter((k) => k !== key),
        // Drop the values too. Keeping them would mean a column removed by
        // mistake and added back showed stale text, and a hidden column
        // silently importing is exactly the surprise this sheet exists to
        // remove.
        rows: prev.rows.map((row) => {
          const { [key]: _drop, ...rest } = row;
          return rest;
        }),
      }));
    },
    [commit],
  );

  /* ── Validation ────────────────────────────────────────────────────────── */

  /** Cell key → what is wrong with it. Recomputed from the grid, never stored. */
  const cellErrors = React.useMemo(() => {
    const out = new Map<string, string>();
    state.rows.forEach((row, r) => {
      if (isBlankRow(row)) return;
      for (const column of columns) {
        const problem = validateCell(column, row[column.key] ?? "", options);
        if (problem) out.set(`${r}:${column.key}`, problem);
      }
    });
    return out;
  }, [state.rows, columns, options]);

  /** Rows that would import right now. */
  const readyRows = React.useMemo(
    () =>
      state.rows
        .map((row, r) => ({ row, r }))
        .filter(
          ({ row, r }) =>
            !isBlankRow(row) &&
            !columns.some((c) => cellErrors.has(`${r}:${c.key}`)) &&
            !rowErrors.has(r),
        ),
    [state.rows, columns, cellErrors, rowErrors],
  );

  const flaggedCount = React.useMemo(() => {
    const rows = new Set<number>();
    for (const k of cellErrors.keys()) rows.add(Number(k.split(":")[0]));
    for (const r of rowErrors.keys()) rows.add(r);
    return rows.size;
  }, [cellErrors, rowErrors]);

  /* ── Keyboard + paste ──────────────────────────────────────────────────── */

  const focusCell = React.useCallback((r: number, c: number) => {
    const el = cellRefs.current.get(`${r}:${c}`);
    if (el) {
      el.focus();
      if (el instanceof HTMLInputElement) el.select();
    }
  }, []);

  function onGridKeyDown(e: React.KeyboardEvent) {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
      return;
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
      return;
    }
    if (!active) return;
    const { r, c } = active;
    if (e.key === "ArrowDown" || e.key === "Enter") {
      if (r + 1 < state.rows.length) {
        e.preventDefault();
        focusCell(r + 1, c);
      }
      return;
    }
    if (e.key === "ArrowUp") {
      if (r > 0) {
        e.preventDefault();
        focusCell(r - 1, c);
      }
    }
  }

  /**
   * Paste a block copied from Excel.
   *
   * Excel puts tab-separated cells and newline-separated rows on the
   * clipboard, so a multi-cell paste is recognisable without asking. A
   * single-cell paste is left to the browser — intercepting it would break
   * pasting half a company name into the middle of a word.
   */
  function onGridPaste(e: React.ClipboardEvent) {
    if (!active) return;
    const text = e.clipboardData.getData("text/plain");
    if (!text || (!text.includes("\t") && !text.trim().includes("\n"))) return;
    e.preventDefault();

    const matrix = text
      .replace(/\r\n?/g, "\n")
      .replace(/\n$/, "")
      .split("\n")
      .map((line) => line.split("\t"));

    commit((prev) => {
      const rows = [...prev.rows];
      const needed = active.r + matrix.length;
      while (rows.length < Math.min(needed, MAX_ROWS)) rows.push({});

      matrix.forEach((line, dr) => {
        const r = active.r + dr;
        if (r >= rows.length) return;
        const row = { ...rows[r] };
        line.forEach((value, dc) => {
          const column = prev.columns[active.c + dc];
          if (column) row[column] = value.trim();
        });
        rows[r] = row;
      });

      return { ...prev, rows };
    });
    lastEdit.current = null;
  }

  /* ── Template + file ───────────────────────────────────────────────────── */

  /**
   * Download the template for the columns currently on screen.
   *
   * An .xlsx from the server, not a CSV built here: the point of the file is
   * the dropdowns, and only a workbook can carry them. It opens in Google
   * Sheets or Excel with every option-backed column already validated
   * against the live masters — see lib/forms/client-template-workbook.ts.
   */
  function downloadTemplate() {
    const href = `/forms/client-kyc/client-template.xlsx?cols=${encodeURIComponent(
      state.columns.join(","),
    )}`;
    const a = document.createElement("a");
    a.href = href;
    a.rel = "noopener";
    a.click();
  }

  /**
   * Read a CSV/XLSX into the sheet.
   *
   * Headings match by alias (lib/forms/client-bulk-columns.ts), so a Tally or
   * Sheets export lands in the right columns with no mapping step — and a
   * column the file carries but the sheet is not showing gets added rather
   * than dropped. A heading nothing matches is reported, not silently eaten.
   */
  async function onFile(file: File) {
    setError(null);
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
        // Round-trip through CSV so there is one parser, not two — and so a
        // cell reads as the text Excel shows rather than a serial number.
        parsed = parseDelimited(XLSX.utils.sheet_to_csv(sheet, { blankrows: false }));
      } else {
        parsed = parseDelimited(await file.text());
      }

      if (parsed.rows.length === 0) {
        setError("That file has a heading row but no data rows.");
        return;
      }
      if (parsed.rows.length > MAX_ROWS) {
        setError(`That file has ${parsed.rows.length} rows — import up to ${MAX_ROWS} at a time.`);
        return;
      }

      const matched = new Map<string, string>();
      const unmatched: string[] = [];
      for (const header of parsed.headers) {
        const column = matchHeader(header);
        if (column) matched.set(header, column.key);
        else if (header.trim()) unmatched.push(header.trim());
      }
      if (matched.size === 0) {
        setError(
          "None of that file's headings matched a client field. Download the Template to see the headings the sheet reads.",
        );
        return;
      }

      const nextColumns = orderColumns([
        ...new Set([...state.columns, ...matched.values()]),
      ]);
      const rows: SheetRow[] = parsed.rows.map((source) => {
        const row: SheetRow = {};
        for (const [header, key] of matched) row[key] = (source[header] ?? "").trim();
        return row;
      });
      // A few spare rows under the file, so adding one more client after an
      // import does not need Add row first.
      commit({ columns: nextColumns, rows: [...rows, ...blankRows(3)] });
      setResult(null);
      if (unmatched.length > 0) {
        setError(
          `Ignored ${unmatched.length} unrecognised column${unmatched.length === 1 ? "" : "s"}: ${unmatched.join(", ")}.`,
        );
      }
    } catch (err) {
      setError(`Could not read that file: ${(err as Error).message}`);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  /* ── Import ────────────────────────────────────────────────────────────── */

  async function onImport() {
    if (readyRows.length === 0) return;
    setBusy(true);
    setError(null);

    // Send only the columns on screen. The server re-validates everything, so
    // this is about not posting stale values from a column that was removed.
    const payload = readyRows.map(({ row }) => {
      const out: SheetRow = {};
      for (const c of columns) if ((row[c.key] ?? "").trim()) out[c.key] = row[c.key]!.trim();
      return out;
    });

    const res = await bulkImportClients({ rows: payload });
    setBusy(false);

    if (!res.ok) {
      setError(res.error);
      return;
    }

    // Map the server's row numbers (positions in what we sent) back to the
    // sheet rows the user is looking at, and keep only those. Everything that
    // imported disappears; what is left is exactly what still needs a fix.
    const failed = new Map<number, string>();
    for (const e of res.rowErrors as BulkImportRowError[]) {
      const origin = readyRows[e.row - 1];
      if (origin) failed.set(origin.r, e.message);
    }

    setResult({ created: res.created });

    if (failed.size > 0) {
      const keep = [...failed.keys()].sort((a, b) => a - b);
      setState((prev) => ({
        ...prev,
        rows: keep.map((r) => prev.rows[r]!),
      }));
      setRowErrors(new Map(keep.map((r, i) => [i, failed.get(r)!])));
    } else {
      setState((prev) => ({ ...prev, rows: blankRows(INITIAL_ROWS) }));
      setRowErrors(new Map());
    }
    setPast([]);
    setFuture([]);
    router.refresh();
  }

  const readyLabel = `${readyRows.length} ready`;

  return (
    <CenterDialog
      open
      title="Bulk Import — Clients"
      subtitle="Type straight into the sheet or paste from Excel — flagged cells stay editable until they are right."
      onClose={onClose}
      width={1560}
      accentBar={`linear-gradient(90deg, ${KYC_ACCENT} 0%, var(--color-indigo) 100%)`}
      footer={
        <>
          <CancelButton onClick={onClose} />
          <button
            type="button"
            onClick={onImport}
            disabled={busy || readyRows.length === 0}
            className="rounded-xl px-5 py-2.5 text-white font-bold disabled:opacity-50"
            style={{ fontSize: 14.5, background: KYC_ACCENT }}
          >
            {busy
              ? "Importing…"
              : `Import ${readyRows.length} Client${readyRows.length === 1 ? "" : "s"}`}
          </button>
        </>
      }
    >
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <ToolbarButton onClick={() => addRows(1)} icon={<Plus size={15} strokeWidth={2.6} />}>
          Add row
        </ToolbarButton>
        <AddColumnMenu shown={state.columns} onAdd={addColumn} />

        <span aria-hidden style={{ width: 1, height: 22, background: "var(--color-hairline)" }} />

        <ToolbarButton
          onClick={undo}
          disabled={past.length === 0}
          icon={<Undo2 size={15} strokeWidth={2.4} />}
        >
          Undo
        </ToolbarButton>
        <ToolbarButton
          onClick={redo}
          disabled={future.length === 0}
          icon={<Redo2 size={15} strokeWidth={2.4} />}
        >
          Redo
        </ToolbarButton>

        <span aria-hidden style={{ width: 1, height: 22, background: "var(--color-hairline)" }} />

        <ToolbarButton onClick={downloadTemplate} icon={<Download size={15} strokeWidth={2.4} />}>
          Template
        </ToolbarButton>
        <ToolbarButton
          onClick={() => fileRef.current?.click()}
          icon={<Upload size={15} strokeWidth={2.4} />}
        >
          Upload file
        </ToolbarButton>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,.xlsx,.xls,text/csv"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onFile(f);
          }}
        />

        <span className="ml-auto font-bold" style={{ fontSize: 14 }}>
          <span style={{ color: readyRows.length > 0 ? "var(--color-green-deep)" : "var(--color-ink-subtle)" }}>
            {readyLabel}
          </span>
          {flaggedCount > 0 && (
            <span style={{ color: "var(--color-red-deep)" }}> · {flaggedCount} to fix</span>
          )}
        </span>
      </div>

      <p className="mt-3 text-[13px] text-ink-muted">
        Type straight into the sheet, or paste a block copied from Excel. Arrow keys and Tab move
        between cells; Ctrl+Z undoes. Blank rows are ignored on import.
      </p>

      {error && (
        <div
          className="mt-4 rounded-chip px-3.5 py-3 flex items-start gap-2.5"
          style={{
            background: "color-mix(in srgb, var(--color-amber) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--color-amber) 28%, transparent)",
          }}
        >
          <AlertTriangle
            size={16}
            strokeWidth={2.3}
            style={{ color: "var(--color-amber-deep)", marginTop: 1 }}
          />
          <p className="text-[13.5px]" style={{ color: "var(--color-amber-deep)" }}>
            {error}
          </p>
        </div>
      )}

      {result && (
        <div
          className="mt-4 rounded-chip px-4 py-3"
          style={{
            background: "color-mix(in srgb, var(--color-green) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--color-green) 28%, transparent)",
          }}
        >
          <p
            className="flex items-center gap-2 font-bold text-[14.5px]"
            style={{ color: "var(--color-green-deep)" }}
          >
            <CheckCircle2 size={17} strokeWidth={2.4} />
            {result.created} client{result.created === 1 ? "" : "s"} imported.
          </p>
          <p className="mt-1 text-[13px] text-ink-soft">
            They are in the Client Master now. Contacts, addresses and bank accounts are added in
            their own directories.
          </p>
        </div>
      )}

      {/* The sheet */}
      <div
        className="mt-4 rounded-section border border-hairline overflow-auto"
        style={{ maxHeight: "56vh" }}
        onKeyDown={onGridKeyDown}
        onPaste={onGridPaste}
      >
        <table className="border-collapse" style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th
                className="sticky top-0 left-0 z-30 px-2 py-2.5"
                style={{
                  width: 44,
                  minWidth: 44,
                  background: "var(--color-surface-soft)",
                  borderRight: "1px solid var(--color-hairline)",
                  borderBottom: "1px solid var(--color-hairline)",
                }}
              />
              {columns.map((column) => (
                <th
                  key={column.key}
                  className="sticky top-0 z-20 px-3 py-2.5 text-left align-middle"
                  style={{
                    width: column.width,
                    minWidth: column.width,
                    background: "var(--color-surface-soft)",
                    borderRight: "1px solid var(--color-hairline)",
                    borderBottom: "1px solid var(--color-hairline)",
                  }}
                >
                  <div className="flex items-center gap-1.5">
                    <span
                      className="uppercase font-bold tracking-[0.06em] text-ink-strong truncate"
                      style={{ fontSize: 11 }}
                      title={column.hint ?? column.label}
                    >
                      {column.label}
                      {column.required && (
                        <span style={{ color: "var(--color-red-deep)" }}> *</span>
                      )}
                    </span>
                    {!column.required && (
                      <button
                        type="button"
                        onClick={() => removeColumn(column.key)}
                        title={`Remove the ${column.label} column`}
                        className="ml-auto shrink-0 grid place-items-center rounded-full text-ink-subtle transition-colors hover:text-ink-strong hover:bg-surface-card"
                        style={{ width: 18, height: 18 }}
                      >
                        <X size={12} strokeWidth={2.6} />
                      </button>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {state.rows.map((row, r) => {
              const serverError = rowErrors.get(r);
              return (
                <tr key={r}>
                  <td
                    className="sticky left-0 z-10 text-center align-middle"
                    style={{
                      background: serverError
                        ? "color-mix(in srgb, var(--color-red) 12%, var(--color-surface-soft))"
                        : "var(--color-surface-soft)",
                      borderRight: "1px solid var(--color-hairline)",
                      borderBottom: "1px solid var(--color-hairline)",
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => removeRow(r)}
                      title={serverError ?? "Remove this row"}
                      className="w-full h-full px-2 py-2 font-semibold text-ink-subtle transition-colors hover:text-ink-strong"
                      style={{ fontSize: 12 }}
                    >
                      {r + 1}
                    </button>
                  </td>
                  {columns.map((column, c) => (
                    <Cell
                      key={column.key}
                      column={column}
                      value={row[column.key] ?? ""}
                      error={cellErrors.get(`${r}:${column.key}`) ?? null}
                      rowFlagged={Boolean(serverError)}
                      options={options}
                      onChange={(v) => setCell(r, column.key, v)}
                      onFocus={() => setActive({ r, c })}
                      registerRef={(el) => {
                        if (el) cellRefs.current.set(`${r}:${c}`, el);
                        else cellRefs.current.delete(`${r}:${c}`);
                      }}
                    />
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* What is wrong, row by row — the sheet flags, this explains. */}
      {(cellErrors.size > 0 || rowErrors.size > 0) && (
        <div className="mt-3 rounded-chip border border-hairline bg-surface-soft px-3.5 py-3 max-h-40 overflow-y-auto">
          <p className="font-bold text-ink-strong" style={{ fontSize: 12.5 }}>
            {flaggedCount} row{flaggedCount === 1 ? "" : "s"} still to fix
          </p>
          <ul className="mt-1.5 text-[12.5px] text-ink-soft space-y-0.5">
            {[...rowErrors.entries()].map(([r, message]) => (
              <li key={`server-${r}`}>
                <strong>Row {r + 1}</strong> — {message}
              </li>
            ))}
            {[...cellErrors.entries()].slice(0, 40).map(([key, message]) => (
              <li key={key}>
                <strong>Row {Number(key.split(":")[0]) + 1}</strong> — {message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </CenterDialog>
  );
}

/* ── Toolbar ─────────────────────────────────────────────────────────────── */

function ToolbarButton({
  onClick,
  disabled,
  icon,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-chip px-3 h-9 font-semibold text-ink-soft bg-surface-card border border-hairline transition-colors hover:border-hairline-strong hover:text-ink-strong disabled:opacity-40 disabled:hover:border-hairline disabled:hover:text-ink-soft"
      style={{ fontSize: 13.5 }}
    >
      {icon}
      {children}
    </button>
  );
}

/**
 * Add column — the ~40 client fields not currently in the sheet.
 *
 * Grouped and ordered the way the KYC form is, so finding a field means
 * thinking about the form you already know rather than reading an alphabetical
 * list of column names.
 */
function AddColumnMenu({
  shown,
  onAdd,
}: {
  shown: string[];
  onAdd: (key: string) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const boxRef = React.useRef<HTMLDivElement>(null);
  useDismiss(boxRef, open, () => setOpen(false));

  const groups = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return groupedColumns()
      .map((g) => ({
        group: g.group,
        columns: g.columns.filter(
          (c) => !shown.includes(c.key) && (!q || c.label.toLowerCase().includes(q)),
        ),
      }))
      .filter((g) => g.columns.length > 0);
  }, [shown, query]);

  const remaining = groups.reduce((n, g) => n + g.columns.length, 0);

  return (
    <div className="relative" ref={boxRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={remaining === 0 && !query}
        className="inline-flex items-center gap-1.5 rounded-chip px-3 h-9 font-semibold border transition-colors disabled:opacity-40"
        style={{
          fontSize: 13.5,
          color: KYC_ACCENT,
          background: KYC_ACCENT_SOFT,
          borderColor: `color-mix(in srgb, ${KYC_ACCENT} 30%, transparent)`,
        }}
      >
        <Columns3 size={15} strokeWidth={2.4} />
        Add column
        <ChevronDown size={13} strokeWidth={2.6} />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-1.5 z-50 rounded-section border border-hairline bg-surface-card shadow-xl overflow-hidden"
          style={{ width: 300 }}
        >
          <div className="p-2" style={{ borderBottom: "1px solid var(--color-hairline)" }}>
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search fields…"
              className="w-full rounded-chip px-2.5 h-8 bg-surface-soft border border-hairline text-[13px] text-ink-strong outline-none"
            />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {groups.length === 0 && (
              <p className="px-3 py-3 text-[13px] text-ink-muted">
                Every client field is already in the sheet.
              </p>
            )}
            {groups.map((g) => (
              <div key={g.group}>
                <p
                  className="px-3 pt-2 pb-1 uppercase font-bold tracking-[0.08em] text-ink-subtle"
                  style={{ fontSize: 10 }}
                >
                  {g.group}
                </p>
                {g.columns.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => {
                      onAdd(c.key);
                      setQuery("");
                    }}
                    className="w-full text-left px-3 py-1.5 transition-colors hover:bg-surface-soft"
                  >
                    <span className="block font-semibold text-ink-strong" style={{ fontSize: 13 }}>
                      {c.label}
                    </span>
                    {c.hint && (
                      <span className="block text-ink-muted" style={{ fontSize: 11.5 }}>
                        {c.hint}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Cells ───────────────────────────────────────────────────────────────── */

function Cell({
  column,
  value,
  error,
  rowFlagged,
  options,
  onChange,
  onFocus,
  registerRef,
}: {
  column: ClientBulkColumn;
  value: string;
  error: string | null;
  rowFlagged: boolean;
  options: ClientBulkOptions;
  onChange: (value: string) => void;
  onFocus: () => void;
  registerRef: (el: HTMLElement | null) => void;
}) {
  const tone = error
    ? "color-mix(in srgb, var(--color-red) 11%, transparent)"
    : rowFlagged
      ? "color-mix(in srgb, var(--color-red) 5%, transparent)"
      : undefined;

  return (
    <td
      title={error ?? undefined}
      style={{
        width: column.width,
        minWidth: column.width,
        background: tone,
        borderRight: "1px solid var(--color-hairline)",
        borderBottom: "1px solid var(--color-hairline)",
        padding: 0,
      }}
    >
      {column.kind === "select" || column.kind === "multi" ? (
        <OptionCell
          column={column}
          value={value}
          options={options}
          onChange={onChange}
          onFocus={onFocus}
          registerRef={registerRef}
        />
      ) : (
        <input
          ref={registerRef as (el: HTMLInputElement | null) => void}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={onFocus}
          inputMode={column.kind === "number" ? "decimal" : undefined}
          className="w-full px-3 py-2 bg-transparent text-ink-strong outline-none"
          style={{ fontSize: 13, height: 38 }}
        />
      )}
    </td>
  );
}

/**
 * A cell backed by a master list — one value, or several.
 *
 * A hand-rolled popup rather than `<select>` because three of these columns
 * are multi-value (Customer Type, Industry Type, Product Types), and a
 * `<select multiple>` is unusable at row height. The same popup does both, so
 * a single-value and a multi-value cell look and behave the same everywhere
 * except in what a click does.
 *
 * Free-text columns keep a typing box: State and Payment Terms are stored as
 * text, and the list is a suggestion, not a constraint.
 */
function OptionCell({
  column,
  value,
  options,
  onChange,
  onFocus,
  registerRef,
}: {
  column: ClientBulkColumn;
  value: string;
  options: ClientBulkOptions;
  onChange: (value: string) => void;
  onFocus: () => void;
  registerRef: (el: HTMLElement | null) => void;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const boxRef = React.useRef<HTMLDivElement>(null);
  useDismiss(boxRef, open, () => {
    setOpen(false);
    setQuery("");
  });

  const list = optionsFor(column, options);
  const selected = column.kind === "multi" ? splitMulti(value) : value.trim() ? [value.trim()] : [];
  const selectedKeys = new Set(selected.map((s) => s.toLowerCase()));

  const shown = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? list.filter((o) => o.toLowerCase().includes(q)) : list;
  }, [list, query]);

  function pick(option: string) {
    if (column.kind === "multi") {
      const next = selectedKeys.has(option.toLowerCase())
        ? selected.filter((s) => s.toLowerCase() !== option.toLowerCase())
        : [...selected, option];
      onChange(next.join(", "));
    } else {
      onChange(option);
      setOpen(false);
      setQuery("");
    }
  }

  return (
    <div className="relative" ref={boxRef}>
      <button
        ref={registerRef as (el: HTMLButtonElement | null) => void}
        type="button"
        onFocus={onFocus}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1 px-3 text-left"
        style={{ height: 38 }}
      >
        <span
          className="flex-1 min-w-0 truncate"
          style={{
            fontSize: 13,
            color: selected.length > 0 ? "var(--color-ink-strong)" : "var(--color-ink-subtle)",
            fontWeight: selected.length > 0 ? 600 : 400,
          }}
        >
          {selected.length > 0 ? selected.join(", ") : "— leave blank —"}
        </span>
        <ChevronDown size={13} strokeWidth={2.4} className="shrink-0 text-ink-subtle" />
      </button>

      {open && (
        <div
          className="absolute left-0 top-full mt-0.5 z-50 rounded-chip border border-hairline bg-surface-card shadow-xl overflow-hidden"
          style={{ width: Math.max(column.width, 220) }}
        >
          {(list.length > 8 || column.freeText) && (
            <div className="p-1.5" style={{ borderBottom: "1px solid var(--color-hairline)" }}>
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && column.freeText && query.trim()) {
                    e.preventDefault();
                    pick(query.trim());
                    setQuery("");
                  }
                }}
                placeholder={column.freeText ? "Search or type your own…" : "Search…"}
                className="w-full rounded-chip px-2 h-7 bg-surface-soft border border-hairline text-[12.5px] text-ink-strong outline-none"
              />
            </div>
          )}

          <div className="max-h-56 overflow-y-auto py-1">
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
                setQuery("");
              }}
              className="w-full text-left px-3 py-1.5 text-ink-muted transition-colors hover:bg-surface-soft"
              style={{ fontSize: 12.5 }}
            >
              — leave blank —
            </button>

            {column.freeText && query.trim() && !list.some((o) => o.toLowerCase() === query.trim().toLowerCase()) && (
              <button
                type="button"
                onClick={() => {
                  pick(query.trim());
                  setQuery("");
                }}
                className="w-full text-left px-3 py-1.5 font-semibold transition-colors hover:bg-surface-soft"
                style={{ fontSize: 12.5, color: KYC_ACCENT }}
              >
                Use “{query.trim()}”
              </button>
            )}

            {shown.map((option) => {
              const on = selectedKeys.has(option.toLowerCase());
              return (
                <button
                  key={option}
                  type="button"
                  onClick={() => pick(option)}
                  className="w-full text-left px-3 py-1.5 flex items-center gap-2 transition-colors hover:bg-surface-soft"
                  style={{ fontSize: 12.5 }}
                >
                  {column.kind === "multi" && (
                    <span
                      aria-hidden
                      className="shrink-0 grid place-items-center rounded"
                      style={{
                        width: 14,
                        height: 14,
                        border: `1.5px solid ${on ? KYC_ACCENT : "var(--color-hairline-strong)"}`,
                        background: on ? KYC_ACCENT : "transparent",
                      }}
                    >
                      {on && (
                        <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
                          <path
                            d="M2.5 6.5L5 9L9.5 3.5"
                            stroke="#fff"
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      )}
                    </span>
                  )}
                  <span
                    className="truncate"
                    style={{
                      color: on ? "var(--color-ink-strong)" : "var(--color-ink-soft)",
                      fontWeight: on ? 600 : 400,
                    }}
                  >
                    {option}
                  </span>
                </button>
              );
            })}

            {shown.length === 0 && !column.freeText && (
              <p className="px-3 py-2 text-ink-muted" style={{ fontSize: 12.5 }}>
                Nothing matches. Add it to the master first.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/** Close a popup on an outside click or Escape. */
function useDismiss(
  ref: React.RefObject<HTMLElement | null>,
  active: boolean,
  close: () => void,
): void {
  React.useEffect(() => {
    if (!active) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [ref, active, close]);
}
