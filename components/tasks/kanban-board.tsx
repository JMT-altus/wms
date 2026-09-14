"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import * as Tooltip from "@radix-ui/react-tooltip";
import { format } from "date-fns";
import {
  Loader2,
  Archive,
  Flag,
  Tag,
  Building2,
  CalendarDays,
  AlignLeft,
  User,
  Check,
  GripVertical,
  Inbox,
  Target,
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  useDraggable,
  closestCorners,
  type DragStartEvent,
  type DragEndEvent,
  type DragOverEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  horizontalListSortingStrategy,
  useSortable,
  sortableKeyboardCoordinates,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { PRIORITY_LABELS as PRIORITY_TEXT } from "@/db/enums";
import {
  PRIORITY_LABELS,
  type TaskStatus,
  type TaskPriority,
  type StatusColorToken,
  type ApprovalStatus,
} from "@/db/enums";
import {
  ARCHIVE_COL,
  UNASSIGNED_COL,
  goalColumn,
  normaliseBySide,
  sideOfColumn,
  splitBySide,
  type ColId,
} from "@/lib/kanban-columns";
import {
  setTaskStatus,
  setTaskApprovalStatus,
  archiveTask,
  unarchiveTask,
} from "@/app/(app)/tasks/actions";
import { setBoardColumnOrder } from "@/app/(admin)/admin/settings/actions";
import { fireToast } from "@/lib/toast";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";
import { LateBadge } from "@/components/ui/late-badge";
import { isDoneLate } from "@/lib/task-late";
import type { BoardTask } from "@/lib/queries/tasks";
import type { BoardGoal } from "@/lib/queries/weekly-goals";
import { istYmd } from "@/lib/weekly-goals/week";
import { useTaskSearch } from "@/components/tasks/task-search-context";

// Priority → colour token + label for the hover-card badge.
const PRIORITY_TONE: Record<TaskPriority, string> = {
  imp_urgent: "red",
  imp_not_urgent: "amber",
  not_imp_urgent: "orange",
  not_imp_not_urgent: "slate",
};

interface Props {
  tasks: BoardTask[];
  /** Weekly goals, rendered as cards beside the tasks. Their column comes
   *  from `pct_done` via `goalColumn` — goals have no status of their own. */
  goals: BoardGoal[];
  labels: Record<TaskStatus, string>;
  tones: Record<TaskStatus, StatusColorToken>;
  isAdmin: boolean;
  /** Today in IST (yyyy-mm-dd), stamped on the server. Overdue is decided
   *  against this rather than a live clock read, so the server and client
   *  renders agree and a card can't flip mid-hydration. */
  today: string;
  /** Ordered column ids to render (statuses + the synthetic Archive column).
   *  Admins can drag column headers to reorder; the new order is persisted. */
  columnOrder: ColId[];
}

// Cards rendered per column before "Show more"; each tap reveals 10 more.
const COL_STEP = 10;

/**
 * Per-column card order, remembered in the browser.
 *
 * The board query orders by `created_at` and there is no per-task board
 * position column, so without this the `router.refresh()` that follows every
 * drop re-sorts the destination column and the card the user just dragged to
 * the top snaps straight back down to its date slot. The map is
 * `columnId -> ordered task ids`; ids it doesn't mention keep the server's
 * order behind the ones it does.
 *
 * Deliberately client-side: this is one person's view of their own board, not
 * shared state, and a stale id in the map costs nothing (it just never matches).
 */
const CARD_ORDER_KEY = "altus.tasks.kanban.cardOrder.v1";
type CardOrder = Record<string, string[]>;

function readCardOrder(): CardOrder {
  try {
    const raw = localStorage.getItem(CARD_ORDER_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as CardOrder) : {};
  } catch {
    return {}; // malformed or storage unavailable (private mode)
  }
}

/** Sort a column's tasks by the remembered order; unlisted ids keep their
 *  server order at the back. Array.prototype.sort is stable, so equal ranks
 *  preserve the incoming sequence. */
function applyCardOrder<T extends { id: string }>(list: T[], saved?: string[]): T[] {
  if (!saved || saved.length === 0) return list;
  const rank = new Map(saved.map((id, i) => [id, i]));
  return [...list].sort(
    (a, b) =>
      (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
      (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER),
  );
}

/** Move `id` to `index` within `col`, dropping it from wherever it used to be
 *  so a card never appears in two columns' orders at once. */
function placeCard(
  order: CardOrder,
  col: string,
  id: string,
  index: number,
  columnIdsNow: string[],
): CardOrder {
  const next: CardOrder = {};
  for (const [key, ids] of Object.entries(order)) {
    const cleaned = ids.filter((x) => x !== id);
    if (cleaned.length > 0) next[key] = cleaned;
  }
  // Seed from what the column currently shows, so `index` means what the user
  // saw rather than an index into a list that only holds previously-moved ids.
  const existing = next[col] ?? [];
  const base = existing.length > 0 ? existing : columnIdsNow;
  const seeded = base.filter((x) => x !== id);
  const at = Math.max(0, Math.min(index, seeded.length));
  next[col] = [...seeded.slice(0, at), id, ...seeded.slice(at)];
  return next;
}

function accentFor(col: ColId, tones: Record<TaskStatus, StatusColorToken>) {
  const isArchive = col === ARCHIVE_COL;
  const tone = isArchive ? null : tones[col as TaskStatus];
  return {
    isArchive,
    accent: isArchive ? "#94a3b8" : `var(--color-${tone})`,
    accentDeep: isArchive ? "#64748b" : `var(--color-${tone}-deep)`,
    accentBgLight: isArchive ? "#f1f5f9" : `var(--color-${tone}-bg)`,
  };
}

/**
 * Status Kanban (Manan #25), rebuilt on dnd-kit for buttery pointer-based
 * drag: drag a card between columns to change its status (or into Archived to
 * archive / out to restore), and — as an admin — drag a column header to
 * reorder the whole board (persisted globally). A DragOverlay renders the
 * floating preview; dnd-kit handles auto-scroll, keyboard a11y and animation.
 */
/**
 * The two SIDES of the board, and the colour each banner wears.
 *
 * The same pair the Project Plan's board uses (`PLAN_SIDE` in
 * `components/plan/theme.ts`) — restated rather than imported, because the
 * task module does not otherwise depend on the plan module and one shared
 * colour is not worth the edge between them. If either moves, move both.
 */
const SIDE_TONE = { doer: "#0891B2", initiator: "#7C3AED" } as const;

export function KanbanBoard({
  tasks,
  goals,
  labels,
  tones,
  isAdmin,
  today,
  columnOrder,
}: Props) {
  const router = useRouter();
  const [items, setItems] = React.useState(tasks);
  const [savingId, setSavingId] = React.useState<string | null>(null);
  const [visibleByCol, setVisibleByCol] = React.useState<Record<string, number>>({});
  // Column order is local state so an admin's drag-reorder is instant.
  const [columns, setColumns] = React.useState<ColId[]>(columnOrder);
  // The active drag (card or column) — drives the DragOverlay + drop targeting.
  const [active, setActive] = React.useState<{
    id: string;
    type: "card" | "column";
    /** The task a dragged CARD stands for. Differs from `id`, which is that
     *  card's per-column drag identity — see `KanbanCard`'s `dndId`. */
    taskId?: string;
  } | null>(null);
  const [overCol, setOverCol] = React.useState<string | null>(null);
  // Remembered per-column card order (see CARD_ORDER_KEY). Starts empty so the
  // server render and the first client render agree, then hydrates on mount.
  const [cardOrder, setCardOrder] = React.useState<CardOrder>({});

  React.useEffect(() => setItems(tasks), [tasks]);
  React.useEffect(() => setColumns(columnOrder), [columnOrder]);
  React.useEffect(() => setCardOrder(readCardOrder()), []);

  function saveCardOrder(next: CardOrder) {
    setCardOrder(next);
    try {
      localStorage.setItem(CARD_ORDER_KEY, JSON.stringify(next));
    } catch {
      /* storage may be unavailable — the in-memory order still holds for the session */
    }
  }

  // An Undo fired from a toast runs long after the render that created it, so
  // it must not read `items` out of a stale closure — the row's optimistic-lock
  // token will have moved on. These refs always hold the live values.
  const itemsRef = React.useRef(items);
  itemsRef.current = items;
  const orderRef = React.useRef(cardOrder);
  orderRef.current = cardOrder;

  const sensors = useSensors(
    // Mouse: a 6px move starts a drag, so clicking a card's link still works.
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    // Touch: long-press to drag, so normal swipes still scroll the board.
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // The filter chips run server-side; the search box in the bar is the one
  // filter that runs here, over the cards already on the board — same deal as
  // the task list (see TaskSearchProvider). Null outside a provider, in which
  // case nothing is filtered.
  const search = useTaskSearch();
  const q = search?.query.trim().toLowerCase() ?? "";
  const filtered = React.useMemo(() => {
    if (!q) return items;
    return items.filter((t) =>
      [
        t.title,
        t.description,
        t.subject,
        t.client,
        t.doerName,
        t.taskNo != null ? `#${t.taskNo}` : null,
      ].some((v) => v != null && v.toLowerCase().includes(q)),
    );
  }, [items, q]);
  const visibleGoals = React.useMemo(() => {
    if (!q) return goals;
    return goals.filter((g) =>
      [g.targetDone, g.client, g.subject, g.employeeName].some(
        (v) => v != null && v.toLowerCase().includes(q),
      ),
    );
  }, [goals, q]);
  // Ownerless quick-dumped tasks live in their own pinned column (admins only),
  // never in a status lane. Employees' boards are self-scoped so never see them.
  const unassignedTasks = filtered.filter((t) => !t.archived && t.doerId == null);

  async function persistOrder(next: ColId[]) {
    const prev = columns;
    setColumns(next);
    const res = await setBoardColumnOrder(next as string[]);
    if (!res.ok) {
      setColumns(prev);
      fireToast({ message: res.error || "Couldn't save the column order." });
    }
  }

  /** A column's cards in the order they are actually rendered - server order
   *  with the remembered per-column order applied on top. The single source of
   *  truth for the render below and for every "which slot was it in?" lookup. */
  function columnTasks(col: ColId): BoardTask[] {
    /**
     * EACH HALF BUCKETS BY ITS OWN COLUMN.
     *
     * The Initiator half's lanes read `approval_status`; the Doer half's read
     * `status`. They used to both read `status`, which meant the Approved and
     * Not Approved lanes only ever caught tasks whose STATUS was literally the
     * legacy `approved` / `not_approved` string — so the initiator half sat
     * near-empty while every actually-ruled task hid in a doer lane.
     *
     * A ruled task is therefore on the board TWICE: once under what its doer
     * reports, once under the ruling. That is the point of two halves. It is
     * one task underneath — drag either copy and the drop writes whichever
     * field the destination lane speaks for.
     */
    const list =
      col === ARCHIVE_COL
        ? filtered.filter((t) => t.archived)
        : sideOfColumn(col) === "initiator"
          ? filtered.filter(
              (t) => !t.archived && t.approvalStatus === col && t.doerId != null,
            )
          : filtered.filter(
              (t) => !t.archived && t.status === col && t.doerId != null,
            );
    return applyCardOrder(list, cardOrder[col]);
  }

  /** A column's goal cards. Goals are never archived and can't be dragged
   *  between lanes, so this is a straight bucket by % done. */
  function columnGoals(col: ColId): BoardGoal[] {
    if (col === ARCHIVE_COL) return [];
    return visibleGoals.filter((g) => goalColumn(g.pctDone) === col);
  }

  /** Drop the card into `col` at `index`, and remember it there. */
  function rememberSlot(col: ColId, taskId: string, index: number, idsBefore: string[]) {
    saveCardOrder(placeCard(orderRef.current, col, taskId, index, idsBefore));
  }

  /**
   * How long the post-drop toast stays actionable. Ten seconds because Undo
   * here is a real "wrong column, put it back" affordance - long enough to
   * notice the card landed somewhere unintended and reach the button.
   */
  const UNDO_MS = 10_000;

  /** Put a card back exactly where it came from - same column AND same slot,
   *  neighbours included. Reads live state through the refs because the toast
   *  fires long after the render that created the handler. */
  async function undoDrop(
    taskId: string,
    back: { kind: "status"; status: TaskStatus } | { kind: "archive" } | { kind: "restore" },
    sourceCol: ColId,
    sourceIndex: number,
    sourceIdsBefore: string[],
  ) {
    const cur = itemsRef.current.find((t) => t.id === taskId);
    if (!cur) return;
    setSavingId(taskId);
    const res =
      back.kind === "status"
        ? await setTaskStatus(taskId, back.status, cur.updatedAt.toISOString())
        : back.kind === "archive"
          ? await archiveTask(taskId)
          : await unarchiveTask(taskId);
    setSavingId(null);
    if (!res.ok) {
      fireToast({ message: "Couldn't undo that move." });
      router.refresh();
      return;
    }
    const freshToken =
      "updatedAt" in res && typeof res.updatedAt === "string" ? res.updatedAt : null;
    setItems((list) =>
      list.map((t) =>
        t.id === taskId
          ? {
              ...t,
              ...(back.kind === "status" ? { status: back.status } : {}),
              ...(back.kind === "archive" ? { archived: true } : {}),
              ...(back.kind === "restore" ? { archived: false } : {}),
              ...(freshToken ? { updatedAt: new Date(freshToken) } : {}),
            }
          : t,
      ),
    );
    rememberSlot(sourceCol, taskId, sourceIndex, sourceIdsBefore);
    fireToast({ message: "Move undone." });
    router.refresh();
  }

  async function archiveCard(taskId: string) {
    const task = items.find((t) => t.id === taskId);
    if (!task || task.archived) return;
    const sourceCol = task.status as ColId;
    const sourceIds = columnTasks(sourceCol).map((t) => t.id);
    const sourceIndex = sourceIds.indexOf(taskId);
    const destIdsBefore = columnTasks(ARCHIVE_COL).map((t) => t.id);
    const prev = items;
    setItems((cur) => cur.map((t) => (t.id === taskId ? { ...t, archived: true } : t)));
    setSavingId(taskId);
    const res = await archiveTask(taskId);
    setSavingId(null);
    if (!res.ok) {
      setItems(prev);
      fireToast({ message: res.error || "Couldn't archive the task." });
    } else {
      rememberSlot(ARCHIVE_COL, taskId, 0, destIdsBefore);
      fireToast({
        message: "Archived.",
        actionLabel: "Undo",
        duration: UNDO_MS,
        action: () => undoDrop(taskId, { kind: "restore" }, sourceCol, sourceIndex, sourceIds),
      });
    }
    router.refresh();
  }

  async function restoreCard(taskId: string) {
    const task = items.find((t) => t.id === taskId);
    if (!task || !task.archived) return;
    const sourceIds = columnTasks(ARCHIVE_COL).map((t) => t.id);
    const sourceIndex = sourceIds.indexOf(taskId);
    const destCol = task.status as ColId;
    const destIdsBefore = columnTasks(destCol).map((t) => t.id);
    const prev = items;
    setItems((cur) => cur.map((t) => (t.id === taskId ? { ...t, archived: false } : t)));
    setSavingId(taskId);
    const res = await unarchiveTask(taskId);
    setSavingId(null);
    if (!res.ok) {
      setItems(prev);
      fireToast({ message: res.error || "Couldn't restore the task." });
    } else {
      rememberSlot(destCol, taskId, 0, destIdsBefore);
      fireToast({
        message: "Restored.",
        actionLabel: "Undo",
        duration: UNDO_MS,
        action: () => undoDrop(taskId, { kind: "archive" }, ARCHIVE_COL, sourceIndex, sourceIds),
      });
    }
    router.refresh();
  }

  /**
   * File the initiator's ruling — the Initiator half's equivalent of `moveTo`.
   *
   * Admin-only at the server (`setTaskApprovalStatus` refuses anyone else), so
   * this reports the refusal rather than pre-empting it: the board has no
   * business deciding who may rule, and a card that silently will not drop is
   * worse than one that drops and says why not.
   *
   * No undo slot. `moveTo` remembers one because a status move is a routine
   * correction people make dozens of times an hour; a verdict is a deliberate
   * act with its own audit row, and the way back is to rule again.
   */
  async function ruleOn(taskId: string, approvalStatus: ApprovalStatus) {
    const task = items.find((t) => t.id === taskId);
    if (!task || task.approvalStatus === approvalStatus) return;
    const prev = items;
    setItems((cur) =>
      cur.map((t) => (t.id === taskId ? { ...t, approvalStatus } : t)),
    );
    setSavingId(taskId);
    const res = await setTaskApprovalStatus(taskId, { approvalStatus });
    setSavingId(null);
    if (!res.ok) {
      setItems(prev);
      fireToast({
        message:
          res.error === "forbidden"
            ? "Only an admin can rule on a task."
            : (res.message ?? "Couldn't set the ruling."),
      });
      return;
    }
    router.refresh();
  }

  async function moveTo(taskId: string, status: TaskStatus) {
    const task = items.find((t) => t.id === taskId);
    if (!task || task.status === status) return;
    // Capture the exact origin BEFORE the optimistic mutation - this is what
    // Undo restores: same column, same slot, neighbours included.
    const sourceCol = task.status as ColId;
    const sourceIds = columnTasks(sourceCol).map((t) => t.id);
    const sourceIndex = sourceIds.indexOf(taskId);
    const destIdsBefore = columnTasks(status as ColId).map((t) => t.id);
    const prevStatus = task.status;
    const prev = items;
    setItems((cur) => cur.map((t) => (t.id === taskId ? { ...t, status } : t)));
    setSavingId(taskId);
    const res = await setTaskStatus(taskId, status, task.updatedAt.toISOString());
    setSavingId(null);
    if (!res.ok) {
      setItems(prev);
      fireToast({
        message:
          res.error === "forbidden"
            ? "You can't move this task to that status."
            : res.error === "invalid"
              ? res.message ?? "That move isn't allowed from here."
              : res.error === "stale"
                ? "Someone else changed this first - refreshing."
                : "Couldn't update the task.",
      });
    } else {
      // Land it at the TOP of the destination and remember that, so the
      // refresh below cannot re-sort it back down to its created_at slot.
      rememberSlot(status as ColId, taskId, 0, destIdsBefore);
      // Carry the new optimistic-lock token forward, or an immediate Undo is
      // rejected as stale for shipping the pre-move value.
      setItems((cur) =>
        cur.map((t) => (t.id === taskId ? { ...t, updatedAt: new Date(res.updatedAt) } : t)),
      );
      fireToast({
        message: `Moved to ${labels[status]}.`,
        actionLabel: "Undo",
        duration: UNDO_MS,
        action: () =>
          undoDrop(
            taskId,
            { kind: "status", status: prevStatus },
            sourceCol,
            sourceIndex,
            sourceIds,
          ),
      });
    }
    router.refresh();
  }

  function onDragStart(e: DragStartEvent) {
    const type = (e.active.data.current?.type as "card" | "column") ?? "card";
    // For a card, `id` is the per-column drag identity and `taskId` is the row
    // it stands for — the two differ because a ruled task renders in both
    // halves. For a column the id IS the column.
    const taskId = e.active.data.current?.taskId as string | undefined;
    setActive({ id: String(e.active.id), type, taskId });
  }

  function onDragOver(e: DragOverEvent) {
    setOverCol(e.over ? String(e.over.id) : null);
  }

  function onDragEnd(e: DragEndEvent) {
    const a = active;
    setActive(null);
    setOverCol(null);
    const { over } = e;
    if (!over || !a) return;
    const overId = String(over.id);

    if (a.type === "column") {
      if (!isAdmin || overId === a.id) return;
      // A column cannot change sides. Doer Status and Initiator Status write
      // two different database columns, so "move Approved into the doer half"
      // is not an arrangement — it is a category error, and the halves are
      // separate sortable contexts precisely so it is never offered.
      if (sideOfColumn(a.id as ColId) !== sideOfColumn(overId as ColId)) return;
      const from = columns.indexOf(a.id as ColId);
      const to = columns.indexOf(overId as ColId);
      if (from < 0 || to < 0) return;
      void persistOrder(normaliseBySide(arrayMove(columns, from, to)));
      return;
    }

    // Card drop — `over` resolves to a column droppable.
    const card = items.find((t) => t.id === (a.taskId ?? a.id));
    if (!card) return;
    if (overId === ARCHIVE_COL) {
      if (!card.archived) void archiveCard(card.id);
      return;
    }
    // Dropping an archived card restores it (keeps status).
    if (card.archived) {
      void restoreCard(card.id);
      return;
    }
    // An Initiator lane writes the RULING; a Doer lane writes the status. The
    // destination decides, so it does not matter which of a ruled task's two
    // cards was the one picked up.
    if (sideOfColumn(overId as ColId) === "initiator") {
      void ruleOn(card.id, overId as ApprovalStatus);
      return;
    }
    void moveTo(card.id, overId as TaskStatus);
  }


  /**
   * One HALF of the board — the doer's columns or the initiator's.
   *
   * Its own banner and its own `SortableContext`, so a column can be dragged
   * within its side and never across to the other. Both halves live inside the
   * one horizontal scroller, because they are one board: a card dragged from
   * Follow Up to Approved crosses the boundary in a single gesture, and two
   * separately-scrolling panes would make that the hardest move on the screen
   * instead of the most ordinary one.
   *
   * A plain function called from the render rather than a component declared
   * inside one — a nested component is a new type every render, and React
   * would throw the whole half's drag state away mid-drag.
   */
  function renderSide(side: "doer" | "initiator") {
    const cols = splitBySide(columns)[side];
    if (cols.length === 0) return null;
    const tone = side === "doer" ? SIDE_TONE.doer : SIDE_TONE.initiator;
    return (
      <section
        key={side}
        // The extra left margin on the second half is the boundary — without
        // it the two banners sit one column-gap apart and read as one strip.
        className={`flex shrink-0 flex-col${side === "initiator" ? " ml-4" : ""}`}
        aria-label={`${side === "doer" ? "Doer" : "Initiator"} status`}
      >
        <div
          className="mb-2 flex items-baseline gap-2 rounded-lg px-3 py-1.5"
          style={{
            background: `color-mix(in srgb, ${tone} 9%, transparent)`,
            borderLeft: `3px solid ${tone}`,
          }}
        >
          <span
            className="text-[11.5px] font-black uppercase tracking-[0.09em]"
            style={{ color: tone }}
          >
            {side === "doer" ? "Doer status" : "Initiator status"}
          </span>
          <span className="text-[10.5px] text-ink-subtle">
            {side === "doer"
              ? "what the person doing it reports"
              : "the ruling on it, and the way off the board"}
          </span>
        </div>

        <div className="flex flex-1 items-stretch gap-4 min-h-0">
          <SortableContext items={cols} strategy={horizontalListSortingStrategy}>
            {cols.map((col) => {
                const { isArchive, accent, accentDeep, accentBgLight } = accentFor(col, tones);
                const colTasks = columnTasks(col);
                const colGoals = columnGoals(col);
                const limit = visibleByCol[col] ?? COL_STEP;
                const shownTasks = colTasks.slice(0, limit);
                const hiddenCount = colTasks.length - shownTasks.length;
                const label = isArchive ? "Archived" : labels[col as TaskStatus];
                const isCardOver = active?.type === "card" && overCol === col;
                return (
                  <KanbanColumn
                    key={col}
                    col={col}
                    isAdmin={isAdmin}
                    isArchive={isArchive}
                    label={label}
                    count={colTasks.length + colGoals.length}
                    accent={accent}
                    accentDeep={accentDeep}
                    accentBgLight={accentBgLight}
                    isCardOver={isCardOver}
                  >
                    {isArchive && colTasks.length === 0 && (
                      <p className="px-2 py-6 text-center text-[14px] font-semibold leading-relaxed text-ink-subtle">
                        Drag a card here to archive it.
                      </p>
                    )}
                    {!isArchive && colTasks.length === 0 && colGoals.length === 0 && (
                      <p className="px-2 py-6 text-center text-[13.5px] text-ink-subtle">
                        Nothing here.
                      </p>
                    )}
                    {/* Goals lead the column: a week's goal is the commitment
                        the tasks under it serve. */}
                    {colGoals.map((g) => (
                      <GoalCard key={g.id} g={g} />
                    ))}
                    {shownTasks.map((t) => (
                      <KanbanCard
                        key={t.id}
                        dndId={`${col}::${t.id}`}
                        t={t}
                        labels={labels}
                        tones={tones}
                        accent={accent}
                        today={today}
                        saving={savingId === t.id}
                      />
                    ))}
                    {hiddenCount > 0 && (
                      <button
                        type="button"
                        onClick={() =>
                          setVisibleByCol((m) => ({ ...m, [col]: limit + COL_STEP }))
                        }
                        className="mt-1 w-full rounded-chip py-2.5 text-[14px] font-bold transition-colors text-ink-soft hover:bg-surface-card"
                        style={{ border: "1px dashed var(--color-hairline-strong)" }}
                      >
                        Show {Math.min(COL_STEP, hiddenCount)} more ({hiddenCount} hidden)
                      </button>
                    )}
                  </KanbanColumn>
                );
              })}
          </SortableContext>
        </div>
      </section>
    );
  }

  const activeCard =
    active?.type === "card"
      ? (items.find((t) => t.id === (active.taskId ?? active.id)) ?? null)
      : null;

  return (
    <Tooltip.Provider delayDuration={180} skipDelayDuration={400}>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={() => {
          setActive(null);
          setOverCol(null);
        }}
      >
        <div>
          {/* No running total here — every column carries its own count badge,
              which is the number you actually want when scanning the board. */}
          <div
            className="kanban-scroll flex items-stretch gap-4 overflow-x-auto overflow-y-hidden pb-3 max-sm:snap-x max-sm:snap-mandatory"
            style={{ height: "calc(100dvh - 300px)", minHeight: 460 }}
          >
            {/* Unassigned pool — pinned first, admins only, not reorderable and
                not a drop target (you assign by opening the card). */}
            {isAdmin && (
              <UnassignedColumn
                tasks={unassignedTasks}
                labels={labels}
                tones={tones}
                today={today}
              />
            )}
            {renderSide("doer")}
            {renderSide("initiator")}
          </div>
        </div>

        {/* Floating drag preview. */}
        <DragOverlay dropAnimation={{ duration: 200, easing: "cubic-bezier(0.2,0.7,0.3,1)" }}>
          {activeCard ? (
            <div className="w-[300px] rotate-2 cursor-grabbing rounded-chip border border-altus-red/40 bg-white p-3.5 shadow-2xl">
              <span
                className="block text-[15.5px] font-semibold text-ink-strong leading-snug"
                style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}
              >
                {activeCard.description || activeCard.title}
              </span>
              <div className="mt-2.5 flex items-center gap-2 text-[13px] text-ink-subtle">
                {activeCard.taskNo != null && <span className="font-bold tabular-nums">#{activeCard.taskNo}</span>}
                {activeCard.doerName && <span>· {activeCard.doerName}</span>}
              </div>
            </div>
          ) : active?.type === "column" ? (
            <div className="rounded-section border border-hairline-strong bg-surface-soft px-4 py-3 shadow-2xl">
              <span className="text-[15.5px] font-bold text-ink-strong">
                {active.id === ARCHIVE_COL ? "Archived" : labels[active.id as TaskStatus]}
              </span>
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>
    </Tooltip.Provider>
  );
}

// ── Column (sortable for admin reorder + drop target for cards) ─────────────
function KanbanColumn({
  col,
  isAdmin,
  isArchive,
  label,
  count,
  accent,
  accentDeep,
  accentBgLight,
  isCardOver,
  children,
}: {
  col: ColId;
  isAdmin: boolean;
  isArchive: boolean;
  label: string;
  count: number;
  accent: string;
  accentDeep: string;
  accentBgLight: string;
  isCardOver: boolean;
  children: React.ReactNode;
}) {
  // Disable only the column DRAG for non-admins — the column must stay a drop
  // target so anyone can still drag cards between columns.
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({
    id: col,
    disabled: { draggable: !isAdmin, droppable: false },
    data: { type: "column" },
  });

  return (
    <div
      ref={setNodeRef}
      className="flex-shrink-0 w-[320px] max-sm:w-[85vw] max-sm:snap-center flex flex-col h-full overflow-hidden rounded-section transition-colors"
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        // Flat white column with the status colour as a top rule and nothing
        // else — the cards are what should carry the eye, not the lane.
        background: isCardOver ? accentBgLight : "#ffffff",
        border: `1px solid ${isCardOver ? accent : "var(--color-hairline)"}`,
        borderTop: `3px solid ${accent}`,
        opacity: isDragging ? 0.5 : 1,
        boxShadow: "0 18px 40px -32px rgba(15, 23, 42, 0.55), 0 1px 3px rgba(15, 23, 42, 0.04)",
        touchAction: "manipulation",
      }}
    >
      {/* Column header — fixed while the cards below it scroll; the grip is
          the admin reorder handle. */}
      <div className="flex shrink-0 items-center gap-2 px-3.5 pt-3 pb-2.5">
        {isAdmin && (
          <button
            type="button"
            {...attributes}
            {...listeners}
            aria-label={`Reorder ${label} column`}
            className="shrink-0 cursor-grab active:cursor-grabbing text-ink-subtle/70 hover:text-ink-strong touch-none"
          >
            <GripVertical size={15} strokeWidth={2.2} aria-hidden />
          </button>
        )}
        <span
          className="inline-flex items-center gap-2 min-w-0 text-[15.5px] font-bold"
          style={{ color: accentDeep }}
        >
          {isArchive ? (
            <Archive size={16} strokeWidth={2.4} style={{ color: accent }} />
          ) : (
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: accent }} />
          )}
          <span className="truncate">{label}</span>
        </span>
        <span
          className="ml-auto shrink-0 rounded-[8px] px-2 py-0.5 text-[13px] font-bold tabular-nums"
          style={{
            color: accentDeep,
            background: `color-mix(in srgb, ${accent} 14%, #ffffff)`,
          }}
        >
          {count}
        </span>
      </div>

      {/* Each column scrolls on its own, so a long lane never drags the whole
          board down with it and the headers stay in view. */}
      <div className="kanban-scroll flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 pb-3">
        {children}
      </div>
    </div>
  );
}

// ── Unassigned pool column (static, admin-only) ─────────────────────────────
function UnassignedColumn({
  tasks,
  labels,
  tones,
  today,
}: {
  tasks: BoardTask[];
  labels: Record<TaskStatus, string>;
  tones: Record<TaskStatus, StatusColorToken>;
  today: string;
}) {
  const accent = "var(--color-amber)";
  const accentDeep = "var(--color-amber-deep)";
  return (
    <div
      className="flex-shrink-0 w-[320px] max-sm:w-[85vw] max-sm:snap-center flex flex-col h-full overflow-hidden rounded-section"
      style={{
        background: "#ffffff",
        border: "1px solid var(--color-hairline)",
        borderTop: `3px solid ${accent}`,
        boxShadow: "0 18px 40px -32px rgba(15, 23, 42, 0.55), 0 1px 3px rgba(15, 23, 42, 0.04)",
      }}
    >
      <div className="flex shrink-0 items-center gap-2 px-3.5 pt-3 pb-2.5">
        <span
          className="inline-flex items-center gap-2 min-w-0 text-[15.5px] font-bold"
          style={{ color: accentDeep }}
        >
          <Inbox size={16} strokeWidth={2.4} style={{ color: accent }} />
          <span className="truncate">Unassigned</span>
        </span>
        <span
          className="ml-auto shrink-0 rounded-[8px] px-2 py-0.5 text-[13px] font-bold tabular-nums"
          style={{ color: accentDeep, background: `color-mix(in srgb, ${accent} 14%, #ffffff)` }}
        >
          {tasks.length}
        </span>
      </div>

      <div className="kanban-scroll flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 pb-3">
        {tasks.length === 0 ? (
          <p className="px-2 py-6 text-center text-[13.5px] text-ink-subtle">
            No unassigned tasks. Quick-dumped tasks land here.
          </p>
        ) : (
          <>
            <p className="px-1 pb-1 text-[12.5px] text-ink-subtle">
              Open a card to assign it to someone.
            </p>
            {tasks.map((t) => (
              <KanbanCard
                key={t.id}
                // The pool is its own lane and a task is only ever in it once,
                // but the id still has to be distinct from the status lanes'.
                dndId={`${UNASSIGNED_COL}::${t.id}`}
                t={t}
                labels={labels}
                tones={tones}
                accent={accent}
                today={today}
                saving={false}
                draggable={false}
                openComplete
              />
            ))}
          </>
        )}
      </div>
    </div>
  );
}

// ── Card (draggable) ─────────────────────────────────────────────────────────
function KanbanCard({
  dndId,
  t,
  labels,
  tones,
  accent,
  today,
  saving,
  draggable = true,
  openComplete = false,
}: {
  /** This CARD's drag identity — the column and the task, so a task rendered
   *  in both halves registers two distinct draggables. */
  dndId: string;
  t: BoardTask;
  labels: Record<TaskStatus, string>;
  tones: Record<TaskStatus, StatusColorToken>;
  /** The column's status colour, worn as the card's left edge so a card that
   *  has been dragged reads as belonging to its new lane at a glance. */
  accent: string;
  /** Today in IST (yyyy-mm-dd) — see KanbanBoard's prop of the same name. */
  today: string;
  saving: boolean;
  /** Ownerless pool cards aren't draggable (there's no status lane to move an
   *  unassigned task to) — they only open the task so you can assign it. */
  draggable?: boolean;
  /** Pool cards open the "Complete task" panel instead of the detail page. */
  openComplete?: boolean;
}) {
  const router = useRouter();
  const target = openComplete ? `/tasks/kanban?complete=${t.id}` : `/tasks/${t.id}`;
  /**
   * `dndId`, not `t.id`.
   *
   * A ruled task is on the board TWICE — once under what its doer reports,
   * once under the ruling — and dnd-kit keys its registry by draggable id. Two
   * nodes claiming one id means the second silently overwrites the first, so
   * one of the two cards becomes undraggable. The column is folded into the id
   * to keep them apart; the task itself travels in `data`.
   */
  const { setNodeRef, attributes, listeners, isDragging } = useDraggable({
    id: dndId,
    data: { type: "card", taskId: t.id },
  });
  // Distinguish a click (open the task) from a drag (move it). dnd-kit's 6px
  // activation means a real click barely moves; compare pointer down→up.
  const downAt = React.useRef<{ x: number; y: number } | null>(null);
  const dragProps = draggable ? { ...attributes, ...listeners } : {};

  return (
    <div
      ref={draggable ? setNodeRef : undefined}
      {...dragProps}
      onPointerDownCapture={(e) => {
        downAt.current = { x: e.clientX, y: e.clientY };
      }}
      onClick={(e) => {
        const s = downAt.current;
        if (s && Math.hypot(e.clientX - s.x, e.clientY - s.y) < 6) {
          router.push(target as Route);
        }
      }}
      className="cursor-pointer"
      style={{ opacity: isDragging ? 0.4 : 1 }}
    >
      <Tooltip.Root delayDuration={220}>
        <Tooltip.Trigger asChild>
          <div
            className="group rounded-chip border border-hairline bg-white p-3 shadow-[0_4px_14px_-12px_rgba(15,23,42,0.5)] transition-all duration-200 hover:-translate-y-0.5 hover:border-altus-red/40 hover:shadow-lg"
            style={{ borderLeft: `3px solid ${accent}` }}
          >
            <div className="flex items-start justify-between gap-2">
              <Link
                href={target as Route}
                draggable={false}
                onClick={(e) => e.stopPropagation()}
                className="text-[15px] font-semibold text-ink-strong leading-snug hover:underline"
                style={{
                  display: "-webkit-box",
                  WebkitLineClamp: 3,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
              >
                {t.description || t.title}
              </Link>
              {saving && (
                <Loader2 size={14} className="animate-spin text-ink-subtle shrink-0 mt-0.5" />
              )}
            </div>

            {/* Number + priority, then the date on its own line — the two
                things you triage by, in the order you read them. */}
            <div className="mt-2 flex items-center gap-1.5 flex-wrap">
              {t.taskNo != null && (
                <span className="rounded-[7px] bg-[#f4f5f7] px-1.5 py-[3px] text-[11.5px] font-bold tabular-nums text-ink-soft">
                  #{t.taskNo}
                </span>
              )}
              <PriorityChip priority={t.priority} />
              {isDoneLate({ status: t.status, completedAt: t.completedAt, dueAt: t.dueAt }) && (
                <LateBadge />
              )}
            </div>
            <div className="mt-1.5">
              <DueChip dueAt={t.dueAt} status={t.status} today={today} />
            </div>

            <div className="mt-2.5 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink-soft">
                {[t.client, t.subject].filter(Boolean).join(" · ")}
              </span>
              {t.doerName && (
                <span className="flex shrink-0 items-center gap-1.5">
                  <EmployeeAvatar name={t.doerName} size="sm" className="!h-7 !w-7 !text-[11px]" />
                  <span className="text-[12.5px] font-semibold text-ink-soft">
                    {t.doerName.split(/\s+/)[0]}
                  </span>
                </span>
              )}
            </div>
          </div>
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Content
            side="right"
            align="start"
            sideOffset={12}
            collisionPadding={16}
            className="kanban-hovercard z-[80]"
          >
            <TaskHoverCard t={t} labels={labels} tones={tones} />
            <Tooltip.Arrow width={14} height={7} style={{ fill: "var(--color-surface-card)" }} />
          </Tooltip.Content>
        </Tooltip.Portal>
      </Tooltip.Root>
    </div>
  );
}

// ── Card parts ────────────────────────────────────────────────────────────

/** Flag + label in the priority's own colour. Normal stays grey — most tasks
 *  are Normal, and a coloured chip on every card would say nothing. */
function PriorityChip({ priority }: { priority: TaskPriority }) {
  const tone = PRIORITY_TONE[priority];
  const neutral = tone === "slate";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-[7px] px-1.5 py-[3px] text-[11.5px] font-bold whitespace-nowrap"
      style={{
        color: neutral ? "var(--color-ink-soft)" : `var(--color-${tone}-deep)`,
        border: `1px solid ${
          neutral ? "var(--color-hairline-strong)" : `color-mix(in srgb, var(--color-${tone}) 35%, transparent)`
        }`,
        background: neutral ? "#ffffff" : `color-mix(in srgb, var(--color-${tone}) 10%, #ffffff)`,
      }}
    >
      <Flag size={11} strokeWidth={2.4} aria-hidden />
      {PRIORITY_TEXT[priority]}
    </span>
  );
}

/** The due date, red once it's past and the task still isn't done. The word
 *  "overdue" carries the meaning for anyone who can't read the colour. */
function DueChip({
  dueAt,
  status,
  today,
}: {
  dueAt: Date;
  status: TaskStatus;
  today: string;
}) {
  const due = dueAt instanceof Date ? dueAt : new Date(dueAt);
  // Day granularity, against the server's stamp: a task due today is not late.
  const overdue = status !== "done" && istYmd(due) < today;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-[7px] px-1.5 py-[3px] text-[11.5px] font-bold whitespace-nowrap"
      style={{
        color: overdue ? "var(--color-red-deep)" : "var(--color-ink-soft)",
        border: `1px solid ${
          overdue ? "color-mix(in srgb, var(--color-red) 35%, transparent)" : "var(--color-hairline-strong)"
        }`,
        background: overdue ? "color-mix(in srgb, var(--color-red) 10%, #ffffff)" : "#ffffff",
      }}
    >
      <CalendarDays size={11} strokeWidth={2.4} aria-hidden />
      {format(due, "dd MMM yyyy")}
      {overdue && " · overdue"}
    </span>
  );
}

/**
 * A weekly goal on the board. It looks deliberately unlike a task card — red
 * edge, WEEKLY GOAL tag, a % bar instead of a due date — because it can't be
 * dragged: a goal's lane is computed from its % done, so moving it by hand
 * would be a lie. Clicking opens that person's week in the planner, which is
 * where the % is actually edited.
 */
function GoalCard({ g }: { g: BoardGoal }) {
  const pct = Math.max(0, Math.min(100, g.pctDone));
  return (
    <Link
      href={`/weekly-goals?week=${g.weekStart}&emp=${g.employeeId}` as Route}
      className="block rounded-chip border border-hairline bg-white p-3 shadow-[0_4px_14px_-12px_rgba(15,23,42,0.5)] transition-all duration-200 hover:-translate-y-0.5 hover:border-altus-red/40 hover:shadow-lg"
      style={{ borderLeft: "3px solid var(--color-altus-red)" }}
    >
      <div className="flex items-center justify-between gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-[7px] px-1.5 py-[3px] text-[10.5px] font-bold uppercase whitespace-nowrap"
          style={{
            letterSpacing: "0.06em",
            color: "var(--color-altus-red)",
            border: "1px solid color-mix(in srgb, var(--color-altus-red) 30%, transparent)",
            background: "color-mix(in srgb, var(--color-altus-red) 8%, #ffffff)",
          }}
        >
          <Target size={11} strokeWidth={2.6} aria-hidden />
          Weekly Goal
        </span>
        <span className="text-[12.5px] font-bold tabular-nums text-ink-soft">{pct}%</span>
      </div>

      <p
        className="mt-2 text-[15px] font-semibold leading-snug text-ink-strong"
        style={{
          display: "-webkit-box",
          WebkitLineClamp: 3,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {g.targetDone || "Untitled goal"}
      </p>
      <p className="mt-1.5 text-[12.5px] font-medium text-ink-soft">
        {[g.employeeName, g.client, g.subject].filter(Boolean).join(" · ")}
      </p>

      <div
        className="mt-2.5 h-1.5 w-full overflow-hidden rounded-pill"
        style={{ background: "#eef0f3" }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${pct}% done`}
      >
        <span
          className="block h-full rounded-pill transition-[width] duration-300"
          style={{
            width: `${pct}%`,
            background:
              pct >= 100 ? "var(--color-success, #16a34a)" : "var(--color-altus-red)",
          }}
        />
      </div>
    </Link>
  );
}

// ── Hover preview ─────────────────────────────────────────────────────────
function Pill({
  tone,
  icon,
  children,
}: {
  tone: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[12.5px] font-bold whitespace-nowrap"
      style={{
        color: `var(--color-${tone}-deep)`,
        background: `color-mix(in srgb, var(--color-${tone}) 14%, transparent)`,
        border: `1px solid color-mix(in srgb, var(--color-${tone}) 30%, transparent)`,
      }}
    >
      {icon}
      {children}
    </span>
  );
}

function FieldHead({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div
      className="flex items-center gap-1.5 text-ink-subtle"
      style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}
    >
      {icon}
      {children}
    </div>
  );
}

function Meta({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | null;
}) {
  return (
    <div className="min-w-0">
      <FieldHead icon={icon}>{label}</FieldHead>
      <div className="mt-1 truncate text-ink-strong" style={{ fontSize: 14.5, fontWeight: 600 }}>
        {value && value.trim() ? value : "—"}
      </div>
    </div>
  );
}

function TaskHoverCard({
  t,
  labels,
  tones,
}: {
  t: BoardTask;
  labels: Record<TaskStatus, string>;
  tones: Record<TaskStatus, StatusColorToken>;
}) {
  const statusTone = tones[t.status] ?? "blue";
  const prioTone = PRIORITY_TONE[t.priority] ?? "slate";
  const desc = t.description?.trim();
  const DELAY = ["40ms", "95ms", "150ms", "205ms", "260ms"] as const;

  return (
    <div
      className="relative overflow-hidden rounded-2xl bg-surface-card"
      style={{
        width: 384,
        maxWidth: "calc(100vw - 32px)",
        border: "1px solid var(--color-hairline-strong)",
        boxShadow: "0 24px 60px -16px rgba(15,23,42,0.40), 0 4px 12px rgba(15,23,42,0.12)",
      }}
    >
      <span
        aria-hidden
        className="hc-accent absolute inset-x-0 top-0 h-1"
        style={{
          background: `linear-gradient(90deg, var(--color-${statusTone}), var(--color-${statusTone}-deep))`,
        }}
      />

      <div className="p-5 pt-6">
        <div className="hc-item flex items-center gap-2 flex-wrap" style={{ animationDelay: DELAY[0] }}>
          <Pill
            tone={statusTone}
            icon={<span className="h-2 w-2 rounded-full" style={{ background: `var(--color-${statusTone})` }} />}
          >
            {labels[t.status]}
          </Pill>
          <Pill tone={prioTone} icon={<Flag size={12} strokeWidth={2.6} />}>
            {PRIORITY_LABELS[t.priority]}
          </Pill>
          {t.archived && (
            <Pill tone="slate" icon={<Archive size={12} strokeWidth={2.4} />}>
              Archived
            </Pill>
          )}
        </div>

        <h3
          className="hc-item mt-3.5 text-ink-strong"
          style={{ animationDelay: DELAY[1], fontSize: 17, fontWeight: 800, lineHeight: 1.3, letterSpacing: "-0.01em" }}
        >
          {t.taskNo != null && <span className="text-ink-subtle tabular-nums">#{t.taskNo} · </span>}
          {t.title}
        </h3>

        <div className="hc-item mt-3" style={{ animationDelay: DELAY[2] }}>
          <FieldHead icon={<AlignLeft size={14} strokeWidth={2.2} />}>Description</FieldHead>
          {desc ? (
            <p
              className="mt-1.5 whitespace-pre-wrap text-ink-soft"
              style={{ fontSize: 14.5, lineHeight: 1.6, maxHeight: 208, overflowY: "auto" }}
            >
              {desc}
            </p>
          ) : (
            <p className="mt-1.5 italic text-ink-subtle" style={{ fontSize: 14 }}>
              No description added.
            </p>
          )}
        </div>

        <div className="hc-item my-4 h-px bg-hairline" style={{ animationDelay: DELAY[3] }} />

        <div className="hc-item grid grid-cols-2 gap-x-4 gap-y-4" style={{ animationDelay: DELAY[4] }}>
          <Meta icon={<Building2 size={14} strokeWidth={2.2} />} label="Client" value={t.client} />
          <Meta icon={<Tag size={14} strokeWidth={2.2} />} label="Subject" value={t.subject} />
          <Meta
            icon={<CalendarDays size={14} strokeWidth={2.2} />}
            label="Due"
            value={t.dueAt ? format(t.dueAt, "MMM d, yyyy") : null}
          />
          <div className="min-w-0">
            <FieldHead icon={<User size={14} strokeWidth={2.2} />}>Doer</FieldHead>
            <div className="mt-1 flex items-center gap-2 min-w-0">
              {t.doerName ? (
                <>
                  <EmployeeAvatar name={t.doerName} size="sm" />
                  <span className="truncate text-ink-strong" style={{ fontSize: 14.5, fontWeight: 600 }}>
                    {t.doerName}
                  </span>
                </>
              ) : (
                <span className="text-ink-subtle" style={{ fontSize: 14.5 }}>
                  Unassigned
                </span>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
