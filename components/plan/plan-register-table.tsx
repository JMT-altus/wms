"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { ArrowUpDown, ExternalLink, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  CHILD_KIND,
  KIND_LABEL,
  KIND_LABEL_PLURAL,
  durationDays,
  formatPlanDate,
  hasSchedule,
  isExecutable,
  levelStyleProps,
} from "@/lib/plan/levels";
import {
  ANCESTOR_KINDS,
  FREEZE_WIDTH,
  LEVEL_KIND,
  ROLLUP_KIND,
  buildRegisterRows,
  freezeOffsets,
  registerRowMatches,
  type RegisterLevel,
  type RegisterRow,
} from "@/lib/plan/register";
import { matchesChip, type PlanChip } from "@/lib/plan/table";
import {
  formatCompleted,
  formatCompletion,
  nodeFraction,
  projectFraction,
  toPercent,
} from "@/lib/plan/progress";
import { actorForRow, type PlanViewer } from "@/lib/plan/viewer";
import type { PlanNode } from "@/lib/queries/plan";
import {
  bulkSetPlanNodeStatus,
  bulkUpdatePlanNodes,
  deletePlanNode,
  duplicatePlanNode,
} from "@/app/(project)/project-plan/actions";
import { PlanStatusCell } from "./plan-status-cell";
import { PlanPanelCell } from "./plan-panel-cell";
import { PlanRef } from "./plan-ref";
import { PlanEditDialog } from "./plan-edit-dialog";
import { PlanDeleteDialog } from "./plan-delete-dialog";
import { PlanBulkBar } from "./plan-bulk-bar";
import { PLAN_RED, PLAN_RED_SOFT, PLAN_ROW_LINE, TABULAR } from "./theme";

/**
 * The registers — one level, flat, carrying the chain of parents above it.
 *
 * A FLATTENING OF THE SAME TREE, not a second query and not a denormalised
 * copy — which is what stops a row reporting one status here and another on
 * the board.
 *
 * Sorting lives in the column headers. There is no CSV button here: the
 * hierarchy view (`?view=tree`) carries the export for the whole plan, and a
 * second one on every register was a control nobody reached for.
 */

type SortKey = "plan" | "name" | "status" | "target" | "completion" | "rollup";

interface Props {
  tree: PlanNode[];
  level: RegisterLevel;
  viewer: PlanViewer;
  query: string;
  projectId: string | null;
  /** The header chip, honoured here exactly as the hierarchy honours it. */
  chip: PlanChip;
  employees: { id: string; name: string }[];
}

export function PlanRegisterTable({ tree, level, viewer, query, projectId, chip, employees }: Props) {
  const router = useRouter();
  const [sort, setSort] = React.useState<SortKey>("plan");
  const [ticked, setTicked] = React.useState<Set<string>>(new Set());
  const [editing, setEditing] = React.useState<RegisterRow<PlanNode> | null>(null);
  /** One write at a time — the row controls stay shut through the refresh. */
  const [busy, setBusy] = React.useState(false);
  const [deleting, setDeleting] = React.useState<string[] | null>(null);

  const kind = LEVEL_KIND[level];
  const ancestorKinds = ANCESTOR_KINDS[level];
  const rollupKind = ROLLUP_KIND[level];
  const scheduled = hasSchedule(kind);
  const executable = isExecutable(kind);
  const offsets = React.useMemo(() => freezeOffsets(level), [level]);

  const rows = React.useMemo(() => {
    const scoped = projectId ? tree.filter((n) => n.id === projectId) : tree;
    let out = buildRegisterRows(scoped, level);
    if (query.trim()) out = out.filter((r) => registerRowMatches(r, query));
    // The register is already flat, so the chip needs no expansion trick —
    // just the same predicate the count above it uses.
    if (chip) out = out.filter((r) => matchesChip(r.node, chip));
    if (sort !== "plan") {
      const collate = (a: string, b: string) =>
        a.localeCompare(b, undefined, { sensitivity: "base" });
      out = [...out].sort((a, b) => {
        if (sort === "name") return collate(a.node.name, b.node.name);
        if (sort === "status") {
          return collate(effective(a.node), effective(b.node));
        }
        // Fullest first — a register sorted by completion is being read for
        // what is nearly done, not for what has not started.
        if (sort === "completion") {
          const af = a.node.kind === "project" ? projectFraction(a.node) : nodeFraction(a.node);
          const bf = b.node.kind === "project" ? projectFraction(b.node) : nodeFraction(b.node);
          return bf - af || collate(a.node.name, b.node.name);
        }
        if (sort === "rollup") {
          return b.rollup.fraction - a.rollup.fraction || collate(a.node.name, b.node.name);
        }
        // Undated rows last — they are the ones without a commitment yet.
        const at = a.node.targetDate ?? "";
        const bt = b.node.targetDate ?? "";
        if (at === "" && bt === "") return collate(a.node.name, b.node.name);
        if (at === "") return 1;
        if (bt === "") return -1;
        return at.localeCompare(bt);
      });
    }
    return out;
  }, [tree, level, query, projectId, sort, chip]);

  return (
    <div className="min-w-0">
      <PlanBulkBar
        count={ticked.size}
        employees={employees}
        // ONE row at a time, and the bar shuts the button unless exactly one
        // is ticked. Same rule as the hierarchy view — Edit must not mean two
        // different things depending on which view you ticked in.
        onEdit={() => {
          const only = ticked.size === 1 ? rows.find((r) => ticked.has(r.node.id)) : undefined;
          if (only) setEditing(only);
        }}
        onDuplicate={() => runBulk("Duplicated", (id) => duplicatePlanNode(id))}
        // The Owner column is the row's INITIATOR — see the hierarchy table's
        // column note; the two views name the same field the same way.
        onOwner={(employeeId) =>
          runOver("Owner set on", (ids) => bulkUpdatePlanNodes({ ids, initiatorId: employeeId }))
        }
        onStatus={(status) => runOver("Updated", (ids) => bulkSetPlanNodeStatus({ ids, status }))}
        onPriority={(priority) => runOver("Updated", (ids) => bulkUpdatePlanNodes({ ids, priority }))}
        // Reassign writes the DOER (`owner_id`), which carries the task's doer
        // with it — the same rule the edit dialog's Doer field follows.
        onReassign={(employeeId) =>
          runOver("Reassigned", (ids) => bulkUpdatePlanNodes({ ids, ownerId: employeeId }))
        }
        onInitiatorStatus={(status) =>
          runOver("Updated", (ids) => bulkSetPlanNodeStatus({ ids, status }))
        }
        // Permanent, and it takes the whole branch with it — worth one
        // deliberate, styled confirmation that can say exactly how much.
        onDelete={() => setDeleting([...ticked])}
        onClear={() => setTicked(new Set())}
        busy={busy}
      />

      <div
        className="rounded-xl overflow-auto"
        style={{
          // The same navy frame every table in the module carries.
          border: "2px solid var(--color-table-edge)",
          background: "var(--color-surface-card)",
          maxHeight: "calc(100vh - 320px)",
        }}
      >
        <table
          className="plan-table"
          style={{ borderCollapse: "separate", borderSpacing: 0, minWidth: "100%" }}
        >
          <thead className="sticky top-0 z-30">
            <tr>
              {/* The identity block is frozen to the left edge. A sticky cell is
                  positioned against the SCROLL BOX, not against the cell before
                  it, so every offset is a cumulative sum of fixed widths. */}
              <Th frozen left={offsets.tick} width={FREEZE_WIDTH.tick} header>
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={rows.length > 0 && ticked.size === rows.length}
                  ref={(el) => {
                    if (el) el.indeterminate = ticked.size > 0 && ticked.size < rows.length;
                  }}
                  onChange={() =>
                    setTicked(
                      ticked.size === rows.length
                        ? new Set()
                        : new Set(rows.map((r) => r.node.id)),
                    )
                  }
                />
              </Th>
              {ancestorKinds.map((k, i) => (
                <React.Fragment key={k}>
                  <Th frozen={offsets.ancestors[i]!.frozen} left={offsets.ancestors[i]!.ref} width={FREEZE_WIDTH.ref} header>
                    {KIND_LABEL[k]} No
                  </Th>
                  <Th frozen={offsets.ancestors[i]!.frozen} left={offsets.ancestors[i]!.name} width={FREEZE_WIDTH.name} header>
                    {KIND_LABEL[k]} Name
                  </Th>
                </React.Fragment>
              ))}
              <Th frozen={offsets.ownFrozen} left={offsets.ownRef} width={FREEZE_WIDTH.ref} header>
                {KIND_LABEL[kind]} No
              </Th>
              <Th
                frozen={offsets.ownFrozen}
                left={offsets.ownName}
                width={FREEZE_WIDTH.ownName}
                header
              >
                <button
                  type="button"
                  onClick={() => setSort(sort === "name" ? "plan" : "name")}
                  className="inline-flex items-center gap-1"
                >
                  {KIND_LABEL[kind]} Name
                  <ArrowUpDown size={9} strokeWidth={2.6} style={{ opacity: 0.5 }} />
                </button>
              </Th>

              <Th width={280} header>{KIND_LABEL[kind]} Description</Th>
              {/* Two columns, not one. The single Status column rendered the
                  ruling OVER the report, so an initiator's verdict made the
                  doer's own status unreadable — see `PlanStatusCell`. */}
              <Th width={168} header>Doer Status</Th>
              <Th width={168} header>Initiator Status</Th>
              {/* Start / End / Duration on scheduled levels only — otherwise
                  three columns of dashes across the width of the screen. */}
              {scheduled && (
                <>
                  <Th width={130} header>Start Date</Th>
                  <Th width={130} header>End Date</Th>
                  <Th width={90} header>Duration</Th>
                </>
              )}
              <Th width={170} header>
                {executable ? (
                  "WMS Task"
                ) : (
                  <SortBtn
                    active={sort === "completion"}
                    onClick={() => setSort(sort === "completion" ? "plan" : "completion")}
                  >
                    {KIND_LABEL[kind]} Completion
                  </SortBtn>
                )}
              </Th>
              <Th width={230} header>
                <SortBtn
                  active={sort === "rollup"}
                  onClick={() => setSort(sort === "rollup" ? "plan" : "rollup")}
                >
                  {rollupKind ? `${KIND_LABEL_PLURAL[rollupKind]} Completion` : "Completion"}
                </SortBtn>
              </Th>
              <Th width={90} header>Attachments</Th>
              <Th width={80} header>Links</Th>
              <Th width={240} header>Initiator Notes</Th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={40}
                  className="px-4 py-10 text-center text-[14px]"
                  style={{ color: "var(--color-ink-subtle)" }}
                >
                  {query
                    ? "Nothing here matches."
                    : `No ${KIND_LABEL[kind].toLowerCase()}s yet.`}
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <Row
                key={r.node.id}
                row={r}
                level={level}
                viewer={viewer}
                offsets={offsets}
                ticked={ticked.has(r.node.id)}
                onTick={() =>
                  setTicked((prev) => {
                    const next = new Set(prev);
                    if (next.has(r.node.id)) next.delete(r.node.id);
                    else next.add(r.node.id);
                    return next;
                  })
                }
                onRefresh={() => router.refresh()}
              />
            ))}
          </tbody>
        </table>
      </div>

      {deleting && (
        <PlanDeleteDialog
          ids={deleting}
          name={
            deleting.length === 1
              ? rows.find((r) => r.node.id === deleting[0])?.node.name
              : undefined
          }
          pending={busy}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const ids = deleting;
            setDeleting(null);
            void runBulk("Deleted", (id) => deletePlanNode(id), ids);
          }}
        />
      )}

      {editing && (
        <PlanEditDialog
          node={editing.node}
          refLabel={editing.ownRef}
          employees={employees}
          onClose={() => setEditing(null)}
          onDone={() => {
            setEditing(null);
            setTicked(new Set());
          }}
        />
      )}
    </div>
  );

  /**
   * ONE server call carrying every ticked id — for the bar's menus, which
   * write the same value to all of them. `runBulk` below is the other shape:
   * an action that only takes one id, looped.
   */
  function runOver(
    verb: string,
    fn: (
      ids: string[],
    ) => Promise<
      { ok: true; updated?: number; skipped?: number; firstError?: string } | { ok: false; error: string }
    >,
  ) {
    if (busy || ticked.size === 0) return;
    setBusy(true);
    const ids = [...ticked];
    void (async () => {
      try {
        const res = await fn(ids);
        if (!res.ok) {
          toast.error(res.error);
          return;
        }
        const updated = res.updated ?? ids.length;
        const skipped = res.skipped ?? 0;
        if (updated === 0) {
          toast.error(
            res.firstError ?? "Nothing changed — you may not have standing on these rows.",
          );
          return;
        }
        toast.success(
          skipped > 0
            ? `${verb} ${updated} ${updated === 1 ? "row" : "rows"} — ${skipped} skipped (no standing, or nothing to change).`
            : `${verb} ${updated} ${updated === 1 ? "row" : "rows"}.`,
        );
      } finally {
        setTicked(new Set());
        router.refresh();
        setBusy(false);
      }
    })();
  }

  /** Run one action over every ticked row, then clear and refresh once. */
  async function runBulk(
    verb: string,
    run: (id: string) => Promise<{ ok: boolean; error?: string }>,
    over?: string[],
  ) {
    if (busy) return;
    setBusy(true);
    const ids = over ?? [...ticked];
    let done = 0;
    try {
      for (const id of ids) {
        const res = await run(id);
        if (res.ok) done++;
        else toast.error(res.error ?? "That didn't work.");
      }
      if (done > 0) {
        toast.success(`${verb} ${done} ${done === 1 ? "row" : "rows"}.`);
      }
    } finally {
      setTicked(new Set());
      router.refresh();
      setBusy(false);
    }
  }
}

function Row({
  row,
  level,
  viewer,
  offsets,
  ticked,
  onTick,
  onRefresh,
}: {
  row: RegisterRow<PlanNode>;
  level: RegisterLevel;
  viewer: PlanViewer;
  offsets: ReturnType<typeof freezeOffsets>;
  ticked: boolean;
  onTick: () => void;
  onRefresh: () => void;
}) {
  const n = row.node;
  const kind = LEVEL_KIND[level];
  const rollupKind = CHILD_KIND[kind];
  const scheduled = hasSchedule(kind);
  const executable = isExecutable(kind);
  const days = durationDays(n.startsAt, n.endsAt);

  const actor = actorForRow(viewer, {
    ownerId: n.ownerId,
    ancestorOwnerIds: [],
    doerId: n.task?.doerId ?? null,
  });

  return (
    <tr data-selected={ticked || undefined}>
      <Td frozen left={offsets.tick} width={FREEZE_WIDTH.tick}>
        <input type="checkbox" checked={ticked} onChange={onTick} aria-label={`Select ${n.name}`} />
      </Td>
      {row.ancestors.map((a, i) => (
        <React.Fragment key={a.id}>
          <Td frozen={offsets.ancestors[i]!.frozen} left={offsets.ancestors[i]!.ref} width={FREEZE_WIDTH.ref}>
            <PlanRef>{a.ref}</PlanRef>
          </Td>
          <Td frozen={offsets.ancestors[i]!.frozen} left={offsets.ancestors[i]!.name} width={FREEZE_WIDTH.name}>
            <span
              className="block truncate"
              style={{ ...levelStyleProps(a.kind), color: "var(--color-ink-strong)" }}
              title={a.name}
            >
              {a.name}
            </span>
          </Td>
        </React.Fragment>
      ))}
      <Td frozen={offsets.ownFrozen} left={offsets.ownRef} width={FREEZE_WIDTH.ref}>
        <PlanRef title={row.fullRef}>{row.ownRef}</PlanRef>
      </Td>
      <Td
        frozen={offsets.ownFrozen}
        left={offsets.ownName}
        width={FREEZE_WIDTH.ownName}
       
      >
        <span
          className="block truncate"
          style={{ ...levelStyleProps(kind), color: "var(--color-ink-strong)" }}
          title={`${row.fullRef} · ${n.name}`}
        >
          {n.name}
        </span>
      </Td>

      <Td><Muted>{n.description ?? "—"}</Muted></Td>
      <Td>
        <PlanStatusCell
          nodeId={n.id}
          kind={kind}
          flow="doer"
          status={executable ? (n.task?.status ?? null) : n.status}
          approvalStatus={n.approvalStatus}
          actor={actor}
          expectedUpdatedAt={n.task?.updatedAt}
          onDone={onRefresh}
          compact
        />
      </Td>
      <Td>
        <PlanStatusCell
          nodeId={n.id}
          kind={kind}
          flow="initiator"
          status={executable ? (n.task?.status ?? null) : n.status}
          approvalStatus={n.approvalStatus}
          actor={actor}
          expectedUpdatedAt={n.task?.updatedAt}
          onDone={onRefresh}
          compact
        />
      </Td>
      {scheduled && (
        <>
          <Td><Muted mono>{formatPlanDate(n.startsAt) || "—"}</Muted></Td>
          <Td><Muted mono>{formatPlanDate(n.endsAt) || "—"}</Muted></Td>
          <Td><Muted mono>{days == null ? "—" : `${days}d`}</Muted></Td>
        </>
      )}
      <Td>
        {executable ? (
          // No Client / Subject / Doer / Due / Age columns here: a plan row is
          // mostly not scheduled yet, so that block read as six columns of
          // dashes. The record is one click away, in the same drawer, with all
          // six fields and more.
          n.task ? (
            <Link
              href={`/tasks/${n.task.id}` as Route}
              className="inline-flex items-center gap-1 text-[12.5px] hover:underline"
              style={{ color: PLAN_RED }}
            >
              {n.task.taskNo ? `#${n.task.taskNo}` : "Open"}
              <ExternalLink size={10} strokeWidth={2.6} />
            </Link>
          ) : (
            <span className="text-[12px]" style={{ color: "var(--color-ink-strong)" }}>
              Not scheduled
            </span>
          )
        ) : (
          <CompletionBar
            percent={toPercent(
              kind === "project" ? projectFraction(n) : nodeFraction(n),
            )}
          />
        )}
      </Td>
      <Td>
        {/* The count leads, the sentence explains it. "No milestones yet" is
            not the same statement as "0 of 0" — one says the level below is
            empty, the other implies it exists and is untouched. */}
        {row.rollup.total === 0 ? (
          <Muted>
            No {rollupKind ? KIND_LABEL_PLURAL[rollupKind].toLowerCase() : "children"} yet
          </Muted>
        ) : (
          <span className="flex items-baseline gap-1.5 min-w-0">
            <span
              className="shrink-0 font-bold"
              style={{ ...TABULAR, fontSize: 13, color: "var(--color-ink-strong)" }}
            >
              {formatCompleted(row.rollup.completed)}/{row.rollup.total}
            </span>
            <span
              className="truncate"
              style={{ fontSize: 12, color: "var(--color-ink-strong)" }}
            >
              {formatCompleted(row.rollup.completed)} of {row.rollup.total}{" "}
              {(row.rollup.total === 1 && rollupKind
                ? KIND_LABEL[rollupKind]
                : rollupKind
                  ? KIND_LABEL_PLURAL[rollupKind]
                  : "children"
              ).toLowerCase()}{" "}
              done
            </span>
          </span>
        )}
      </Td>
      <Td>
        <PlanPanelCell nodeId={n.id} mode="attachments" count={n.attachmentCount} onDone={onRefresh} />
      </Td>
      <Td>
        <PlanPanelCell nodeId={n.id} mode="links" links={n.links} onDone={onRefresh} />
      </Td>
      <Td><Muted>{n.notes ?? "—"}</Muted></Td>
    </tr>
  );
}

function effective(n: PlanNode): string {
  return n.approvalStatus ?? (isExecutable(n.kind) ? (n.task?.status ?? "") : (n.status ?? ""));
}

function Th({
  children,
  width,
  frozen,
  left,
}: {
  children?: React.ReactNode;
  width: number;
  frozen?: boolean;
  left?: number;
  header?: boolean;
}) {
  return (
    <th
      className="px-2 py-2 text-left text-[11px] font-bold uppercase tracking-wide whitespace-nowrap"
      style={{
        width,
        minWidth: width,
        color: "var(--color-ink-soft)",
        borderBottom: PLAN_ROW_LINE,
        ...(frozen
          ? {
              position: "sticky",
              left,
              zIndex: 2,
            }
          : {}),
      }}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  width,
  frozen,
  left,
}: {
  children?: React.ReactNode;
  width?: number;
  frozen?: boolean;
  left?: number;
}) {
  return (
    <td
      // The separator sits on the CELL, not the row: a sticky cell paints over
      // a border set on the <tr>, which leaves the frozen block as the one
      // stripe with no line under it. The background is a class for the same
      // reason — an inline one would beat the hover tint.
      className="px-2 py-2 align-middle"
      style={{
        width,
        minWidth: width,
        borderBottom: PLAN_ROW_LINE,
        ...(frozen
          ? {
              position: "sticky",
              left,
              zIndex: 1,
            }
          : {}),
      }}
    >
      {children}
    </td>
  );
}

/** A percent and a bar — the same reading the plan uses everywhere else. */
function CompletionBar({ percent }: { percent: number }) {
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      <span
        className="shrink-0 font-bold"
        style={{ ...TABULAR, fontSize: 13.5, color: "var(--color-ink-strong)" }}
      >
        {percent}
      </span>
      <span className="shrink-0" style={{ fontSize: 11.5, color: "var(--color-ink-strong)" }}>
        %
      </span>
      <span
        aria-hidden
        className="flex-1 min-w-0 rounded-full overflow-hidden"
        style={{ height: 4, background: "var(--color-hairline)" }}
      >
        <span
          className="block h-full rounded-full"
          style={{ width: `${percent}%`, background: PLAN_RED }}
        />
      </span>
    </span>
  );
}

/** A header that sorts. Clicking the active one returns to plan order. */
function SortBtn({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1 text-left"
      style={{ color: active ? PLAN_RED : undefined }}
    >
      {children}
      <ArrowUpDown size={9} strokeWidth={2.6} style={{ opacity: active ? 1 : 0.5 }} />
    </button>
  );
}

function Muted({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <span
      className="block truncate text-[12.5px]"
      style={{ ...(mono ? TABULAR : {}), color: "var(--color-ink-strong)" }}
    >
      {children}
    </span>
  );
}
