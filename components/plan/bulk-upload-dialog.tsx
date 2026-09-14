"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, Download, FileSpreadsheet, X } from "lucide-react";
import { toast } from "sonner";
import {
  BULK_MAX_ROWS,
  evaluateBulkRows,
  hasBlockingError,
  parsePastedGrid,
  readBulkGrid,
  templateHeader,
  type BulkRow,
  type RosterEntry,
} from "@/lib/plan/bulk";
import { KIND_LABEL, hasSchedule, type PlanKind } from "@/lib/plan/levels";
import type { PlanBranch } from "@/lib/plan/context";
import { bulkCreatePlanNodes } from "@/app/(project)/project-plan/actions";
import { ParentPickers, ancestorLevels, seedValue, type PickerNode } from "./parent-pickers";
import { PLAN_GRADIENT, PLAN_GRADIENT_BAR, PLAN_RED, PLAN_RED_SOFT, TABULAR } from "./theme";

/**
 * Bulk upload — fifty actions under one result, in one gesture.
 *
 * The reading and checking lives in `lib/plan/bulk.ts` (worth a unit test);
 * this is the dialog around it (not worth one).
 *
 * The destination pickers open PRE-FILLED from the last-accessed branch, so
 * bulk-uploading actions while a result is open needs no destination chosen at
 * all — which is the whole request.
 */

const LEVELS: PlanKind[] = [
  "project",
  "milestone",
  "result",
  "action",
  "sub_action",
  "sub_sub_action",
];

interface Props {
  tree: readonly PickerNode[];
  branch: PlanBranch;
  roster: RosterEntry[];
  onClose: () => void;
  onDone?: () => void;
}

export function BulkUploadDialog({ tree, branch, roster, onClose, onDone }: Props) {
  const router = useRouter();
  const [kind, setKind] = React.useState<PlanKind>(() => {
    // Default to one level below whatever was last opened, which is what
    // somebody with a result on screen almost always means.
    const deepest = branch[branch.length - 1];
    if (!deepest) return "action";
    const index = LEVELS.indexOf(deepest.kind);
    return LEVELS[Math.min(index + 1, LEVELS.length - 1)] ?? "action";
  });
  const [parents, setParents] = React.useState<(string | null)[]>(() =>
    seedValue(kind, branch),
  );
  const [rows, setRows] = React.useState<BulkRow[]>([]);
  const [paste, setPaste] = React.useState("");
  const [pending, startTransition] = React.useTransition();
  const [readError, setReadError] = React.useState<string | null>(null);

  const levels = ancestorLevels(kind);
  const parentId = levels.length === 0 ? null : (parents[levels.length - 1] ?? null);
  const parentReady = levels.length === 0 || Boolean(parentId);

  /** The names already under the destination, for the duplicate flag. */
  const existingNames = React.useMemo(() => {
    if (!parentId) return tree.filter((n) => n.kind === kind).map((n) => n.name);
    const parent = findNode(tree, parentId);
    return (parent?.children ?? []).filter((c) => c.kind === kind).map((c) => c.name);
  }, [tree, parentId, kind]);

  function changeKind(next: PlanKind) {
    setKind(next);
    setParents(seedValue(next, branch));
    // The rows keep their text, but "already under this parent" now means
    // something different, so everything is re-checked.
    setRows((prev) =>
      evaluateBulkRows(prev, { kind: next, existingNames: [], previous: prev }),
    );
  }

  function ingest(grid: string[][]) {
    const res = readBulkGrid(grid, { kind, roster, existingNames });
    if (res.error) {
      setReadError(res.error);
      setRows([]);
      return;
    }
    setReadError(null);
    setRows(res.rows);
  }

  async function readFile(file: File) {
    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: false });
      const sheet = wb.Sheets[wb.SheetNames[0]!];
      if (!sheet) {
        setReadError("That workbook has no sheets.");
        return;
      }
      const grid = XLSX.utils.sheet_to_json<string[]>(sheet, {
        header: 1,
        raw: true,
        defval: "",
      });
      ingest(grid.map((r) => r.map((c) => (c == null ? "" : String(c)))));
    } catch (err) {
      setReadError(`Could not read that file: ${(err as Error).message}`);
    }
  }

  /**
   * Re-check the WHOLE set after every inline edit — "this name is repeated"
   * only means anything in the company of the rows around it, and editing a
   * name has to be able to clear the flag on the row it was clashing with.
   */
  function patchRow(key: string, patch: Partial<BulkRow>) {
    setRows((prev) => {
      const next = prev.map((r) => (r.key === key ? { ...r, ...patch } : r));
      return evaluateBulkRows(next, { kind, existingNames, previous: prev });
    });
  }

  const included = rows.filter((r) => r.include && !hasBlockingError(r));
  const blocked = rows.filter(hasBlockingError).length;

  function submit() {
    if (!parentReady) {
      toast.error("Pick a destination first.");
      return;
    }
    if (included.length === 0) {
      toast.error("Nothing ticked to import.");
      return;
    }
    startTransition(async () => {
      const res = await bulkCreatePlanNodes({
        kind,
        parentId,
        rows: included.map((r) => ({
          name: r.name,
          ownerId: r.ownerId,
          targetDate: r.targetDate,
          startsAt: r.startDate,
          endsAt: r.endDate,
          description: r.description,
        })),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        res.tasksCreated > 0
          ? `Imported ${res.created} rows — ${res.tasksCreated} are now tasks.`
          : `Imported ${res.created} rows.`,
      );
      onClose();
      onDone?.();
      router.refresh();
    });
  }

  function downloadTemplate() {
    // Exactly the columns THIS level has somewhere to put.
    const csv = `﻿${templateHeader(kind).join(",")}\r\n`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${KIND_LABEL[kind].replace(/\s+/g, "-")}-template.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const scheduled = hasSchedule(kind);

  return (
    <Dialog.Root open onOpenChange={(v) => !v && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay
          className="fixed inset-0 z-[60]"
          style={{ background: "rgba(15, 23, 42, 0.45)", backdropFilter: "blur(4px)" }}
        />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[70] -translate-x-1/2 -translate-y-1/2 rounded-section border border-hairline bg-surface-card shadow-xl overflow-hidden flex flex-col"
          style={{ width: `min(1200px, calc(100vw - 48px))`, maxHeight: "calc(100vh - 48px)" }}
        >
          <div
            className="relative px-7 py-5 shrink-0"
            style={{ borderBottom: "1px solid var(--color-hairline)" }}
          >
            <span
              aria-hidden
              className="absolute inset-x-0 top-0 h-[3px]"
              style={{ background: PLAN_GRADIENT_BAR }}
            />
            <Dialog.Title
              className="text-ink-strong font-black"
              style={{ fontSize: 23, letterSpacing: "-0.02em" }}
            >
              Bulk Upload
            </Dialog.Title>
            <Dialog.Description
              className="mt-1 text-[14px]"
              style={{ color: "var(--color-ink-muted)" }}
            >
              Paste a column, paste a block out of Excel, or hand it the file. Every
              row is shown before anything is written.
            </Dialog.Description>
            <Dialog.Close
              className="absolute right-5 top-5 grid place-items-center rounded-lg size-8"
              aria-label="Close"
              style={{ color: "var(--color-ink-subtle)" }}
            >
              <X size={16} strokeWidth={2.4} />
            </Dialog.Close>
          </div>

          <div className="overflow-y-auto min-h-0 px-7 py-5">
            <div className="grid gap-4 md:grid-cols-[300px_1fr]">
              {/* ── Destination ───────────────────────────────────────── */}
              <div
                className="rounded-xl p-3.5 h-fit"
                style={{
                  background: `color-mix(in srgb, ${PLAN_RED_SOFT} 16%, transparent)`,
                  border: "1px solid var(--color-hairline)",
                }}
              >
                <p
                  className="mb-2 text-[12.5px] font-bold uppercase tracking-wide"
                  style={{ color: "var(--color-ink-muted)" }}
                >
                  Import as
                </p>
                <select
                  value={kind}
                  onChange={(e) => changeKind(e.target.value as PlanKind)}
                  className="w-full mb-3 rounded-lg px-2.5 h-9 text-[14px] outline-none focus:ring-1"
                  style={{
                    background: "var(--color-surface-card)",
                    border: "1px solid var(--color-hairline-strong)",
                    color: "var(--color-ink)",
                  }}
                >
                  {LEVELS.map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABEL[k]}
                    </option>
                  ))}
                </select>
                <ParentPickers
                  kind={kind}
                  tree={tree}
                  value={parents}
                  onChange={setParents}
                  branch={branch}
                />
                <button
                  type="button"
                  onClick={downloadTemplate}
                  className="mt-3 w-full inline-flex items-center justify-center gap-1.5 rounded-lg h-8 text-[12.5px] font-semibold"
                  style={{
                    color: PLAN_RED,
                    border: `1px solid color-mix(in srgb, ${PLAN_RED} 32%, transparent)`,
                  }}
                >
                  <Download size={12} strokeWidth={2.6} />
                  Template for {KIND_LABEL[kind]}
                </button>
              </div>

              {/* ── Input ─────────────────────────────────────────────── */}
              <div className="min-w-0">
                <div className="flex items-center gap-2 mb-2">
                  <label
                    className="inline-flex items-center gap-1.5 rounded-lg px-2.5 h-8 text-[12.5px] font-semibold cursor-pointer"
                    style={{
                      color: "var(--color-ink)",
                      border: "1px solid var(--color-hairline-strong)",
                    }}
                  >
                    <FileSpreadsheet size={12} strokeWidth={2.6} />
                    Choose a file
                    <input
                      type="file"
                      accept=".xlsx,.xls,.csv"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) void readFile(f);
                        e.target.value = "";
                      }}
                    />
                  </label>
                  <span className="text-[12px]" style={{ color: "var(--color-ink-subtle)" }}>
                    or paste below — up to {BULK_MAX_ROWS} rows
                  </span>
                </div>

                <textarea
                  value={paste}
                  onChange={(e) => setPaste(e.target.value)}
                  onBlur={() => {
                    if (paste.trim()) ingest(parsePastedGrid(paste));
                  }}
                  rows={4}
                  placeholder={`Name${scheduled ? "\tOwner\tTarget Date" : "\tOwner"}\nVendor demo\tManan\t12-Jun-2026`}
                  className="w-full rounded-lg px-3 py-2 text-[13.5px] font-mono outline-none focus:ring-1"
                  style={{
                    background: "var(--color-surface-card)",
                    border: "1px solid var(--color-hairline-strong)",
                    color: "var(--color-ink)",
                  }}
                />

                {readError && (
                  <p
                    className="mt-2 flex items-start gap-1.5 text-[13px]"
                    style={{ color: "#DC2626" }}
                  >
                    <AlertTriangle size={13} strokeWidth={2.4} className="mt-[1px] shrink-0" />
                    {readError}
                  </p>
                )}

                {rows.length > 0 && (
                  <>
                    <div className="mt-4 flex items-center justify-between">
                      <p className="text-[13px]" style={{ color: "var(--color-ink-muted)" }}>
                        <strong style={TABULAR}>{included.length}</strong> of {rows.length} ready
                        {blocked > 0 && (
                          <span style={{ color: "#DC2626" }}> · {blocked} can&apos;t be imported</span>
                        )}
                      </p>
                    </div>

                    <div
                      className="mt-2 rounded-xl overflow-hidden"
                      style={{ border: "1px solid var(--color-hairline-strong)" }}
                    >
                      <div className="max-h-[320px] overflow-y-auto">
                        <table className="w-full" style={{ borderCollapse: "collapse" }}>
                          <thead className="sticky top-0 z-10">
                            <tr style={{ background: "var(--color-surface-card)" }}>
                              <Th style={{ width: 34 }} />
                              <Th>Name</Th>
                              <Th style={{ width: 150 }}>Doer</Th>
                              <Th style={{ width: 130 }}>Target date</Th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r) => {
                              const blockedRow = hasBlockingError(r);
                              return (
                                <tr
                                  key={r.key}
                                  style={{ borderTop: "1px solid var(--color-hairline)" }}
                                >
                                  <Td>
                                    <input
                                      type="checkbox"
                                      checked={r.include && !blockedRow}
                                      disabled={blockedRow}
                                      onChange={() => patchRow(r.key, { include: !r.include })}
                                      aria-label={`Import ${r.name || "this row"}`}
                                    />
                                  </Td>
                                  <Td>
                                    <input
                                      value={r.name}
                                      onChange={(e) => patchRow(r.key, { name: e.target.value })}
                                      className="w-full rounded-md px-1.5 h-7 text-[13px] outline-none focus:ring-1"
                                      style={{
                                        background: "transparent",
                                        border: "1px solid transparent",
                                        color: "var(--color-ink)",
                                      }}
                                      onFocus={(e) => {
                                        e.currentTarget.style.borderColor =
                                          "var(--color-hairline-strong)";
                                      }}
                                      onBlur={(e) => {
                                        e.currentTarget.style.borderColor = "transparent";
                                      }}
                                    />
                                    {r.issues.map((issue, i) => (
                                      <p
                                        key={i}
                                        className="px-1.5 text-[11.5px] leading-[1.35]"
                                        style={{
                                          color:
                                            issue.level === "error" ? "#DC2626" : "#B45309",
                                        }}
                                      >
                                        {issue.message}
                                      </p>
                                    ))}
                                  </Td>
                                  <Td>
                                    <select
                                      value={r.ownerId ?? ""}
                                      onChange={(e) =>
                                        patchRow(r.key, {
                                          ownerId: e.target.value || null,
                                          ownerText: e.target.value
                                            ? (roster.find((x) => x.id === e.target.value)?.name ??
                                              "")
                                            : "",
                                        })
                                      }
                                      className="w-full rounded-md px-1 h-7 text-[12.5px] outline-none"
                                      style={{
                                        background: "transparent",
                                        border: "1px solid var(--color-hairline)",
                                        color: "var(--color-ink)",
                                      }}
                                    >
                                      <option value="">—</option>
                                      {roster.map((e) => (
                                        <option key={e.id} value={e.id}>
                                          {e.name}
                                        </option>
                                      ))}
                                    </select>
                                  </Td>
                                  <Td>
                                    <input
                                      type="date"
                                      value={r.targetDate ?? ""}
                                      onChange={(e) =>
                                        patchRow(r.key, { targetDate: e.target.value || null })
                                      }
                                      className="w-full rounded-md px-1 h-7 text-[12.5px] outline-none"
                                      style={{
                                        ...TABULAR,
                                        background: "transparent",
                                        border: "1px solid var(--color-hairline)",
                                        color: "var(--color-ink)",
                                      }}
                                    />
                                  </Td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>

          <div
            className="flex items-center justify-end gap-2 px-7 py-4 shrink-0"
            style={{ borderTop: "1px solid var(--color-hairline)" }}
          >
            <Dialog.Close
              className="rounded-lg px-3.5 h-9 text-[14px] font-semibold"
              style={{
                color: "var(--color-ink-muted)",
                border: "1px solid var(--color-hairline-strong)",
              }}
            >
              Cancel
            </Dialog.Close>
            <button
              type="button"
              onClick={submit}
              disabled={pending || included.length === 0 || !parentReady}
              className="rounded-lg px-4 h-9 text-[14px] font-bold text-white disabled:opacity-50"
              style={{ background: PLAN_GRADIENT }}
            >
              {pending ? "Importing…" : `Import ${included.length} rows`}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Th({
  children,
  style,
}: {
  children?: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <th
      className="px-2 py-1.5 text-left text-[11.5px] font-bold uppercase tracking-wide"
      style={{
        color: "var(--color-ink-subtle)",
        borderBottom: "1px solid var(--color-hairline-strong)",
        ...style,
      }}
    >
      {children}
    </th>
  );
}

function Td({ children }: { children: React.ReactNode }) {
  return (
    <td className="px-2 py-1 align-top">
      {children}
    </td>
  );
}

function findNode(nodes: readonly PickerNode[], id: string): PickerNode | null {
  for (const node of nodes) {
    if (node.id === id) return node;
    const hit = findNode(node.children, id);
    if (hit) return hit;
  }
  return null;
}
