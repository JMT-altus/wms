"use client";

import * as React from "react";
import * as Tooltip from "@radix-ui/react-tooltip";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { ExternalLink, Gavel } from "lucide-react";
import { toast } from "sonner";
import {
  KIND_LABEL,
  formatPlanDate,
  hasTask,
  isExecutable,
  levelStyleProps,
} from "@/lib/plan/levels";
import { matchesChip, type PlanChip } from "@/lib/plan/table";
import {
  PLAN_RESTRICTED_STATUSES,
  PLAN_STATUS_LABEL,
  PLAN_STATUS_TONE,
  PLAN_WORKING_STATUSES,
  canSetPlanStatus,
  effectivePlanStatus,
  hasStandingVerdict,
  isRestrictedStatus,
  isWorkingStatus,
  type PlanStatusChoice,
} from "@/lib/plan/status";
import { actorForRow, type PlanViewer } from "@/lib/plan/viewer";
import type { PlanNode } from "@/lib/queries/plan";
import { setPlanNodeStatus } from "@/app/(project)/project-plan/actions";
import { PLAN_RED, PLAN_RED_SOFT, PLAN_SIDE, TABULAR } from "./theme";

/**
 * The plan board.
 *
 * THE SAME PAGE, opened on the board — not a second screen with its own data.
 * Sharing the page means sharing the tree, the search, the project filter and
 * the level pill: switch back to List and you are looking at exactly the rows
 * you were just looking at as cards.
 *
 * Containers belong here as much as actions do — a board that could only show
 * the executable third of the plan leaves a Milestone someone marked Follow Up
 * with nowhere to appear.
 */

/** The signal that a row still needs an owner and a date. First, deliberately. */
const UNSCHEDULED = "__unscheduled__" as const;

type ColumnId = typeof UNSCHEDULED | PlanStatusChoice;

/**
 * THE BOARD HAS TWO HALVES, because a plan row has two answers.
 *
 * Left, the DOER's: still to be scheduled, then their own progress report.
 * Right, the INITIATOR's: the ruling standing on the row, if any.
 *
 * They cannot share a strip. The board used to run one row of columns taken
 * from `USER_TASK_STATUSES`, which put On Hold — a RULING, not a report —
 * among the doer's columns, and left the other three verdicts with nowhere to
 * be at all: a card an initiator had ruled on sat in whatever doer column it
 * was last in, wearing a badge, and refused to move. Splitting them gives
 * every ruling a column and makes the board say the same thing the table's
 * Doer Status / Initiator Status columns say.
 *
 * A card is in exactly ONE column across both halves — see `columnFor`. Two
 * copies of a row on one board is not a second axis, it is a row you have to
 * remember to update twice.
 */
const DOER_COLUMNS: ColumnId[] = [UNSCHEDULED, ...PLAN_WORKING_STATUSES];

/**
 * `archived` is deliberately absent: archiving is a ruling, but an archived
 * row is not IN the tree this board reads, so the column could only ever be
 * empty.
 */
const INITIATOR_COLUMNS: ColumnId[] = PLAN_RESTRICTED_STATUSES.filter(
  (s) => s !== "archived",
);

const ALL_COLUMNS: ColumnId[] = [...DOER_COLUMNS, ...INITIATOR_COLUMNS];

interface Props {
  tree: PlanNode[];
  viewer: PlanViewer;
  query: string;
  projectId: string | null;
  /** The header chip, honoured here exactly as the hierarchy honours it. */
  chip?: PlanChip;
  /** Show only this level, when the level pill is on one. */
  kinds?: readonly string[] | null;
}

interface Card {
  node: PlanNode;
  ancestorOwnerIds: (string | null)[];
  path: string;
}

export function PlanKanban({ tree, viewer, query, projectId, chip, kinds }: Props) {
  const router = useRouter();
  const [dragging, setDragging] = React.useState<string | null>(null);
  const [over, setOver] = React.useState<ColumnId | null>(null);
  const [pending, setPending] = React.useState(false);

  const cards = React.useMemo(() => {
    const out: Card[] = [];
    const q = query.trim().toLowerCase();
    const roots = projectId ? tree.filter((n) => n.id === projectId) : tree;

    function walk(node: PlanNode, ownerTrail: (string | null)[], path: string[]) {
      const matches =
        q === "" ||
        node.name.toLowerCase().includes(q) ||
        (node.description ?? "").toLowerCase().includes(q);
      const levelOk = !kinds || kinds.includes(node.kind);
      if (matches && levelOk && matchesChip(node, chip ?? null)) {
        out.push({ node, ancestorOwnerIds: ownerTrail, path: path.join(" / ") });
      }
      for (const child of node.children) {
        walk(child, [...ownerTrail, node.ownerId], [...path, node.name]);
      }
    }
    for (const root of roots) walk(root, [], []);
    return out;
  }, [tree, query, projectId, chip, kinds]);

  /**
   * Every card filed under BOTH of its answers — its doer column always, and
   * its initiator column as well when a ruling stands on it.
   *
   * This is the point of the two halves, and it was wrong on the first pass:
   * one card, placed by verdict-over-report, meant that ruling on a row made
   * its doer's status vanish from the board. Mark an Action Abandoned while a
   * Not Approved is standing and the card stayed in Not Approved — the
   * Abandoned column you had just filed into was empty.
   *
   * The two halves are two axes, not two ends of one strip. A row appearing in
   * each is the board saying both of the things the row actually says, the
   * same way the table's two columns do. It is one row underneath: drag either
   * copy and both move, because the drop writes the column's own field.
   */
  const byColumn = React.useMemo(() => {
    const map = new Map<ColumnId, Card[]>(ALL_COLUMNS.map((c) => [c, []]));
    for (const card of cards) {
      map.get(doerColumnFor(card.node))?.push(card);
      const ruling = initiatorColumnFor(card.node);
      if (ruling) map.get(ruling)?.push(card);
    }
    return map;
  }, [cards]);

  function drop(column: ColumnId) {
    setOver(null);
    const id = dragging;
    setDragging(null);
    if (!id || pending) return;
    // Nothing to write: the "Not scheduled" column is a fact about the row's
    // fields, not a status somebody can assign.
    if (column === UNSCHEDULED) {
      toast.error("Give the row an owner and a target date to schedule it.");
      return;
    }
    const card = cards.find((c) => c.node.id === id);
    if (!card) return;

    /**
     * A card under a standing ruling may move BETWEEN rulings, never back
     * into a doer column.
     *
     * Not a UI nicety — a working status written underneath a verdict is a
     * report nobody would ever see, because the verdict outranks it
     * everywhere it is displayed. The row's progress is still there
     * underneath; this refuses to pretend that writing it would show.
     */
    if (isWorkingStatus(column) && hasStandingVerdict(card.node.approvalStatus, false)) {
      toast.error(
        "A decision is standing on this row. Move it between the Initiator columns, or clear the decision first.",
      );
      return;
    }
    if (!isWorkingStatus(column) && !isRestrictedStatus(column)) {
      toast.error("That column isn't a status.");
      return;
    }

    setPending(true);
    void (async () => {
      try {
        // ONE action for both halves. A working status routes to the task
        // module's own setTaskStatus for an executable row, so IT MOVES ON THE
        // TASK BOARD TOO; a ruling writes `approval_status`. Both run the same
        // per-row permission check the table's picker runs — dragging a card
        // into Approved is refused for a doer exactly as the menu item is.
        const res = await setPlanNodeStatus({
          id: card.node.id,
          status: column,
          expectedUpdatedAt: card.node.task?.updatedAt,
        });
        if (!res.ok) toast.error(res.error);
      } finally {
        router.refresh();
        setPending(false);
      }
    })();
  }

  /**
   * One half of the board: its banner, then its own strip of columns.
   *
   * A plain function CALLED from the render, not a component declared inside
   * one — a nested component is a new type on every render, so React throws
   * its subtree's state away each time and the column scroll positions reset
   * mid-drag.
   */
  function renderHalf(side: "doer" | "initiator") {
    const columns = side === "doer" ? DOER_COLUMNS : INITIATOR_COLUMNS;
    const { tone } = PLAN_SIDE[side];
    return (
      <section key={side} className="shrink-0" aria-label={`${PLAN_SIDE[side].label} status`}>
        {/* The banner is the whole point of the split — without it two strips
            of columns are just a longer strip. */}
        <div
          className="mb-2 flex items-baseline gap-2 rounded-lg px-3 py-1.5"
          style={{
            background: `color-mix(in srgb, ${tone} 9%, transparent)`,
            borderLeft: `3px solid ${tone}`,
          }}
        >
          <span
            className="text-[12.5px] font-black uppercase tracking-[0.09em]"
            style={{ color: tone }}
          >
            {PLAN_SIDE[side].label} status
          </span>
          <span className="text-[11.5px]" style={{ color: "var(--color-ink-subtle)" }}>
            {side === "doer"
              ? "what the person doing it reports"
              : "the ruling on it, if one is standing"}
          </span>
        </div>

        <div className="flex items-stretch gap-4">
          {columns.map((column) => renderColumn(column, tone))}
        </div>
      </section>
    );
  }

  function renderColumn(column: ColumnId, sideTone: string) {
    const list = byColumn.get(column) ?? [];
    return (
      <div
        key={column}
        onDragOver={(e) => {
          e.preventDefault();
          setOver(column);
        }}
        onDragLeave={() => setOver((o) => (o === column ? null : o))}
        onDrop={() => drop(column)}
        className="w-[320px] max-sm:w-[85vw] shrink-0 rounded-section flex flex-col overflow-hidden"
        style={{
          background:
            over === column
              ? `color-mix(in srgb, ${PLAN_RED_SOFT} 26%, transparent)`
              : "color-mix(in srgb, var(--color-hairline) 40%, transparent)",
          // The side's colour on the resting border too, so a column
          // dragged past still says which half it is in.
          border: `1px solid ${
            over === column
              ? PLAN_RED
              : `color-mix(in srgb, ${sideTone} 28%, var(--color-hairline))`
          }`,
          maxHeight: "calc(100vh - 340px)",
        }}
      >
        <div
          className="flex items-center justify-between gap-2 px-3.5 pt-3 pb-2.5 shrink-0"
          style={{ borderBottom: "1px solid var(--color-hairline)" }}
        >
          <span
            className="text-[15.5px] font-bold"
            style={{ color: columnTone(column) }}
          >
            {columnLabel(column)}
          </span>
          <span
            className="ml-auto shrink-0 rounded-[8px] px-2 py-0.5 text-[13px] font-bold"
            style={{
              ...TABULAR,
              color: "var(--color-ink-subtle)",
              background: "color-mix(in srgb, var(--color-hairline) 55%, transparent)",
            }}
          >
            {list.length}
          </span>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3 grid gap-2.5 content-start">
          {list.length === 0 && (
            <p className="px-1 py-3 text-[12px]" style={{ color: "var(--color-ink-subtle)" }}>
              Nothing here.
            </p>
          )}
          {list.map((card) => (
            <KanbanCard
              // A row can be on the board twice — once per half — so the
              // column is part of the key. `node.id` alone collides.
              key={`${column}-${card.node.id}`}
              card={card}
              viewer={viewer}
              // Both copies dim together while either is dragged. They are one
              // row; showing one dragging and the other sitting still would be
              // a lie about what is moving.
              dragging={dragging === card.node.id}
              // The ruling chip belongs on the DOER half's copy, where the
              // column does not already say it. On the Initiator half the
              // column header IS the ruling, and the chip would be the same
              // word twice.
              showRuling={isWorkingStatus(column) || column === UNSCHEDULED}
              onDragStart={() => setDragging(card.node.id)}
              onDragEnd={() => setDragging(null)}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    // One provider for every card's hover card — Radix wants exactly one
    // above them, and the board is the only thing on the page that has them.
    <Tooltip.Provider delayDuration={260} skipDelayDuration={400}>
      <div className="overflow-x-auto pb-2">
        {/* The two halves side by side, with a wider gap than the one between
            columns — the gap IS the boundary. */}
        <div className="flex gap-7 min-w-max items-start">
          {renderHalf("doer")}
          {renderHalf("initiator")}
        </div>
      </div>
    </Tooltip.Provider>
  );
}

function KanbanCard({
  card,
  viewer,
  dragging,
  showRuling,
  onDragStart,
  onDragEnd,
}: {
  card: Card;
  viewer: PlanViewer;
  dragging: boolean;
  /** Name the standing ruling on this card — true on the Doer half only. */
  showRuling: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const n = card.node;
  const actor = actorForRow(viewer, {
    ownerId: n.ownerId,
    ancestorOwnerIds: card.ancestorOwnerIds,
    doerId: n.task?.doerId ?? null,
  });

  /**
   * The ruling standing on this row, if any.
   *
   * It no longer locks anything. That rule came from the board's first pass,
   * when a card had ONE home and a report written under a ruling would have
   * been invisible. Each half now shows its own axis, so both moves are
   * ordinary — the card is draggable in the Doer half to report progress and
   * in the Initiator half to change the ruling.
   */
  const ruling = hasStandingVerdict(n.approvalStatus, false)
    ? effectivePlanStatus(null, n.approvalStatus, false)
    : null;

  // No point offering a drag the server would refuse outright.
  const mayMove =
    canSetPlanStatus(actor, "initiated", n.kind).ok ||
    canSetPlanStatus(actor, "approved", n.kind).ok;

  const body = (
    <article
      draggable={mayMove}
      onDragStart={mayMove ? onDragStart : undefined}
      onDragEnd={onDragEnd}
      className="rounded-chip p-3 shadow-[0_4px_14px_-12px_rgba(15,23,42,0.5)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
      style={{
        background: "var(--color-surface-card)",
        border: "1px solid var(--color-hairline-strong)",
        opacity: dragging ? 0.45 : 1,
        cursor: mayMove ? "grab" : "default",
      }}
          title={
        ruling
          ? `${PLAN_STATUS_LABEL[ruling]} — drag in the Doer half to report progress, in the Initiator half to change the ruling.`
          : undefined
      }
    >
      <div className="flex items-start gap-1.5">
        <span
          className="shrink-0 rounded-[4px] px-1 text-[10.5px] font-bold"
          style={{
            ...TABULAR,
            color: PLAN_RED,
            background: `color-mix(in srgb, ${PLAN_RED_SOFT} 50%, transparent)`,
          }}
        >
          {KIND_LABEL[n.kind]}
        </span>
        {/* On the DOER half only: the ruling the initiator has standing on this
            row. The doer column says nothing about it, and "we are at Follow
            Up and it has already been Not Approved" is the single most useful
            thing this card can tell you. The Initiator half's copy leaves it
            off — there the column header is already the ruling. */}
        {showRuling && ruling && (
          <span
            className="ml-auto inline-flex shrink-0 items-center gap-1 rounded-pill px-1.5 text-[10.5px] font-bold"
            style={{
              color: PLAN_STATUS_TONE[ruling],
              background: `color-mix(in srgb, ${PLAN_STATUS_TONE[ruling]} 13%, transparent)`,
            }}
          >
            <Gavel size={8} strokeWidth={3} />
            {PLAN_STATUS_LABEL[ruling]}
          </span>
        )}
      </div>

      <p
        className="mt-1.5 line-clamp-2"
        style={{ ...levelStyleProps(n.kind), color: "var(--color-ink-strong)" }}
      >
        {n.name}
      </p>

      {card.path && (
        <p className="mt-1 truncate text-[11px]" style={{ color: "var(--color-ink-subtle)" }}>
          {card.path}
        </p>
      )}

      <div className="mt-2 flex items-center gap-2 text-[11.5px]" style={{ color: "var(--color-ink-subtle)" }}>
        {n.ownerName && <span className="truncate">{n.ownerName}</span>}
        {n.targetDate && <span style={TABULAR}>{formatPlanDate(n.targetDate)}</span>}
        {n.task && (
          <Link
            href={`/tasks/${n.task.id}` as Route}
            className="ml-auto inline-flex items-center gap-0.5 hover:underline shrink-0"
            style={{ color: PLAN_RED }}
            onClick={(e) => e.stopPropagation()}
          >
            {n.task.taskNo ? `#${n.task.taskNo}` : "Task"}
            <ExternalLink size={9} strokeWidth={2.6} />
          </Link>
        )}
      </div>
    </article>
  );

  /**
   * HOVER GIVES YOU THE WHOLE ROW.
   *
   * A card is deliberately small — a board is read by scanning columns, and a
   * card that prints a full description is a card you cannot scan past. So the
   * name clamps to two lines and the path truncates, and everything that got
   * cut lives one hover away: the full name, the whole path from the project
   * down, the description, both people, the dates.
   *
   * Portalled, and it does not open mid-drag — a popover following the cursor
   * while a card is in flight covers the column you are dragging to.
   */
  return (
    <Tooltip.Root delayDuration={260} open={dragging ? false : undefined}>
      <Tooltip.Trigger asChild>{body}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          side="right"
          align="start"
          sideOffset={8}
          collisionPadding={12}
          className="z-[100] rounded-xl p-4"
          style={{
            width: 340,
            maxWidth: "calc(100vw - 32px)",
            background: "var(--color-surface-card)",
            border: "1px solid var(--color-hairline-strong)",
            boxShadow: "0 24px 60px -16px rgba(15,23,42,0.40)",
          }}
        >
          <div className="flex items-center gap-1.5 flex-wrap">
            <span
              className="rounded-[4px] px-1 text-[10.5px] font-bold"
              style={{
                ...TABULAR,
                color: PLAN_RED,
                background: `color-mix(in srgb, ${PLAN_RED_SOFT} 50%, transparent)`,
              }}
            >
              {KIND_LABEL[n.kind]}
            </span>
            {ruling && (
              <span
                className="inline-flex items-center gap-1 rounded-pill px-1.5 text-[10.5px] font-bold"
                style={{
                  color: PLAN_STATUS_TONE[ruling],
                  background: `color-mix(in srgb, ${PLAN_STATUS_TONE[ruling]} 13%, transparent)`,
                }}
              >
                <Gavel size={8} strokeWidth={3} />
                {PLAN_STATUS_LABEL[ruling]}
              </span>
            )}
          </div>

          {/* The name IN FULL — no clamp. This is the line the card had to cut. */}
          <p
            className="mt-2"
            style={{ ...levelStyleProps(n.kind), color: "var(--color-ink-strong)" }}
          >
            {n.name}
          </p>

          {card.path && (
            <p className="mt-1.5 text-[11.5px]" style={{ color: "var(--color-ink-subtle)" }}>
              {card.path}
            </p>
          )}

          {n.description && (
            <p
              className="mt-2.5 text-[12.5px]"
              style={{ color: "var(--color-ink)", lineHeight: 1.5 }}
            >
              {n.description}
            </p>
          )}

          <div
            className="mt-3 grid gap-1 text-[12px]"
            style={{ color: "var(--color-ink-muted)" }}
          >
            <HoverLine label="Initiator" value={n.initiatorName} />
            <HoverLine label="Doer" value={n.task?.doerName ?? n.ownerName} />
            <HoverLine label="Target" value={formatPlanDate(n.targetDate) || null} />
            <HoverLine label="Start" value={formatPlanDate(n.startsAt) || null} />
            <HoverLine label="End" value={formatPlanDate(n.endsAt) || null} />
          </div>
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}

/** One label/value line in the hover card. Absent values are left out
 *  entirely rather than printed as a dash — a popover of dashes is noise. */
function HoverLine({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <span className="flex gap-2">
      <span className="w-[58px] shrink-0" style={{ color: "var(--color-ink-subtle)" }}>
        {label}
      </span>
      <span className="min-w-0 flex-1" style={{ color: "var(--color-ink)" }}>
        {value}
      </span>
    </span>
  );
}

/**
 * The row's column in the DOER half — what the person doing it last reported.
 *
 * Every row has one, ruling or no ruling: the report does not stop existing
 * because somebody ruled on it, and the whole reason `status` and
 * `approval_status` are separate database columns is that "approved" must not
 * erase the fact that the work was at Follow Up when the verdict landed.
 * "Not scheduled" is this half's own answer for a task-level row that has no
 * task yet — it is a fact about the row's fields, not a status.
 */
function doerColumnFor(node: PlanNode): ColumnId {
  if (hasTask(node.kind) && !node.task) return UNSCHEDULED;
  const status = isExecutable(node.kind) ? node.task?.status : node.status;
  if (status && isWorkingStatus(status)) return status;
  return "not_started";
}

/**
 * The row's column in the INITIATOR half, or null when nobody has ruled.
 *
 * Null rather than an "unruled" column: a board where every row without a
 * verdict piles into one lane is a lane that holds most of the plan and means
 * nothing. The initiator half shows the work that has actually been ruled on.
 */
function initiatorColumnFor(node: PlanNode): ColumnId | null {
  return node.approvalStatus && isRestrictedStatus(node.approvalStatus)
    ? node.approvalStatus
    : null;
}

function columnLabel(column: ColumnId): string {
  if (column === UNSCHEDULED) return "Not scheduled";
  return PLAN_STATUS_LABEL[column as keyof typeof PLAN_STATUS_LABEL] ?? column.replace(/_/g, " ");
}

function columnTone(column: ColumnId): string {
  if (column === UNSCHEDULED) return PLAN_RED;
  return (
    PLAN_STATUS_TONE[column as keyof typeof PLAN_STATUS_TONE] ?? "var(--color-ink-muted)"
  );
}
