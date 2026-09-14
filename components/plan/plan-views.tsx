"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Search,
  X,
} from "lucide-react";
import {
  CHILD_KIND,
  KIND_LABEL,
  KIND_LABEL_PLURAL,
  formatPlanDate,
  refFor,
  hasTask,
  isExecutable,
  levelStyleProps,
  type PlanKind,
} from "@/lib/plan/levels";
import {
  childCompletion,
  formatCompleted,
  nodeFraction,
  projectFraction,
  toPercent,
} from "@/lib/plan/progress";
import {
  expandableIds,
  flattenPlanTree,
  parseViewPath,
  resolveViewPath,
  selectAt,
  serialiseViewPath,
} from "@/lib/plan/views";
import { actorForRow, type PlanViewer } from "@/lib/plan/viewer";
import type { PlanNode } from "@/lib/queries/plan";
import { PlanStatusCell } from "./plan-status-cell";
import { RecordedInput } from "./plan-progress-cell";
import { PlanEditDialog } from "./plan-edit-dialog";
import { PlanPanelCell } from "./plan-panel-cell";
import { PlanRef } from "./plan-ref";
import { PLAN_RED, TABULAR } from "./theme";

/**
 * Project Views — the whole plan as ONE indented tree, with the columns that
 * say where each row stands.
 *
 *   ▾ P1  AA TECH                 Not Started   15-Jul-2026   0%   0/2 milestones
 *     ▸ M1  NEW MILESTONE         Not Started   —             0%   0/3 results
 *
 * WHICH COLUMNS A ROW FILLS IS DECIDED BY ITS LEVEL, from the same three
 * predicates the writes enforce — there is no second table of per-level fields
 * that could drift from them:
 *
 *   isExecutable(kind)  NO Progress percent — an action's progress IS its
 *                       status, and a second number beside the chip could only
 *                       disagree with it.
 *   hasTask(kind)       The Task column: the linked record, or "Not scheduled".
 *                       The column itself comes and goes with the rows — see
 *                       the note on COLUMNS.
 *
 * The Name column is FROZEN to the left edge. The grid can still scroll
 * sideways, and a row you cannot identify while reading its figures is the
 * reason this screen needed two screenshots to describe.
 */

/**
 * The columns, in order, with FIXED widths.
 *
 * Order matters: Status → Files are the ones every level fills, so they sit in
 * the first screenful. Task follows, because it is the level-specific one.
 *
 * A COLUMN NO ROW ON SCREEN CAN FILL IS NOT SHOWN. Opened on the projects,
 * every Task cell is blank — a Project has no task, and neither does a
 * Milestone — so the column was three inches of empty table charged against a
 * screen that already scrolls sideways. It appears when the rows that fill it
 * do: expand down to a Result, an Action or a Sub-action and the column is
 * there; collapse back and it goes. See `visibleColumns` below.
 *
 * Start and End are gone outright. They were level-specific in the same way,
 * but the schedule a plan is read against is the Target date, which every
 * level carries and which already has a column — two more date columns that
 * only the bottom three levels could ever fill was the table paying for
 * information nobody was reading it for. (To bring them back: a column entry
 * here, a `hasSchedule(n.kind)` cell in the row, and `startsAt` / `endsAt` are
 * still on the node.)
 *
 * The widths are fixed and the table is laid out `fixed` for a reason. Under
 * `auto`, the browser hands the slack to whichever column has the longest
 * content: the Name column swallowed the whole viewport and shoved every data
 * column off-screen, which is what made this table unreadable.
 */
const COLUMNS = [
  { key: "name", header: "Name", width: 480, frozen: true },
  // Two columns, not one — the same split the hierarchy and register tables
  // make. Costs 110px on a table that already scrolls sideways, and is worth
  // it: one merged chip showed the ruling OVER the report, so a row an
  // initiator had ruled on stopped showing what its doer actually said.
  { key: "doerStatus", header: "Doer Status", width: 140 },
  { key: "initiatorStatus", header: "Initiator Status", width: 150 },
  { key: "target", header: "Target", width: 130 },
  { key: "progress", header: "Progress", width: 215 },
  { key: "children", header: "Children", width: 170 },
  { key: "files", header: "Files", width: 100 },
  { key: "task", header: "Task", width: 130 },
] as const;

const NAME_WIDTH = COLUMNS[0].width;

interface Props {
  tree: PlanNode[];
  viewer: PlanViewer;
  /** For the edit dialog's owner picker — see the Task column. */
  employees: { id: string; name: string }[];
}

export function PlanViews({ tree, viewer, employees }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const [query, setQuery] = React.useState("");
  /**
   * The row whose edit dialog is open, from the Task column.
   *
   * "Not scheduled" is not a state you can do anything about from a table
   * cell: a row becomes a task by being given an owner and a target date, and
   * both of those live in the edit dialog. So the cell opens it rather than
   * describing the problem and leaving you to find the row again elsewhere.
   */
  const [scheduling, setScheduling] = React.useState<{ node: PlanNode; ref: string } | null>(
    null,
  );
  const [expanded, setExpanded] = React.useState<Set<string>>(() => {
    // Projects open, everything below closed — the same first-paint guard the
    // hierarchy table uses: a plan with thousands of sub-actions must not put
    // every one of them in the DOM before anyone asks for one.
    const open = new Set<string>();
    for (const root of tree) if (root.children.length > 0) open.add(root.id);
    return open;
  });

  // The scope is an ID in the URL, resolved against the live tree. A stale id
  // is dropped, not guessed at — and when what resolved differs from what came
  // in, the URL is rewritten so an old bookmark heals itself.
  const incoming = React.useMemo(
    () => parseViewPath(new URLSearchParams(params.toString())),
    [params],
  );
  const resolved = React.useMemo(
    () => resolveViewPath(tree, incoming),
    [tree, incoming],
  );

  React.useEffect(() => {
    const want = serialiseViewPath(resolved.selection).toString();
    const have = serialiseViewPath(incoming).toString();
    if (want !== have) {
      router.replace((want ? `${pathname}?${want}` : pathname) as Route, {
        scroll: false,
      });
    }
  }, [resolved.selection, incoming, pathname, router]);

  const rootId = resolved.selection.projectId ?? null;
  const projects = React.useMemo(
    () => tree.filter((n) => n.kind === "project"),
    [tree],
  );

  const lines = React.useMemo(
    () => flattenPlanTree(tree, expanded, { rootId, query }),
    [tree, expanded, rootId, query],
  );

  /**
   * The columns worth drawing for the rows currently expanded.
   *
   * Task is the only conditional one, and the condition is the rows
   * themselves rather than a setting: nothing to remember, nothing to switch
   * back on, and the column can never be on screen empty. See COLUMNS.
   */
  const visibleColumns = React.useMemo(() => {
    const anyTask = lines.some((l) => hasTask(l.node.kind));
    return COLUMNS.filter((c) => c.key !== "task" || anyTask);
  }, [lines]);

  const showTask = visibleColumns.some((c) => c.key === "task");

  /** The table is exactly as wide as the columns it is drawing. */
  const tableWidth = React.useMemo(
    () => visibleColumns.reduce((sum, c) => sum + c.width, 0),
    [visibleColumns],
  );

  /** id → owner, so a row's actor can be derived without walking the tree again. */
  const ownerById = React.useMemo(() => {
    const map = new Map<string, string | null>();
    const stack: PlanNode[] = [...tree];
    while (stack.length > 0) {
      const node = stack.pop()!;
      map.set(node.id, node.ownerId);
      stack.push(...node.children);
    }
    return map;
  }, [tree]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** The project filter writes the same `?project=` the resolver reads. */
  function scopeTo(id: string | null) {
    const next = id ? selectAt(resolved.selection, "project", id) : {};
    const qs = serialiseViewPath(next).toString();
    router.replace((qs ? `${pathname}?${qs}` : pathname) as Route, { scroll: false });
  }

  const refresh = React.useCallback(() => router.refresh(), [router]);

  return (
    <div className="min-w-0">
      {/* ── Header ────────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="min-w-0">
          <h1
            className="font-black"
            style={{ fontSize: 22, letterSpacing: "-0.018em", color: "var(--color-ink-strong)" }}
          >
            Project Views
          </h1>
          <p className="mt-0.5 text-[13.5px]" style={{ color: "var(--color-ink-muted)" }}>
            The whole plan as one tree — open a row to see what sits under it.
          </p>
        </div>

        <span className="flex-1" />

        <label className="relative min-w-[210px]">
          <Search
            size={14}
            strokeWidth={2.4}
            className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
            style={{ color: "var(--color-ink-subtle)" }}
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Find a row…"
            aria-label="Find a row"
            className="w-full rounded-lg pl-9 pr-2.5 h-9 text-[14px] outline-none focus:ring-1"
            style={{
              background: "var(--color-surface-card)",
              border: "1px solid var(--color-hairline-strong)",
              color: "var(--color-ink)",
            }}
          />
        </label>

        <select
          value={rootId ?? ""}
          onChange={(e) => scopeTo(e.target.value || null)}
          aria-label="Show one project"
          className="rounded-lg px-3 h-9 text-[14px] outline-none"
          style={{
            background: "var(--color-surface-card)",
            border: "1px solid var(--color-hairline-strong)",
            color: "var(--color-ink)",
            minWidth: 200,
            maxWidth: 300,
          }}
        >
          <option value="">All projects</option>
          {/* The ref is how people refer to a project out loud, so it belongs
              in the picker as well as on the row. */}
          {projects.map((p, i) => (
            <option key={p.id} value={p.id}>
              {refFor("project", i + 1)} · {p.name}
            </option>
          ))}
        </select>

        <HeaderBtn onClick={() => setExpanded(expandableIds(tree))}>
          <ChevronsUpDown size={13} strokeWidth={2.4} />
          Expand all
        </HeaderBtn>
        <HeaderBtn onClick={() => setExpanded(new Set())}>
          <X size={13} strokeWidth={2.4} />
          Collapse
        </HeaderBtn>
      </div>

      {/* ── The tree ──────────────────────────────────────────────────── */}
      {/* The forms tables' shell, so a register looks like a register
          wherever you meet one: the navy outer edge, the tinted heading band
          under its own heavier lid, hairline rules, and the same scrollbar.
          `data-grid` carries the rules and the band; the vertical scroll and
          the height cap are this screen's own. */}
      <div
        className="rounded-section data-grid-scroll overflow-y-auto"
        style={{
          border: "2px solid var(--color-table-edge)",
          boxShadow: "0 1px 2px rgba(15, 23, 42, 0.04)",
          background: "var(--color-surface-card)",
          maxHeight: "calc(100vh - 300px)",
        }}
      >
        <table
          className="plan-table"
          style={{
            borderCollapse: "separate",
            borderSpacing: 0,
            // `fixed` + an exact width: every column is the width it says it
            // is, and none of them can absorb the slack.
            tableLayout: "fixed",
            width: tableWidth,
            minWidth: "100%",
          }}
        >
          <colgroup>
            {visibleColumns.map((c) => (
              <col key={c.key} style={{ width: c.width }} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-30">
            <tr>
              {visibleColumns.map((c) => (
                <Th key={c.key} width={c.width} frozen={"frozen" in c && c.frozen}>
                  {c.header}
                </Th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.length === 0 && (
              <tr>
                <td
                  colSpan={visibleColumns.length}
                  className="px-4 py-12 text-center text-[14px]"
                  style={{ color: "var(--color-ink-subtle)" }}
                >
                  {query ? "Nothing here matches." : "No projects yet."}
                </td>
              </tr>
            )}

            {lines.map((line) => {
              const n = line.node;
              const openable = line.childCount > 0;
              const childKind = CHILD_KIND[n.kind];
              const rollup = childCompletion(n, childKind);
              const executable = isExecutable(n.kind);
              const actor = actorForRow(viewer, {
                ownerId: n.ownerId,
                ancestorOwnerIds: line.ancestorIds.map((id) => ownerById.get(id) ?? null),
                doerId: n.task?.doerId ?? null,
              });

              return (
                <tr key={n.id}>
                  {/* Name — frozen, so the row stays identifiable while the
                      dates scroll past. */}
                  <Td frozen width={NAME_WIDTH}>
                    <span
                      className="flex items-center gap-2.5 min-w-0"
                      style={{ paddingLeft: line.depth * 26 }}
                    >
                      <button
                        type="button"
                        onClick={() => openable && toggle(n.id)}
                        disabled={!openable}
                        aria-label={openable ? (line.expanded ? "Collapse" : "Expand") : undefined}
                        aria-expanded={openable ? line.expanded : undefined}
                        className="grid place-items-center shrink-0 disabled:cursor-default"
                        style={{ width: 16, height: 16 }}
                      >
                        {openable ? (
                          line.expanded ? (
                            <ChevronDown size={15} strokeWidth={2.6} style={{ color: PLAN_RED }} />
                          ) : (
                            <ChevronRight
                              size={15}
                              strokeWidth={2.6}
                              style={{ color: "var(--color-ink-subtle)" }}
                            />
                          )
                        ) : (
                          // A dot on a leaf, so the column of markers still
                          // lines up down the page.
                          <span
                            aria-hidden
                            className="rounded-full"
                            style={{
                              width: 5,
                              height: 5,
                              background: "var(--color-hairline-strong)",
                            }}
                          />
                        )}
                      </button>

                      <PlanRef title={line.fullRef}>{line.ref}</PlanRef>

                      {/* LEVEL_STYLE carries the hierarchy — weight, size,
                          italics and caps. Caps is a text-transform, so the
                          stored name keeps the case its author typed. */}
                      <span
                        className="min-w-0 truncate"
                        style={{
                          ...levelStyleProps(n.kind),
                          color: "var(--color-ink-strong)",
                        }}
                        title={`${line.fullRef} · ${KIND_LABEL[n.kind]}`}
                      >
                        {n.name}
                      </span>
                    </span>
                  </Td>

                  <Td>
                    <PlanStatusCell
                      nodeId={n.id}
                      kind={n.kind}
                      flow="doer"
                      // An executable reads its status of record off the linked
                      // task; the node keeps no copy to disagree with it.
                      status={executable ? (n.task?.status ?? null) : n.status}
                      approvalStatus={n.approvalStatus}
                      actor={actor}
                      expectedUpdatedAt={n.task?.updatedAt}
                      onDone={refresh}
                      compact
                    />
                  </Td>

                  <Td>
                    <PlanStatusCell
                      nodeId={n.id}
                      kind={n.kind}
                      flow="initiator"
                      status={executable ? (n.task?.status ?? null) : n.status}
                      approvalStatus={n.approvalStatus}
                      actor={actor}
                      expectedUpdatedAt={n.task?.updatedAt}
                      onDone={refresh}
                      compact
                    />
                  </Td>

                  <Td>
                    <Muted mono>{formatPlanDate(n.targetDate) || "—"}</Muted>
                  </Td>

                  {/* The percent, and — on a milestone — the box that sets it.
                      A MILESTONE IS THE ONLY LEVEL WITH A NUMBER TO JUDGE.
                      The project's figure is its milestones averaged and the
                      result's is its actions counted; both are answers to
                      their own children, so neither gets a box to overrule
                      them with. Typing here moves the bars above it. */}
                  <Td>
                    {!executable && (
                      <span className="flex items-center gap-1.5 min-w-0">
                        <ProgressBar
                          percent={toPercent(
                            n.kind === "project" ? projectFraction(n) : nodeFraction(n),
                          )}
                        />
                        {n.kind === "milestone" && (actor.isAdmin || actor.isOwner) && (
                          <RecordedInput node={n} onDone={refresh} />
                        )}
                      </span>
                    )}
                  </Td>

                  <Td>
                    {childKind && rollup.total > 0 ? (
                      // Named after the level below, read off CHILD_KIND rather
                      // than written out four times.
                      <Muted mono>
                        {formatCompleted(rollup.completed)}/{rollup.total}{" "}
                        {(rollup.total === 1
                          ? KIND_LABEL[childKind]
                          : KIND_LABEL_PLURAL[childKind]
                        ).toLowerCase()}
                      </Muted>
                    ) : (
                      <Muted>—</Muted>
                    )}
                  </Td>

                  <Td>
                    <span className="flex items-center gap-1">
                      <PlanPanelCell
                        nodeId={n.id}
                        mode="attachments"
                        count={n.attachmentCount}
                        onDone={refresh}
                      />
                      <PlanPanelCell
                        nodeId={n.id}
                        mode="links"
                        links={n.links}
                        onDone={refresh}
                      />
                    </span>
                  </Td>

                  {/* Only while a row that can fill it is on screen — the
                      header is doing the same, so the two cannot disagree. */}
                  {showTask && (
                  <Td>
                    {hasTask(n.kind) &&
                      (n.task ? (
                        // Two words, and both of them do something: the one
                        // that says a task exists opens it, the one that says
                        // none does opens what makes one. The task number is
                        // in the tooltip — this column answers "is this
                        // scheduled", and a number answers a different
                        // question in the same space.
                        <Link
                          href={`/tasks/${n.task.id}` as Route}
                          className="text-[12.5px] hover:underline"
                          style={{ color: PLAN_RED }}
                          title={
                            n.task.taskNo
                              ? `Open task #${n.task.taskNo}`
                              : "Open the task"
                          }
                        >
                          Scheduled
                        </Link>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setScheduling({ node: n, ref: line.ref })}
                          className="text-[12px] hover:underline"
                          style={{ color: "var(--color-ink-subtle)" }}
                          title="Give it an owner and a target date and it becomes a task"
                        >
                          Not scheduled
                        </button>
                      ))}
                  </Td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-2 text-[12px]" style={{ color: "var(--color-ink-subtle)" }}>
        {lines.length} {lines.length === 1 ? "row" : "rows"} shown. Expansion is cheap —
        the whole subtree is already loaded.
      </p>

      {/* The module's ONE edit dialog, not a scheduling form of this screen's
          own: a row given an owner here and a row given one from the register
          must end up in the same state, and two forms writing the same node
          would not stay that way. */}
      {scheduling && (
        <PlanEditDialog
          node={scheduling.node}
          refLabel={scheduling.ref}
          employees={employees}
          onClose={() => setScheduling(null)}
          onDone={() => {
            setScheduling(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

/* ── Pieces ──────────────────────────────────────────────────────────────── */

function ProgressBar({ percent }: { percent: number }) {
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      {/* The number carries the weight; the unit stays quiet beside it. */}
      <span
        className="shrink-0 font-bold"
        style={{ ...TABULAR, fontSize: 13.5, color: "var(--color-ink-strong)" }}
      >
        {percent}
      </span>
      <span
        className="shrink-0"
        style={{ fontSize: 11.5, color: "var(--color-ink-subtle)" }}
      >
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

function Th({
  children,
  width,
  frozen,
}: {
  children?: React.ReactNode;
  width: number;
  frozen?: boolean;
}) {
  return (
    <th
      className="px-3 py-2.5 text-left text-[11.5px] font-bold uppercase tracking-wide whitespace-nowrap"
      style={{
        width,
        minWidth: width,
        color: "var(--color-ink-soft)",
        // Inline, because `.plan-table thead th` sets a background of its own
        // and a stylesheet rule cannot outrank it from here.
        background: "color-mix(in srgb, var(--color-blue) 8%, var(--color-surface-soft))",
        // The band's lower edge, in the table's own navy — the one line this
        // table keeps, because it separates the headings from the data rather
        // than chopping the data up.
        borderBottom: "2px solid var(--color-table-edge)",
        ...(frozen
          ? {
              position: "sticky",
              left: 0,
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
}: {
  children?: React.ReactNode;
  width?: number;
  frozen?: boolean;
}) {
  return (
    <td
      // The separator is on the CELL, not the row: a sticky cell paints its own
      // background over a border set on the <tr>, which is how a frozen column
      // ends up as the one stripe with no line under it.
      className="px-3 py-2.5 align-middle"
      style={{
        width,
        minWidth: width,
        borderBottom: "1px solid var(--color-hairline)",
        ...(frozen
          ? {
              position: "sticky",
              left: 0,
              zIndex: 1,
            }
          : {}),
      }}
    >
      {children}
    </td>
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

function HeaderBtn({
  children,
  onClick,
}: {
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-lg px-3 h-9 text-[13.5px] font-semibold whitespace-nowrap"
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
