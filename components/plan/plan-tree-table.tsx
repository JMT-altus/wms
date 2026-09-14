"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import {
  ChevronDown,
  ChevronRight,
  Columns3,
  Copy,
  Download,
  ExternalLink,
  GripVertical,
  Maximize2,
  MoveDown,
  MoveUp,
  Pencil,
  PenLine,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  CHILD_KIND,
  KIND_LABEL,
  durationDays,
  formatPlanDate,
  hasSchedule,
  hasTask,
  isExecutable,
  levelStyleProps,
  type PlanKind,
  isValidChild,
} from "@/lib/plan/levels";
import {
  countPlan,
  flattenTable,
  matchesChip,
  initialExpanded,
  planCsv,
  planCsvName,
  type PlanSort,
  type TableRow,
} from "@/lib/plan/table";
import { actorForRow, type PlanViewer } from "@/lib/plan/viewer";
import type { PlanNode } from "@/lib/queries/plan";
import {
  bulkSetPlanNodeStatus,
  bulkUpdatePlanNodes,
  createPlanNode,
  deletePlanNode,
  updatePlanNode,
  duplicatePlanNode,
  getPlanDeleteImpact,
  movePlanNode,
  reparentPlanNode,
} from "@/app/(project)/project-plan/actions";
// Reassigning is the tasks module's own action — see `InlineDoer`.
import { reassignDoer } from "@/app/(app)/tasks/actions";
import { PlanStatusCell } from "./plan-status-cell";
import { PlanProgressCell } from "./plan-progress-cell";
import { PlanRef } from "./plan-ref";
import { PlanControls, type PlanView } from "./plan-controls";
import type { PlanChip } from "./plan-toolbar";
import { PlanRowDialogs, type PlanDialog } from "./plan-row-dialogs";
import { PlanBulkBar } from "./plan-bulk-bar";
import { PlanDeleteDialog } from "./plan-delete-dialog";
import {
  getColumnPrefs,
  getColumnPrefsServer,
  saveColumnPrefs,
  subscribeToColumnPrefs,
} from "./plan-columns-store";
import { PLAN_RED, PLAN_ROW_LINE, TABULAR } from "./theme";

/**
 * The hierarchy table — all six levels in one compact enterprise table.
 *
 * The row indent and the expand caret travel WITH the Ref column, so dragging
 * it moves the hierarchy's visual spine rather than stranding the indent.
 */

/** Every column, in default order. The three `fixed` ones cannot be hidden —
 *  a table with no name, no controls and no reference is a dead end. */
interface ColumnDef {
  key: string;
  header: string;
  width: number | "flex";
  fixed?: boolean;
  defaultHidden?: boolean;
  align?: "left" | "right" | "center";
  /**
   * Whose column this is — the DOER's side of the row or the INITIATOR's.
   *
   * Purely presentational: the header draws a tinted rule over each run of
   * columns that share a group, so "who is doing it and what do they say" and
   * "who raised it and how did they rule" read as two things rather than five
   * columns in a row. Columns with no group (Progress, Priority, the dates)
   * belong to neither and are left plain.
   */
  group?: "doer" | "initiator";
}

const COLUMNS: ColumnDef[] = [
  { key: "ref", header: "Ref", width: 124, fixed: true },
  { key: "controls", header: "", width: 156, fixed: true },
  { key: "name", header: "Result / Action", width: "flex", fixed: true },
  // OWNER IS THE INITIATOR — the person the create and edit dialogs ask for
  // under "Initiator", `project_nodes.initiator_id`. Whoever raised the row
  // owns it in the only sense this table reports, and a column that showed a
  // different field from the one the dialog collects is a column nobody can
  // reconcile with what they just typed.
  //
  // `doer` below is the other half of that pair: the dialog's "Doer", which
  // is `project_nodes.owner_id` and which seeds `tasks.doer_id` the moment the
  // row schedules itself. (`owner_id` keeps its name in the schema and still
  // decides standing in `actorForRow` — renaming a column used across the
  // module is a separate change from what this table SHOWS.)
  // ── The INITIATOR's side ────────────────────────────────────────────────
  // Who raised the row, and their ruling on it. `group` draws the rule that
  // separates the two sides in the header — see `GROUP_EDGE` below.
  { key: "owner", header: "Owner", width: 176, group: "initiator" },
  { key: "initiatorStatus", header: "Initiator Status", width: 178, group: "initiator" },
  // ── The DOER's side ─────────────────────────────────────────────────────
  // Who is doing the work, and their own report on it. Two columns where
  // there used to be one: the single Status column rendered the verdict OVER
  // the report, so an initiator's ruling made the doer's own status
  // unreadable and their next report landed invisibly underneath it.
  { key: "doerStatus", header: "Doer Status", width: 178, group: "doer" },
  { key: "doer", header: "Doer", width: 180, group: "doer" },
  { key: "progress", header: "Progress", width: 136 },
  { key: "priority", header: "Priority", width: 148 },
  { key: "target", header: "Target date", width: 156 },
  { key: "start", header: "Start date", width: 150 },
  { key: "end", header: "End date", width: 150 },
  { key: "due", header: "Due date", width: 150 },
  { key: "days", header: "Days", width: 84, align: "right" },
  { key: "from", header: "From", width: 144, defaultHidden: true },
  { key: "to", header: "To", width: 144, defaultHidden: true },
  { key: "wms", header: "WMS", width: 148, defaultHidden: true },
  { key: "description", header: "Description", width: 280, defaultHidden: true },
];

/**
 * The two sides of a row, and the colour each is marked in.
 *
 * The table asks two different questions across five adjacent columns — "who
 * raised this and how did they rule on it" and "who is doing it and what do
 * they say" — and until these were marked they read as one undifferentiated
 * run, which is how the Doer's status and the Initiator's got confused for
 * each other in the first place.
 *
 * Marked with a RULE down each side of the run and nothing else — no tint, no
 * coloured header text. The columns have to read as part of the same table as
 * every other column; a violet header and a cyan one next to five plain ones
 * made the grouping shout louder than the column names it was labelling.
 *
 * The board is the surface with room to be colourful about this: it splits
 * into two banner-headed halves under `PLAN_SIDE` in `theme.ts`. A table this
 * dense is not.
 */
const GROUP_EDGE = "1px solid var(--color-hairline-strong)";


/**
 * Where a run of same-group columns starts and ends, AT RENDER TIME.
 *
 * Computed from the visible list rather than declared on the column, because
 * the Columns menu reorders and hides them by drag — a "first of its group"
 * flag baked into COLUMNS would be wrong the moment anyone moved one.
 */
function groupEdges(
  columns: ColumnDef[],
  i: number,
): { group: "doer" | "initiator" | null; starts: boolean; ends: boolean } {
  const group = columns[i]?.group ?? null;
  if (!group) return { group: null, starts: false, ends: false };
  return {
    group,
    starts: columns[i - 1]?.group !== group,
    ends: columns[i + 1]?.group !== group,
  };
}

// Deliberately absent, and why:
//   Timer        an executable row is a task — its timer is one click away in
//                the drawer and on the task list, both driving the same session
//                ledger. A plan is read far more often than a stopwatch is pressed.
//   Duration     `Days` already answers "how long does this run" from the two
//                dates beside it. The estimate stays on the row and in the edit
//                dialog: this drops a column, not a field.

interface Props {
  tree: PlanNode[];
  viewer: PlanViewer;
  employees: { id: string; name: string }[];
  query: string;
  projectId: string | null;
  onProjectChange: (id: string | null) => void;
  projects: { id: string; name: string; ref: string }[];
  sort: PlanSort;
  onSortChange: (s: PlanSort) => void;
  /** The header chip currently filtering the rows, if any. */
  chip: PlanChip;
  maxDepth: number | null;
  onMaxDepthChange: (d: number | null) => void;
  fullScreen: boolean;
  onFullScreenChange: (v: boolean) => void;
  onView: (v: PlanView) => void;
}

export function PlanTreeTable({
  tree,
  viewer,
  employees,
  query,
  projectId,
  onProjectChange,
  projects,
  sort,
  onSortChange,
  chip,
  maxDepth,
  onMaxDepthChange,
  fullScreen,
  onFullScreenChange,
  onView,
}: Props) {
  const router = useRouter();

  /**
   * Computed ONCE, in a state initialiser. After this the set is the user's, so
   * a refresh from an edit can never re-close what they opened, and a newly
   * added row (absent from the set) is visible immediately.
   */
  const [expanded, setExpanded] = React.useState<Set<string>>(() =>
    initialExpanded(tree),
  );
  // Read through an external store, so the stored preference arrives without a
  // setState-in-effect and without a hydration mismatch.
  const prefs = React.useSyncExternalStore(
    subscribeToColumnPrefs,
    getColumnPrefs,
    getColumnPrefsServer,
  );
  const order = React.useMemo(() => {
    const known = new Set(COLUMNS.map((c) => c.key));
    const kept = (prefs.order ?? []).filter((k) => known.has(k));
    // Append any column added since the preference was saved, so a new column
    // never silently disappears.
    const missing = COLUMNS.map((c) => c.key).filter((k) => !kept.includes(k));
    return [...kept, ...missing];
  }, [prefs.order]);
  const hidden = React.useMemo(() => {
    if (!prefs.hidden) {
      return new Set(COLUMNS.filter((c) => c.defaultHidden).map((c) => c.key));
    }
    const known = new Set(COLUMNS.map((c) => c.key));
    // A fixed column can never be hidden, whatever storage claims.
    return new Set(prefs.hidden.filter((k) => known.has(k) && !isFixed(k)));
  }, [prefs.hidden]);
  const [columnsOpen, setColumnsOpen] = React.useState(false);
  const [rowLimit, setRowLimit] = React.useState<number | null>(null);
  const [ticked, setTicked] = React.useState<Set<string>>(new Set());
  const [dialog, setDialog] = React.useState<PlanDialog | null>(null);
  const [deleting, setDeleting] = React.useState<string[] | null>(null);
  /** The row being dragged, and the row it is currently hovering over. */
  const [dragRow, setDragRow] = React.useState<string | null>(null);
  const [dropRow, setDropRow] = React.useState<string | null>(null);
  /** The row the last "+" just made — held only long enough to point at it. */
  const [freshId, setFreshId] = React.useState<string | null>(null);
  const freshRef = React.useRef<HTMLTableRowElement | null>(null);

  /**
   * ONE TREE WRITE AT A TIME. `pending` stays true through the
   * `router.refresh()` at the end of every write, because that is the window
   * the row controls have to stay shut for.
   */
  const [pending, setPending] = React.useState(false);

  // Counted over the WHOLE TREE, never the rendered rows: results start
  // collapsed, so counting what is on screen reports "0 Actions".
  const counts = React.useMemo(() => countPlan(tree), [tree]);

  /**
   * Every id in the tree — what a chip expands to.
   *
   * A CHIP FILTERS THE WHOLE PLAN, and `flattenTable` stops at collapsed
   * branches: Results start closed, so filtering the rendered rows asked
   * "which of the rows already on screen are in the WMS?" while the number on
   * the chip answered "how many are there?". Click "8 In WMS" on a freshly
   * loaded plan and it hid almost everything, because the eight were nested
   * inside branches nobody had opened.
   *
   * Same move the search already makes — a query force-opens the branches it
   * kept — so a chip does too, and the row it promised is actually reachable.
   */
  const allIds = React.useMemo(() => {
    const ids = new Set<string>();
    const stack: PlanNode[] = [...tree];
    while (stack.length > 0) {
      const node = stack.pop()!;
      ids.add(node.id);
      stack.push(...node.children);
    }
    return ids;
  }, [tree]);

  const rows = React.useMemo(
    () =>
      flattenTable(tree, {
        expanded: chip ? allIds : expanded,
        query,
        projectId,
        sort,
        maxDepth,
      }),
    [tree, expanded, allIds, chip, query, projectId, sort, maxDepth],
  );

  // One shared predicate with the chip's own count — see `matchesChip`.
  const filtered = React.useMemo(
    () => (chip ? rows.filter((r) => matchesChip(r.node, chip)) : rows),
    [rows, chip],
  );

  // "Rows" caps what is rendered, not what is counted — the chips above and
  // the "showing N of M" line below both speak about the whole plan.
  const shown = React.useMemo(
    () => (rowLimit == null ? filtered : filtered.slice(0, rowLimit)),
    [filtered, rowLimit],
  );

  const visibleColumns = React.useMemo(
    () =>
      order
        .map((k) => COLUMNS.find((c) => c.key === k)!)
        .filter((c) => c && !hidden.has(c.key)),
    [order, hidden],
  );

  // The row is marked when the server answers, but it is not RENDERED until
  // the refresh lands — so this waits on `shown` too, and then lets the mark
  // expire rather than leaving a row washed for the rest of the session.
  React.useEffect(() => {
    if (!freshId) return;
    freshRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
    const t = setTimeout(() => setFreshId(null), 2600);
    return () => clearTimeout(t);
  }, [freshId, shown]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Every write goes through here so exactly one runs at a time. */
  function run(fn: () => Promise<{ ok: boolean; error?: string }>) {
    if (pending) return;
    setPending(true);
    void (async () => {
      try {
        const res = await fn();
        if (!res.ok) toast.error(res.error ?? "That didn't work.");
      } finally {
        router.refresh();
        setPending(false);
      }
    })();
  }

  /**
   * Add a child row and SHOW IT.
   *
   * The "+" used to create the row and stop there. If the parent happened to
   * be collapsed — which it is for anything you have not opened yet — the new
   * Milestone / Result / Action landed behind a caret that only appeared at
   * that moment, so the button read as doing nothing. The parent is opened
   * before the write goes out, and the row it creates is marked fresh: it
   * scrolls into view and carries a brief wash, so you can see what you made
   * and rename it without hunting for it.
   */
  function addChild(parentId: string, kind: PlanKind) {
    if (pending) return;
    setExpanded((prev) => new Set(prev).add(parentId));
    setPending(true);
    void (async () => {
      try {
        const res = await createPlanNode({ kind, parentId });
        if (!res.ok) {
          toast.error(res.error ?? "That didn't work.");
          return;
        }
        setFreshId(res.id);
        toast.success(`${KIND_LABEL[kind]} added.`);
      } finally {
        router.refresh();
        setPending(false);
      }
    })();
  }

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
    if (pending || ticked.size === 0) return;
    setPending(true);
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
          // Every row refused — say WHY, in the server's own words, rather
          // than reporting a cheerful "0 rows".
          toast.error(res.firstError ?? "Nothing changed — you may not have standing on these rows.");
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
        setPending(false);
      }
    })();
  }

  /** Run one action over every ticked row, then clear and refresh once. */
  async function runBulk(
    verb: string,
    fn: (id: string) => Promise<{ ok: boolean; error?: string }>,
    over?: string[],
  ) {
    if (pending) return;
    setPending(true);
    const ids = over ?? [...ticked];
    let done = 0;
    try {
      for (const id of ids) {
        const res = await fn(id);
        if (res.ok) done++;
        else toast.error(res.error ?? "That didn't work.");
      }
      if (done > 0) toast.success(`${verb} ${done} ${done === 1 ? "row" : "rows"}.`);
    } finally {
      setTicked(new Set());
      router.refresh();
      setPending(false);
    }
  }

  function exportCsv() {
    const csv = planCsv(
      shown,
      visibleColumns
        // The controls column is buttons; there is nothing to export from it.
        .filter((c) => c.key !== "controls")
        .map((c) => ({
          header: c.header || KIND_LABEL.action,
          value: (row: TableRow<PlanNode>) => cellText(c.key, row),
        })),
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = planCsvName();
    a.click();
    URL.revokeObjectURL(url);
  }

  const body = (
    <div className="min-w-0">
      <PlanControls
        view="list"
        onView={onView}
        projectId={projectId}
        onProject={onProjectChange}
        projects={projects}
        maxDepth={maxDepth}
        onMaxDepth={onMaxDepthChange}
        sort={sort}
        onSort={onSortChange}
        rows={rowLimit}
        onRows={setRowLimit}
        visibleColumns={visibleColumns.length}
        totalColumns={COLUMNS.length}
        onColumns={() => setColumnsOpen((v) => !v)}
        columnsOpen={
          columnsOpen ? (
            <ColumnMenu
              order={order}
              hidden={hidden}
              onClose={() => setColumnsOpen(false)}
              onChange={(nextOrder, nextHidden) =>
                saveColumnPrefs({ order: nextOrder, hidden: [...nextHidden] })
              }
            />
          ) : null
        }
        onExport={exportCsv}
        onNew={() => run(() => createPlanNode({ kind: "project", parentId: null }))}
        newLabel="New project"
      />

      <PlanBulkBar
        count={ticked.size}
        employees={employees}
        // Opening a row's detail needs one row; the others read the whole tick.
        onDetail={() => {
          const only = ticked.size === 1 ? shown.find((r) => ticked.has(r.node.id)) : undefined;
          if (only) setDialog({ mode: "detail", row: only });
        }}
        // ONE row at a time, and the bar shuts the button unless exactly one
        // is ticked. Same answer in the register — Edit must not mean two
        // different things depending on which view you ticked in.
        onEdit={() => {
          const only = ticked.size === 1 ? shown.find((r) => ticked.has(r.node.id)) : undefined;
          if (only) setDialog({ mode: "edit", row: only });
        }}
        onDuplicate={() => runBulk("Duplicated", (id) => duplicatePlanNode(id))}
        // The Owner column is the row's INITIATOR — see the column note.
        onOwner={(employeeId) =>
          runOver("Owner set on", (ids) => bulkUpdatePlanNodes({ ids, initiatorId: employeeId }))
        }
        onStatus={(status) =>
          runOver("Updated", (ids) => bulkSetPlanNodeStatus({ ids, status }))
        }
        onPriority={(priority) =>
          runOver("Updated", (ids) => bulkUpdatePlanNodes({ ids, priority }))
        }
        // Reassign writes the DOER (`owner_id`), which carries the task's doer
        // with it — the same rule the edit dialog's Doer field follows.
        onReassign={(employeeId) =>
          runOver("Reassigned", (ids) => bulkUpdatePlanNodes({ ids, ownerId: employeeId }))
        }
        onInitiatorStatus={(status) =>
          runOver("Updated", (ids) => bulkSetPlanNodeStatus({ ids, status }))
        }
        // Permanent, and it takes the whole branch with it — the same styled
        // confirmation the register's Delete raises, counting the blast radius.
        onDelete={() => setDeleting([...ticked])}
        onClear={() => setTicked(new Set())}
        busy={pending}
      />

      {/* ── The table ─────────────────────────────────────────────────── */}
      <div
        className="rounded-xl overflow-auto"
        style={{
          // The module's tables all wear the same navy edge — see
          // `--color-table-edge` in globals.css. Only the frame: the rules
          // inside each table stay whatever that table needs.
          border: "2px solid var(--color-table-edge)",
          background: "var(--color-surface-card)",
          maxHeight: fullScreen ? "calc(100vh - 190px)" : "calc(100vh - 420px)",
        }}
      >
        <table className="plan-table w-full" style={{ borderCollapse: "separate", borderSpacing: 0 }}>
          <thead className="sticky top-0 z-20">
            <tr>
              <th
                className="px-2 py-2"
                style={{
                  width: 34,
                  borderBottom: PLAN_ROW_LINE,
                }}
              >
                <input
                  type="checkbox"
                  aria-label="Select all rows"
                  checked={shown.length > 0 && ticked.size === shown.length}
                  onChange={() =>
                    setTicked(
                      ticked.size === shown.length
                        ? new Set()
                        : new Set(shown.map((r) => r.node.id)),
                    )
                  }
                />
              </th>
              {visibleColumns.map((c, i) => {
                const { group, starts, ends } = groupEdges(visibleColumns, i);
                return (
                  <th
                    key={c.key}
                    className="px-2 py-2.5 text-left text-[11.5px] font-bold uppercase tracking-wide whitespace-nowrap"
                    style={{
                      width: c.width === "flex" ? undefined : c.width,
                      minWidth: c.width === "flex" ? 260 : c.width,
                      textAlign: c.align ?? "left",
                      color: "var(--color-ink-soft)",
                      borderBottom: PLAN_ROW_LINE,
                      // The bracket only — NO tint and NO coloured text. Every
                      // header in this table reads the same weight and the
                      // same ink; two of them in violet and cyan made the
                      // grouping louder than the column names, which is the
                      // opposite of what a header is for. The rule alone says
                      // where one side ends and the other begins.
                      ...(group && starts
                        ? { borderLeft: GROUP_EDGE }
                        : {}),
                      ...(group && ends ? { borderRight: GROUP_EDGE } : {}),
                    }}
                  >
                    <span className="inline-flex items-center gap-1.5">
                      {/* The columns reorder by drag in the Columns menu; the
                          handle here says so without a tooltip nobody opens. */}
                      <GripVertical
                        size={11}
                        strokeWidth={2.2}
                        aria-hidden
                        style={{ color: "var(--color-ink-subtle)", opacity: 0.5 }}
                      />
                      {c.header}
                    </span>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr>
                <td
                  colSpan={visibleColumns.length + 1}
                  className="px-4 py-10 text-center text-[14px]"
                  style={{ color: "var(--color-ink-subtle)" }}
                >
                  {query || chip
                    ? "Nothing here matches."
                    : "No plan rows yet — start with a Project."}
                </td>
              </tr>
            )}
            {shown.map((row) => {
              const fresh = row.node.id === freshId;
              const actor = actorForRow(viewer, {
                ownerId: row.node.ownerId,
                ancestorOwnerIds: row.ancestorOwnerIds,
                doerId: row.node.task?.doerId ?? null,
              });
              /**
               * Can the row currently being dragged land ON this one?
               *
               * The SAME predicate the server re-checks (`isValidChild`), plus
               * the cycle guard: a branch cannot be dropped inside itself. The
               * highlight is a courtesy — `reparentPlanNode` refuses either
               * way — but a drop target that lights up and then errors is a
               * worse answer than one that never lit up.
               */
              const dragged = dragRow
                ? shown.find((r) => r.node.id === dragRow)
                : undefined;
              const isDropTarget =
                dragged !== undefined &&
                dragged.node.id !== row.node.id &&
                isValidChild(row.node.kind, dragged.node.kind) &&
                !isInBranch(shown, dragged.node.id, row.node.id);

              return (
                <tr
                  key={row.node.id}
                  // Named group: the rename pencil in the name cell reveals on
                  // ROW hover, and an unnamed `group` would also be claimed by
                  // any nested hover group a cell brings with it.
                  className="group/row"
                  ref={fresh ? freshRef : undefined}
                  data-fresh={fresh || undefined}
                  data-selected={ticked.has(row.node.id) || undefined}
                  // A project row carries a faint wash so the eye finds the
                  // top of each branch without counting indents.
                  data-root={row.node.kind === "project" || undefined}
                  // ── Drag a row onto another to RE-PARENT it ──────────────
                  // Dragging a Result from Milestone 1 to Milestone 2 had no
                  // answer at all before this: the arrows only ever reorder a
                  // row among its own siblings, so moving a branch meant
                  // deleting it and typing it again.
                  draggable={!pending}
                  onDragStart={(e) => {
                    setDragRow(row.node.id);
                    e.dataTransfer.effectAllowed = "move";
                  }}
                  onDragEnd={() => {
                    setDragRow(null);
                    setDropRow(null);
                  }}
                  onDragOver={(e) => {
                    if (!isDropTarget) return;
                    // Only a preventDefault here makes this a drop target at
                    // all — without it the browser refuses the drop silently.
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    setDropRow(row.node.id);
                  }}
                  onDragLeave={() =>
                    setDropRow((d) => (d === row.node.id ? null : d))
                  }
                  onDrop={(e) => {
                    e.preventDefault();
                    const moving = dragRow;
                    setDragRow(null);
                    setDropRow(null);
                    if (!moving || !isDropTarget) return;
                    run(() =>
                      reparentPlanNode({ id: moving, parentId: row.node.id }),
                    );
                  }}
                  data-drop-target={dropRow === row.node.id || undefined}
                  data-dragging={dragRow === row.node.id || undefined}
                  style={{
                    ...(dropRow === row.node.id
                      ? {
                          outline: `2px solid ${PLAN_RED}`,
                          outlineOffset: "-2px",
                          background: "color-mix(in srgb, var(--plan-soft, #F8C8C7) 30%, transparent)",
                        }
                      : {}),
                    ...(dragRow === row.node.id ? { opacity: 0.45 } : {}),
                  }}
                >
                  <td
                    className="px-2 py-1.5 align-middle bg-surface-card"
                    style={{ borderBottom: PLAN_ROW_LINE }}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${row.node.name}`}
                      checked={ticked.has(row.node.id)}
                      onChange={() =>
                        setTicked((prev) => {
                          const next = new Set(prev);
                          if (next.has(row.node.id)) next.delete(row.node.id);
                          else next.add(row.node.id);
                          return next;
                        })
                      }
                    />
                  </td>
                  {visibleColumns.map((c, i) => {
                    const { group, starts, ends } = groupEdges(visibleColumns, i);
                    return (
                    <td
                      key={c.key}
                      className="px-2 py-1.5 align-middle bg-surface-card"
                      style={{
                        textAlign: c.align ?? "left",
                        borderBottom: PLAN_ROW_LINE,
                        // The bracket only, never a fill: a stripe the length
                        // of a long plan shouts over the data in it.
                        ...(group && starts ? { borderLeft: GROUP_EDGE } : {}),
                        ...(group && ends ? { borderRight: GROUP_EDGE } : {}),
                      }}
                    >
                      <Cell
                        columnKey={c.key}
                        row={row}
                        actor={actor}
                        employees={employees}
                        pending={pending}
                        onToggle={() => toggle(row.node.id)}
                        onRefresh={() => router.refresh()}
                        onRun={run}
                        onAddChild={addChild}
                        onDialog={setDialog}
                      />
                    </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* The row count and a SECOND New project, below the table.
          The toolbar's copy is above a table that fills the screen and then
          scrolls; by the time you have read to the bottom of a fifty-row plan
          and decided you want another project, the button that makes one is
          off-screen behind a scroll back up. This is the same action, where
          the reading ends. List view only — the Table and Kanban views have
          their own footers and neither is where a plan is read top to bottom. */}
      <div className="mt-2 flex items-center justify-between gap-3 flex-wrap">
        <p className="text-[13px]" style={{ color: "var(--color-ink-subtle)" }}>
          Showing {shown.length} of {counts.total} rows.
        </p>
        <button
          type="button"
          onClick={() => run(() => createPlanNode({ kind: "project", parentId: null }))}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-pill px-4 h-9 text-[14.5px] font-bold disabled:opacity-50"
          style={{
            color: PLAN_RED,
            background: "var(--color-surface-card)",
            border: `1.5px solid ${PLAN_RED}`,
          }}
        >
          <Plus size={15} strokeWidth={3} />
          New project
        </button>
      </div>

      {deleting && (
        <PlanDeleteDialog
          ids={deleting}
          name={
            deleting.length === 1
              ? shown.find((r) => r.node.id === deleting[0])?.node.name
              : undefined
          }
          pending={pending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => {
            const ids = deleting;
            setDeleting(null);
            void runBulk("Deleted", (id) => deletePlanNode(id), ids);
          }}
        />
      )}

      {dialog && (
        <PlanRowDialogs
          dialog={dialog}
          employees={employees}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            setTicked(new Set());
            router.refresh();
          }}
        />
      )}
    </div>
  );

  // A fixed overlay, not the native Fullscreen API: the native one takes over
  // the whole screen including the OS chrome, and Escape leaves it in a state
  // React never hears about.
  if (fullScreen) {
    return (
      <div
        className="fixed inset-0 z-[80] overflow-auto p-5"
        style={{ background: "var(--color-surface-page, #fff)" }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onFullScreenChange(false);
        }}
        tabIndex={-1}
        ref={(el) => el?.focus()}
      >
        {body}
      </div>
    );
  }

  return body;
}

function isFixed(key: string): boolean {
  return Boolean(COLUMNS.find((c) => c.key === key)?.fixed);
}

/* ── One cell ────────────────────────────────────────────────────────────── */

function Cell({
  columnKey,
  row,
  actor,
  employees,
  pending,
  onToggle,
  onRefresh,
  onRun,
  onAddChild,
  onDialog,
}: {
  columnKey: string;
  row: TableRow<PlanNode>;
  actor: ReturnType<typeof actorForRow>;
  employees: { id: string; name: string }[];
  pending: boolean;
  onToggle: () => void;
  onRefresh: () => void;
  onRun: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
  onAddChild: (parentId: string, kind: PlanKind) => void;
  onDialog: (d: PlanDialog) => void;
}) {
  const node = row.node;
  const childKind = CHILD_KIND[node.kind];

  switch (columnKey) {
    case "ref":
      // The indent and the caret travel WITH the Ref column, so dragging it
      // moves the hierarchy's visual spine rather than stranding the indent.
      return (
        <span
          className="flex items-center gap-1"
          style={{ paddingLeft: row.depth * 14 }}
          title={row.fullRef}
        >
          {row.hasChildren ? (
            <button
              type="button"
              onClick={onToggle}
              aria-label={row.expanded ? "Collapse" : "Expand"}
              aria-expanded={row.expanded}
              className="grid place-items-center size-4 shrink-0"
              style={{ color: "var(--color-ink-subtle)" }}
            >
              {row.expanded ? (
                <ChevronDown size={12} strokeWidth={2.6} />
              ) : (
                <ChevronRight size={12} strokeWidth={2.6} />
              )}
            </button>
          ) : (
            <span aria-hidden className="size-4 shrink-0" />
          )}
          <PlanRef>{row.ref}</PlanRef>
        </span>
      );

    case "controls":
      return (
        <span className="flex items-center gap-0.5">
          {childKind && (
            <IconBtn
              label={`Add a ${KIND_LABEL[childKind].toLowerCase()}`}
              disabled={pending}
              onClick={() => onAddChild(node.id, childKind)}
            >
              <Plus size={12} strokeWidth={2.6} />
            </IconBtn>
          )}
          <IconBtn
            label="Move up"
            disabled={pending}
            onClick={() => onRun(() => movePlanNode({ id: node.id, direction: "up" }))}
          >
            <MoveUp size={12} strokeWidth={2.6} />
          </IconBtn>
          <IconBtn
            label="Move down"
            disabled={pending}
            onClick={() => onRun(() => movePlanNode({ id: node.id, direction: "down" }))}
          >
            <MoveDown size={12} strokeWidth={2.6} />
          </IconBtn>
          <IconBtn
            label="Duplicate"
            disabled={pending}
            onClick={() => onRun(() => duplicatePlanNode(node.id))}
          >
            <Copy size={12} strokeWidth={2.6} />
          </IconBtn>
          <IconBtn label="Edit" disabled={pending} onClick={() => onDialog({ mode: "edit", row })}>
            <Pencil size={12} strokeWidth={2.6} />
          </IconBtn>
          <IconBtn
            label="Delete"
            disabled={pending}
            danger
            onClick={() => {
              // ASK FIRST, COUNT AFTER.
              //
              // This used to await `getPlanDeleteImpact` before opening
              // anything, so on a slow round-trip the trash button appeared to
              // do nothing at all — you click Delete and get silence, which
              // reads as a broken button and invites a second click. The
              // question is the same whatever the count turns out to be, so
              // it goes up immediately and the "and N rows beneath it" fills
              // in when the server answers.
              onDialog({ mode: "delete", row });
              void getPlanDeleteImpact(node.id).then((impact) => {
                if (!impact.ok) return;
                onDialog({
                  mode: "delete",
                  row,
                  impact: { nodes: impact.nodes, tasks: impact.tasks },
                });
              });
            }}
          >
            <Trash2 size={12} strokeWidth={2.6} />
          </IconBtn>
        </span>
      );

    case "name":
      return (
        <InlineName
          nodeId={node.id}
          value={node.name}
          style={levelStyleProps(node.kind)}
          title={`${row.fullRef} · ${node.name}`}
          disabled={pending}
          onOpen={() => onDialog({ mode: "detail", row })}
          onDone={onRefresh}
        />
      );

    case "owner":
      return (
        <InlinePerson
          nodeId={node.id}
          field="initiatorId"
          label="Owner"
          value={node.initiatorId}
          name={node.initiatorName}
          employees={employees}
          disabled={pending}
          onDone={onRefresh}
        />
      );

    case "doerStatus":
    case "initiatorStatus":
      return (
        <PlanStatusCell
          nodeId={node.id}
          kind={node.kind}
          flow={columnKey === "doerStatus" ? "doer" : "initiator"}
          // An executable reads its status of record off the linked task; the
          // node has no copy to disagree with it.
          status={isExecutable(node.kind) ? (node.task?.status ?? null) : node.status}
          approvalStatus={node.approvalStatus}
          actor={actor}
          expectedUpdatedAt={node.task?.updatedAt}
          onDone={onRefresh}
          disabled={pending}
        />
      );

    case "progress":
      return (
        <PlanProgressCell
          node={progressShape(node)}
          canRecord={actor.isAdmin || actor.isOwner}
          // The Days / rollup columns already carry the count; a second copy
          // here overflows the cell.
          showChildren={false}
          onDone={onRefresh}
        />
      );

    case "doer":
      // A SCHEDULED row's doer of record is `tasks.doer_id` — the live one,
      // with the reassignment lock, the audit event and the calendar move
      // behind it — so that is what the picker writes while a task exists.
      if (node.task) {
        return (
          <InlineDoer
            taskId={node.task.id}
            value={node.task.doerId ?? null}
            name={node.task.doerName ?? null}
            employees={employees}
            disabled={pending}
            onDone={onRefresh}
          />
        );
      }
      // Everything else shows the ROW's Doer — the dialog's "Doer" field,
      // `project_nodes.owner_id`. This used to be a button that only opened
      // the dialog, so a doer picked in that dialog left the column reading
      // "not scheduled" and a Project showed nothing at all. The field exists
      // at every level; the column now says what it holds, and writes it.
      return (
        <InlinePerson
          nodeId={node.id}
          field="ownerId"
          label="Doer"
          value={node.ownerId}
          name={node.ownerName}
          employees={employees}
          disabled={pending}
          onDone={onRefresh}
        />
      );

    case "priority":
      return (
        <Muted>
          {isExecutable(node.kind)
            ? (node.task?.priority ?? "—").replace(/_/g, " ")
            : (node.priority ?? "—").replace(/_/g, " ")}
        </Muted>
      );

    case "target":
      return (
        <InlineDate
          nodeId={node.id}
          field="targetDate"
          value={node.targetDate}
          disabled={pending}
          onDone={onRefresh}
        />
      );

    // Project and Milestone are dated by the work underneath them, so they
    // get no start/end box at all rather than one that writes nothing.
    case "start":
      return hasSchedule(node.kind) ? (
        <InlineDate
          nodeId={node.id}
          field="startsAt"
          value={node.startsAt?.slice(0, 10) ?? null}
          disabled={pending}
          onDone={onRefresh}
        />
      ) : null;

    case "end":
      return hasSchedule(node.kind) ? (
        <InlineDate
          nodeId={node.id}
          field="endsAt"
          value={node.endsAt?.slice(0, 10) ?? null}
          disabled={pending}
          onDone={onRefresh}
        />
      ) : null;

    case "due":
      // READ-ONLY, and read from whichever record owns it — the linked task on
      // an executable row, the row's own target date on a container. The two
      // agree while the plan drives the task, and part only when someone moves
      // a due date in the task list without touching the plan. SEEING THAT IS
      // THE POINT OF THE COLUMN.
      return (
        <Muted mono>
          {formatPlanDate(
            isExecutable(node.kind) ? (node.task?.dueAt ?? null) : node.targetDate,
          ) || "—"}
        </Muted>
      );

    case "days": {
      const d = durationDays(node.startsAt, node.endsAt);
      return <Muted mono>{d == null ? "—" : String(d)}</Muted>;
    }

    case "from":
      return <Muted mono>{node.startsAt ? timeOf(node.startsAt) : "—"}</Muted>;

    case "to":
      return <Muted mono>{node.endsAt ? timeOf(node.endsAt) : "—"}</Muted>;

    case "wms":
      if (!hasTask(node.kind)) return null;
      return node.task ? (
        <Link
          href={`/tasks/${node.task.id}` as Route}
          className="inline-flex items-center gap-1 text-[12.5px] hover:underline"
          style={{ color: PLAN_RED }}
          title="Open the task"
        >
          {node.task.taskNo ? `#${node.task.taskNo}` : "Open"}
          <ExternalLink size={10} strokeWidth={2.6} />
        </Link>
      ) : (
        <span className="text-[12px]" style={{ color: "var(--color-ink-subtle)" }}>
          Not scheduled
        </span>
      );

    case "description":
      return <Muted>{node.description ?? "—"}</Muted>;

    default:
      return null;
  }
}

/** The shape `PlanProgressCell` needs, from a full PlanNode. */
function progressShape(node: PlanNode): {
  id: string;
  kind: PlanKind;
  progressPercent: number | null;
  taskStatus: string | null;
  children: ReturnType<typeof progressShape>[];
} {
  return {
    id: node.id,
    kind: node.kind,
    progressPercent: node.progressPercent,
    taskStatus: node.task?.status ?? null,
    children: node.children.map(progressShape),
  };
}

function cellText(key: string, row: TableRow<PlanNode>): string {
  const node = row.node;
  switch (key) {
    case "ref": return row.ref;
    case "name": return node.name;
    case "owner": return node.initiatorName ?? "";
    case "doerStatus":
      return isExecutable(node.kind)
        ? (node.task?.status ?? "")
        : (node.status ?? "");
    // An archived row is never in the tree — the query filters them out — so
    // the ruling is whatever `approval_status` says, or nothing yet.
    case "initiatorStatus":
      return node.approvalStatus ?? "";
    case "progress": return node.progressPercent == null ? "" : `${node.progressPercent}%`;
    case "doer": return node.task?.doerName ?? node.ownerName ?? "";
    case "priority":
      return isExecutable(node.kind) ? (node.task?.priority ?? "") : (node.priority ?? "");
    case "target": return node.targetDate ?? "";
    case "start": return node.startsAt?.slice(0, 10) ?? "";
    case "end": return node.endsAt?.slice(0, 10) ?? "";
    case "due":
      return isExecutable(node.kind)
        ? (node.task?.dueAt?.slice(0, 10) ?? "")
        : (node.targetDate ?? "");
    case "days": {
      const d = durationDays(node.startsAt, node.endsAt);
      return d == null ? "" : String(d);
    }
    case "from": return node.startsAt ? timeOf(node.startsAt) : "";
    case "to": return node.endsAt ? timeOf(node.endsAt) : "";
    case "wms": return node.task ? (node.task.taskNo ? `#${node.task.taskNo}` : node.task.id) : "Not scheduled";
    case "description": return node.description ?? "";
    default: return "";
  }
}

function timeOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/* ── Inline editors ──────────────────────────────────────────────────────── */

/**
 * A date, edited in place.
 *
 * Writes on CHANGE rather than on blur: a native date picker commits when you
 * click a day and never fires a blur if you then click straight into another
 * row, which lost the edit. Clearing the box writes null, which is a real
 * answer — "this has no target date yet" — and not the same as leaving it.
 */
function InlineDate({
  nodeId,
  field,
  value,
  disabled,
  onDone,
}: {
  nodeId: string;
  field: "targetDate" | "startsAt" | "endsAt";
  value: string | null;
  disabled?: boolean;
  onDone: () => void;
}) {
  const [pending, startTransition] = React.useTransition();
  const [local, setLocal] = React.useState(value ?? "");

  // Adopt a fresh server value during render, so the box never shows a stale
  // date for a frame after a revalidate.
  const [seen, setSeen] = React.useState(value);
  if (value !== seen) {
    setSeen(value);
    setLocal(value ?? "");
  }

  function commit(next: string) {
    setLocal(next);
    startTransition(async () => {
      const iso =
        next === ""
          ? null
          : field === "targetDate"
            ? next
            : new Date(`${next}T00:00:00`).toISOString();
      const res = await updatePlanNode({ id: nodeId, [field]: iso });
      if (!res.ok) {
        toast.error(res.error);
        setLocal(value ?? "");
        return;
      }
      onDone();
    });
  }

  return (
    <input
      type="date"
      value={local}
      onChange={(e) => commit(e.target.value)}
      disabled={disabled || pending}
      className="w-full rounded-md px-1.5 h-7 text-[12.5px] outline-none focus:ring-1 disabled:opacity-50"
      style={{
        ...TABULAR,
        color: "var(--color-ink-strong)",
        background: "transparent",
        border: "1px solid transparent",
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = "var(--color-hairline-strong)";
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = "transparent";
      }}
    />
  );
}

/** The row's owner. Setting one is half of what makes a row a real task. */
/**
 * One person picker for the two people a plan row names — the Initiator
 * (`initiatorId`) and the Doer (`ownerId`). Two near-identical selects had
 * already drifted on the aria label alone; the field is a prop.
 */
function InlinePerson({
  nodeId,
  field,
  label,
  value,
  name,
  employees,
  disabled,
  onDone,
}: {
  nodeId: string;
  field: "initiatorId" | "ownerId";
  label: string;
  value: string | null;
  name: string | null;
  employees: { id: string; name: string }[];
  disabled?: boolean;
  onDone: () => void;
}) {
  const [pending, startTransition] = React.useTransition();

  function commit(next: string) {
    startTransition(async () => {
      const res = await updatePlanNode({ id: nodeId, [field]: next || null });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onDone();
    });
  }

  return (
    <select
      value={value ?? ""}
      onChange={(e) => commit(e.target.value)}
      disabled={disabled || pending}
      aria-label={`${label}${name ? ` — ${name}` : ""}`}
      className="w-full rounded-md px-1 h-7 text-[12.5px] outline-none disabled:opacity-50"
      style={{
        color: value ? "var(--color-ink-strong)" : "var(--color-ink-subtle)",
        background: "transparent",
        border: "1px solid transparent",
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = "var(--color-hairline-strong)";
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = "transparent";
      }}
    >
      <option value="">—</option>
      {employees.map((e) => (
        <option key={e.id} value={e.id}>
          {e.name}
        </option>
      ))}
    </select>
  );
}

/**
 * The row's name — read, opened, or renamed in place.
 *
 * A single click still opens the row, because that is what this cell has
 * always done and it is how people reach everything else about a row.
 * DOUBLE-CLICK turns it into a text box: renaming is the one edit you make
 * while looking at the list rather than at the record, and sending it through
 * a dialog for a typo is three clicks and a context switch.
 *
 * Enter commits, Escape puts back what was there, and blur commits — the same
 * three keys every other cell in this table answers to. An empty name is
 * refused rather than saved: a row with no name cannot be found again.
 */
function InlineName({
  nodeId,
  value,
  style,
  title,
  disabled,
  onOpen,
  onDone,
}: {
  nodeId: string;
  value: string;
  style: React.CSSProperties;
  title: string;
  disabled?: boolean;
  onOpen: () => void;
  onDone: () => void;
}) {
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(value);
  const [pending, startTransition] = React.useTransition();

  // Adopt a fresh server value during render rather than in an effect, so the
  // box never shows a stale name for a frame after a revalidate.
  const [lastValue, setLastValue] = React.useState(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value);
  }

  function commit() {
    const next = draft.trim();
    setEditing(false);
    if (!next) {
      toast.error("A row needs a name.");
      setDraft(value);
      return;
    }
    if (next === value) return;
    startTransition(async () => {
      const res = await updatePlanNode({ id: nodeId, name: next });
      if (!res.ok) {
        toast.error(res.error);
        setDraft(value);
        return;
      }
      onDone();
    });
  }

  if (editing) {
    return (
      <input
        // The box only exists because someone just asked for it by
        // double-clicking, so focus belongs in it.
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(value);
            setEditing(false);
          }
        }}
        disabled={pending}
        aria-label="Rename this row"
        className="block w-full min-w-0 rounded-md px-2 h-8 outline-none"
        style={{
          ...style,
          color: "var(--color-ink-strong)",
          background: "var(--color-surface-card)",
          // The module's red, not a grey hairline: this box is open because
          // someone is mid-edit, and it should be obvious at a glance which
          // row of a long list is currently taking keystrokes.
          border: `1px solid ${PLAN_RED}`,
          boxShadow: `0 0 0 3px color-mix(in srgb, ${PLAN_RED} 12%, transparent)`,
        }}
      />
    );
  }

  /**
   * Two gestures on one cell, and the second one had no way of being found.
   *
   * Click opens the row; DOUBLE-click renames it in place. Double-click is the
   * right gesture — it is what a spreadsheet does, and a single click that
   * dropped you into an edit box would make opening a row impossible. But it
   * is invisible: the only thing that ever said so was a `title` attribute,
   * which you have to already be hovering the right cell to read.
   *
   * So the pencil appears on hover, at the end of the name, and starts the
   * same edit on one click. Deliberately a DIFFERENT glyph from the row
   * controls' pencil, which opens the full edit dialog — two pencils doing two
   * things is worse than one pencil and one pen.
   */
  return (
    <span className="flex w-full min-w-0 items-center gap-1">
      <button
        type="button"
        onClick={onOpen}
        onDoubleClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        disabled={disabled}
        className="block min-w-0 flex-1 truncate text-left hover:underline"
        style={{ ...style, color: "var(--color-ink-strong)" }}
        title={`${title} — double-click to rename`}
      >
        {value}
      </button>
      <button
        type="button"
        onClick={() => {
          setDraft(value);
          setEditing(true);
        }}
        disabled={disabled}
        aria-label={`Rename ${value}`}
        title="Rename"
        className="shrink-0 grid place-items-center size-6 rounded-md opacity-0 transition-opacity group-hover/row:opacity-100 focus-visible:opacity-100 hover:bg-black/[0.06]"
        style={{ color: "var(--color-ink-subtle)" }}
      >
        <PenLine size={13} strokeWidth={2.4} />
      </button>
    </span>
  );
}

function InlineDoer({
  taskId,
  value,
  name,
  employees,
  disabled,
  onDone,
}: {
  taskId: string;
  value: string | null;
  name: string | null;
  employees: { id: string; name: string }[];
  disabled?: boolean;
  onDone: () => void;
}) {
  const [pending, startTransition] = React.useTransition();

  function commit(next: string) {
    if (!next || next === value) return;
    startTransition(async () => {
      const res = await reassignDoer(taskId, next);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      onDone();
    });
  }

  return (
    <select
      value={value ?? ""}
      onChange={(e) => commit(e.target.value)}
      disabled={disabled || pending}
      aria-label={`Doer${name ? ` — ${name}` : ""}`}
      className="w-full rounded-md px-1 h-7 text-[12.5px] outline-none disabled:opacity-50"
      style={{
        color: value ? "var(--color-ink-strong)" : "var(--color-ink-subtle)",
        background: "transparent",
        border: "1px solid transparent",
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = "var(--color-hairline-strong)";
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = "transparent";
      }}
    >
      {/* Present only until someone picks: an unassigned task is a state the
          data can be in, not one this control can put it in. */}
      {!value && <option value="">—</option>}
      {employees.map((e) => (
        <option key={e.id} value={e.id}>
          {e.name}
        </option>
      ))}
    </select>
  );
}

/* ── Small pieces ────────────────────────────────────────────────────────── */

function Muted({
  children,
  mono,
}: {
  children: React.ReactNode;
  mono?: boolean;
}) {
  return (
    <span
      className="block truncate text-[12.5px]"
      style={{ ...(mono ? TABULAR : {}), color: "var(--color-ink-muted)" }}
    >
      {children}
    </span>
  );
}

function Chip({
  label,
  n,
  active,
  onClick,
}: {
  label: string;
  n: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-pill px-2.5 h-7 text-[12.5px] font-semibold"
      style={
        active
          ? { background: PLAN_RED, color: "#fff" }
          : {
              color: "var(--color-ink-muted)",
              background: "var(--color-surface-card)",
              border: "1px solid var(--color-hairline-strong)",
            }
      }
    >
      {label}
      <span style={{ ...TABULAR, opacity: 0.8 }}>{n}</span>
    </button>
  );
}

function ToolBtn({
  children,
  onClick,
  label,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="grid place-items-center rounded-lg size-7"
      style={{
        color: "var(--color-ink-muted)",
        background: "var(--color-surface-card)",
        border: "1px solid var(--color-hairline-strong)",
      }}
    >
      {children}
    </button>
  );
}

function IconBtn({
  children,
  onClick,
  label,
  disabled,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  label: string;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="grid place-items-center rounded-md size-[22px] disabled:opacity-35 hover:bg-black/[0.05]"
      style={{ color: danger ? "#DC2626" : "var(--color-ink-subtle)" }}
    >
      {children}
    </button>
  );
}

/** Drag to reorder, tick to show. Fixed columns cannot be unticked. */
function ColumnMenu({
  order,
  hidden,
  onClose,
  onChange,
}: {
  order: string[];
  hidden: Set<string>;
  onClose: () => void;
  onChange: (order: string[], hidden: Set<string>) => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [dragKey, setDragKey] = React.useState<string | null>(null);

  React.useEffect(() => {
    function onAway(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", onAway);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onAway);
      document.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="absolute right-0 z-50 mt-1 w-[230px] rounded-xl p-1 shadow-lg max-h-[340px] overflow-y-auto"
      style={{
        background: "var(--color-surface-card)",
        border: "1px solid var(--color-hairline-strong)",
      }}
    >
      {order.map((key) => {
        const col = COLUMNS.find((c) => c.key === key);
        if (!col) return null;
        const fixed = Boolean(col.fixed);
        return (
          <div
            key={key}
            draggable
            onDragStart={() => setDragKey(key)}
            onDragOver={(e) => e.preventDefault()}
            onDrop={() => {
              if (!dragKey || dragKey === key) return;
              const next = order.filter((k) => k !== dragKey);
              next.splice(next.indexOf(key), 0, dragKey);
              onChange(next, hidden);
              setDragKey(null);
            }}
            className="flex items-center gap-2 px-2 py-1.5 rounded-lg text-[13px] cursor-grab hover:bg-black/[0.04]"
            style={{ color: "var(--color-ink)" }}
          >
            <input
              type="checkbox"
              checked={!hidden.has(key)}
              disabled={fixed}
              onChange={() => {
                const next = new Set(hidden);
                if (next.has(key)) next.delete(key);
                else next.add(key);
                onChange(order, next);
              }}
              aria-label={col.header || key}
            />
            <span className="flex-1 truncate">{col.header || "Controls"}</span>
            {fixed && (
              <span className="text-[10.5px]" style={{ color: "var(--color-ink-subtle)" }}>
                fixed
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Is `candidate` inside `rootId`'s own branch?
 *
 * Walked over the FLATTENED visible rows rather than the tree, because that is
 * what the drop handler has in hand — each row knows its parent, so following
 * parents up to a root is a short hop bounded by the six levels.
 *
 * `true` for the row itself, which is the degenerate case of the same rule:
 * you cannot drop a branch inside itself, and that includes onto its own head.
 */
function isInBranch(
  rows: { node: { id: string; parentId: string | null } }[],
  rootId: string,
  candidate: string,
): boolean {
  const parentOf = new Map(rows.map((r) => [r.node.id, r.node.parentId]));
  let at: string | null | undefined = candidate;
  const seen = new Set<string>();
  while (at && !seen.has(at)) {
    if (at === rootId) return true;
    seen.add(at);
    at = parentOf.get(at) ?? null;
  }
  return false;
}
