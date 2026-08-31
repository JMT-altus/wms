"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Eye,
  Trophy,
  Sparkles,
  CheckCircle2,
  ChevronDown,
  Loader2,
  X,
} from "lucide-react";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";
import { DccStatCards, DccTrendStrip } from "@/components/dcc/dcc-stat-cards";
import { DccFillRow } from "@/components/dcc/dcc-fill-row";
import { DccParticipantCard } from "@/components/dcc/dcc-participant-card";
import { DccItemDialog } from "@/components/dcc/dcc-item-dialog";
import { setDccEntry, setParticipantEntries, setDccReview, summarizeDccDay } from "@/app/(app)/dcc/actions";
import {
  addDays,
  slotKey,
  shortDateLabel,
  todayIso,
  type DccStatus,
} from "@/lib/dcc/util";
import {
  indexEntries,
  dayStats,
  computeStreak,
  trendDays,
  groupItems,
  buildTrays,
  visibleDailyItems,
  participantItemsDue,
  type BoardItem,
  type BoardEntry,
  type BoardClient,
  type BoardSubject,
  type BoardItemSubject,
  type SlotValue,
} from "@/lib/dcc/board-model";

export interface DccBoardPerson {
  id: string;
  name: string;
  avatarUrl: string | null;
}

export interface DccReviewValue {
  status: string | null;
  note: string | null;
}

export interface DccBoardProps {
  ownerId: string;
  ownerName: string;
  meId: string;
  date: string;
  items: BoardItem[];
  entries: BoardEntry[];
  clients: BoardClient[];
  subjects: BoardSubject[];
  itemSubjects: BoardItemSubject[];
  people: DccBoardPerson[];
  review: DccReviewValue | null;
  canFill: boolean;
  canManage: boolean;
  canReview: boolean;
  isManager: boolean;
  sections: string[];
}

/**
 * The DCC board.
 *
 * Every fill is OPTIMISTIC: the local slot map is patched first, the slot is
 * marked busy, the server action runs inside a transition, and a failure
 * restores the previous value and toasts. The board must feel instant, and it
 * must never refetch the page while you are typing.
 */
export function DccBoard(props: DccBoardProps) {
  const router = useRouter();
  const [isPending, startTransition] = React.useTransition();

  const today = todayIso();
  const isToday = props.date === today;

  // Server truth, indexed once per payload change.
  const serverSlots = React.useMemo(() => indexEntries(props.entries), [props.entries]);
  /** Local overlay: slotKey → value (or null for "cleared"). */
  const [overlay, setOverlay] = React.useState<Map<string, SlotValue | null>>(new Map());
  const [busyKeys, setBusyKeys] = React.useState<Set<string>>(new Set());

  // A fresh server payload supersedes anything we were holding optimistically.
  React.useEffect(() => setOverlay(new Map()), [props.entries]);

  const slots = React.useMemo(() => {
    const merged = new Map(serverSlots);
    for (const [key, value] of overlay) {
      if (value === null) merged.delete(key);
      else merged.set(key, value);
    }
    return merged;
  }, [serverSlots, overlay]);

  const [showAll, setShowAll] = React.useState(false);
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [editing, setEditing] = React.useState<BoardItem | null>(null);
  const [dialogSection, setDialogSection] = React.useState<string | null>(null);
  const [dialogClientId, setDialogClientId] = React.useState<string | null>(null);
  const [summary, setSummary] = React.useState<string | null>(null);
  const [summarising, setSummarising] = React.useState(false);

  const stats = React.useMemo(
    () => dayStats(props.items, slots, props.date),
    [props.items, slots, props.date],
  );
  const streak = React.useMemo(
    () => computeStreak(props.items, slots, today),
    [props.items, slots, today],
  );
  const trend = React.useMemo(
    () => trendDays(props.items, slots, today),
    [props.items, slots, today],
  );

  const dailyItems = React.useMemo(
    () => visibleDailyItems(props.items, slots, props.date, showAll),
    [props.items, slots, props.date, showAll],
  );
  const groups = React.useMemo(
    () => groupItems(dailyItems, props.clients),
    [dailyItems, props.clients],
  );
  const trays = React.useMemo(() => buildTrays(props.items), [props.items]);
  const rosters = React.useMemo(
    () => participantItemsDue(props.items, props.date),
    [props.items, props.date],
  );

  const subjectsByItem = React.useMemo(() => {
    const byId = new Map(props.subjects.map((s) => [s.id, s]));
    const map = new Map<string, BoardSubject[]>();
    for (const link of props.itemSubjects) {
      const subject = byId.get(link.subjectId);
      if (!subject) continue;
      const list = map.get(link.itemId) ?? [];
      list.push(subject);
      map.set(link.itemId, list);
    }
    return map;
  }, [props.subjects, props.itemSubjects]);

  const scheduledCount = props.items.filter(
    (i) => i.scheduleKind === "scheduled" && !i.isParticipantList,
  ).length;

  /* ── Optimistic fill ─────────────────────────────────────────────── */

  const commit = React.useCallback(
    (item: BoardItem, subjectId: string | null, next: Partial<SlotValue>) => {
      const key = slotKey(item.id, subjectId, props.date);
      const previous = slots.get(key) ?? null;
      const merged: SlotValue = {
        status: next.status !== undefined ? next.status : (previous?.status ?? null),
        valueNumber:
          next.valueNumber !== undefined ? next.valueNumber : (previous?.valueNumber ?? null),
        note: next.note !== undefined ? next.note : (previous?.note ?? null),
      };
      const cleared = !merged.status && merged.valueNumber == null && !merged.note;

      setOverlay((prev) => new Map(prev).set(key, cleared ? null : merged));
      setBusyKeys((prev) => new Set(prev).add(key));

      startTransition(async () => {
        const res = await setDccEntry({
          itemId: item.id,
          date: props.date,
          status: (merged.status as DccStatus | null) ?? null,
          value: merged.valueNumber == null ? null : Number(merged.valueNumber),
          note: merged.note,
          subjectId,
        });
        setBusyKeys((prev) => {
          const nextSet = new Set(prev);
          nextSet.delete(key);
          return nextSet;
        });
        if (!res.ok) {
          // Roll back to exactly what was there before the click.
          setOverlay((prev) => new Map(prev).set(key, previous));
          toast.error(res.error);
        }
      });
    },
    [props.date, slots],
  );

  const bulkParticipants = React.useCallback(
    (item: BoardItem, status: DccStatus | null) => {
      const subjects = subjectsByItem.get(item.id) ?? [];
      const keys = subjects.map((s) => slotKey(item.id, s.id, props.date));
      const previous = new Map(keys.map((k) => [k, slots.get(k) ?? null]));

      setOverlay((prev) => {
        const next = new Map(prev);
        for (const k of keys) {
          next.set(k, status ? { status, valueNumber: null, note: null } : null);
        }
        return next;
      });
      setBusyKeys((prev) => new Set([...prev, ...keys]));

      startTransition(async () => {
        const res = await setParticipantEntries({ itemId: item.id, date: props.date, status });
        setBusyKeys((prev) => {
          const next = new Set(prev);
          for (const k of keys) next.delete(k);
          return next;
        });
        if (!res.ok) {
          setOverlay((prev) => {
            const next = new Map(prev);
            for (const [k, v] of previous) next.set(k, v);
            return next;
          });
          toast.error(res.error);
        }
      });
    },
    [props.date, slots, subjectsByItem],
  );

  /* ── Review ──────────────────────────────────────────────────────── */

  const [reviewStatus, setReviewStatus] = React.useState(props.review?.status ?? null);
  const [reviewNote, setReviewNote] = React.useState(props.review?.note ?? "");
  React.useEffect(() => {
    setReviewStatus(props.review?.status ?? null);
    setReviewNote(props.review?.note ?? "");
  }, [props.review]);

  function saveReview(status: string | null, note: string) {
    setReviewStatus(status);
    startTransition(async () => {
      const res = await setDccReview({
        ownerEmployeeId: props.ownerId,
        date: props.date,
        status: status as "approved" | "needs_rework" | null,
        note: note.trim() || null,
      });
      if (!res.ok) {
        setReviewStatus(props.review?.status ?? null);
        toast.error(res.error);
      }
    });
  }

  async function runSummary() {
    setSummarising(true);
    const res = await summarizeDccDay({ ownerId: props.ownerId, date: props.date });
    setSummarising(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setSummary(res.summary);
  }

  function openAdd(section: string | null, clientId: string | null) {
    setEditing(null);
    setDialogSection(section);
    setDialogClientId(clientId);
    setDialogOpen(true);
  }

  const readOnly = !props.canFill;

  return (
    <div className="space-y-4">
      <DccStatCards stats={stats} streak={streak} totalItems={props.items.length} />

      {/* ── Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2.5 rounded-kpi border border-hairline bg-surface-card px-4 py-3">
        {props.isManager && props.people.length > 1 ? (
          <div className="flex items-center gap-2">
            <EmployeeAvatar name={props.ownerName} size="sm" />
            <select
              value={props.ownerId}
              onChange={(e) => router.push(`/dcc?emp=${e.target.value}&date=${props.date}`)}
              aria-label="Whose DCC to show"
              className="rounded-[9px] border border-hairline bg-surface-input px-2.5 py-1.5 text-[13px] font-semibold text-ink-strong outline-none focus:border-altus-red"
            >
              {props.people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.id === props.meId ? " (me)" : ""}
                </option>
              ))}
            </select>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <EmployeeAvatar name={props.ownerName} size="sm" />
            <span className="text-[14px] font-bold text-ink-strong">{props.ownerName}</span>
          </div>
        )}

        {/* Date stepper */}
        <div className="ml-auto flex items-center gap-1 rounded-[9px] border border-hairline p-0.5 max-md:ml-0">
          <StepButton
            label="Previous day"
            onClick={() => router.push(`/dcc?emp=${props.ownerId}&date=${addDays(props.date, -1)}`)}
          >
            <ChevronLeft size={16} />
          </StepButton>
          <span className="min-w-[104px] px-2 text-center text-[13px] font-bold text-ink-strong">
            {isToday ? "Today" : shortDateLabel(props.date)}
          </span>
          <StepButton
            label="Next day"
            disabled={isToday}
            onClick={() => router.push(`/dcc?emp=${props.ownerId}&date=${addDays(props.date, 1)}`)}
          >
            <ChevronRight size={16} />
          </StepButton>
        </div>

        {!isToday && (
          <Link
            href={`/dcc?emp=${props.ownerId}`}
            className="text-[12.5px] font-semibold text-altus-red hover:underline"
          >
            Back to Today
          </Link>
        )}

        <Link
          href="/dcc/ranking"
          className="inline-flex items-center gap-1.5 rounded-[9px] border border-hairline px-2.5 py-1.5 text-[12.5px] font-semibold text-ink-soft transition hover:bg-surface-track"
        >
          <Trophy size={14} /> Ranking
        </Link>

        <button
          type="button"
          onClick={runSummary}
          disabled={summarising}
          className="inline-flex items-center gap-1.5 rounded-[9px] border border-hairline px-2.5 py-1.5 text-[12.5px] font-semibold text-ink-soft transition hover:bg-surface-track disabled:opacity-50"
        >
          {summarising ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          Summarize My Day
        </button>

        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-pressed={showAll}
          className="rounded-[9px] border border-hairline px-2.5 py-1.5 text-[12.5px] font-semibold text-ink-soft transition hover:bg-surface-track"
        >
          {showAll ? "Due Today Only" : `Show all (${scheduledCount})`}
        </button>

        {props.canManage && (
          <button
            type="button"
            onClick={() => openAdd(null, null)}
            className="inline-flex items-center gap-1.5 rounded-[9px] px-3 py-1.5 text-[12.5px] font-bold text-white transition"
            style={{ background: "var(--color-green-deep)" }}
          >
            <Plus size={14} /> Add KPI
          </button>
        )}
      </div>

      <DccTrendStrip
        days={trend}
        selected={props.date}
        onSelect={(d) => router.push(`/dcc?emp=${props.ownerId}&date=${d}`)}
      />

      {/* ── Manager review ──────────────────────────────────────────── */}
      {(props.canReview || props.review) && (
        <ReviewBar
          canReview={props.canReview}
          status={reviewStatus}
          note={reviewNote}
          onNote={setReviewNote}
          onStatus={(s) => saveReview(s, reviewNote)}
          onCommitNote={() => saveReview(reviewStatus, reviewNote)}
        />
      )}

      {readOnly && (
        <div
          className="flex items-center gap-2 rounded-[12px] border px-3.5 py-2.5 text-[13px] font-semibold"
          style={{
            background: "var(--color-blue-bg)",
            borderColor: "var(--color-blue)",
            color: "var(--color-blue-deep)",
          }}
        >
          <Eye size={15} /> You're viewing {props.ownerName}'s checklist — read only.
        </div>
      )}

      {summary && (
        <div className="relative rounded-[16px] border border-hairline bg-surface-soft p-4 pr-10">
          <div className="text-kpi-label mb-1.5 text-ink-subtle">AI summary</div>
          <p className="text-[13.5px] leading-relaxed text-ink-soft">{summary}</p>
          <button
            type="button"
            onClick={() => setSummary(null)}
            aria-label="Dismiss summary"
            className="absolute right-3 top-3 rounded p-1 text-ink-subtle hover:text-ink-strong"
          >
            <X size={15} />
          </button>
        </div>
      )}

      {/* ── Fill surface ────────────────────────────────────────────── */}
      {groups.length === 0 && rosters.length === 0 ? (
        <div className="rounded-[22px] border border-hairline bg-surface-card px-6 py-14 text-center">
          <CheckCircle2
            size={40}
            className="mx-auto mb-3"
            style={{ color: "var(--color-green)" }}
          />
          <p className="text-[15px] font-bold text-ink-strong">Nothing due today.</p>
          <p className="mt-1 text-[13px] text-ink-subtle">
            {props.items.length === 0
              ? "No KPIs on this checklist yet."
              : "Weekly, monthly and ad-hoc items are in the trays below."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map((group) => (
            <section
              key={group.key}
              className="rounded-[22px] border border-hairline bg-surface-card p-4"
            >
              <header className="mb-3 flex items-center gap-2">
                <span
                  className="size-2 shrink-0 rounded-full"
                  style={{ background: "var(--color-green-deep)" }}
                  aria-hidden
                />
                <h3
                  className="text-[15px] font-black text-ink-strong"
                  style={{ fontFamily: "var(--font-serif)" }}
                >
                  {group.section}
                </h3>
                {group.clientName && (
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-bold"
                    style={{
                      background: "var(--color-blue-bg)",
                      color: "var(--color-blue-deep)",
                    }}
                  >
                    {group.clientName}
                  </span>
                )}
                <span className="text-[12px] text-ink-subtle tabular-nums">
                  {group.items.length}
                </span>
                {props.canManage && (
                  <button
                    type="button"
                    onClick={() =>
                      openAdd(
                        group.section === "Checklist" ? null : group.section,
                        group.items[0]?.clientId ?? null,
                      )
                    }
                    className="ml-auto inline-flex items-center gap-1 rounded-[8px] px-2 py-1 text-[12px] font-semibold text-ink-subtle transition hover:bg-surface-track hover:text-ink-strong"
                  >
                    <Plus size={13} /> Add
                  </button>
                )}
              </header>
              <div className="space-y-2">
                {group.items.map((item) => {
                  const key = slotKey(item.id, null, props.date);
                  return (
                    <DccFillRow
                      key={item.id}
                      item={item}
                      value={slots.get(key)}
                      busy={busyKeys.has(key)}
                      readOnly={readOnly}
                      canEdit={props.canManage}
                      onStatus={(status) => commit(item, null, { status })}
                      onValue={(v) =>
                        commit(item, null, { valueNumber: v == null ? null : String(v) })
                      }
                      onNote={(note) => commit(item, null, { note })}
                      onEdit={() => {
                        setEditing(item);
                        setDialogSection(null);
                        setDialogClientId(null);
                        setDialogOpen(true);
                      }}
                    />
                  );
                })}
              </div>
            </section>
          ))}

          {rosters.map((item) => (
            <DccParticipantCard
              key={item.id}
              item={item}
              date={props.date}
              subjects={subjectsByItem.get(item.id) ?? []}
              slots={slots}
              busyKeys={busyKeys}
              readOnly={readOnly}
              canManage={props.canManage}
              onSet={(subjectId, status) => commit(item, subjectId, { status })}
              onBulk={(status) => bulkParticipants(item, status)}
              onRefresh={() => router.refresh()}
            />
          ))}
        </div>
      )}

      {/* ── Trays — never part of the daily count ───────────────────── */}
      <Tray
        title="This Week"
        items={trays.weekly}
        {...{ slots, busyKeys, readOnly, props, commit, setEditing, setDialogOpen }}
      />
      <Tray
        title="This Month"
        items={trays.monthly}
        {...{ slots, busyKeys, readOnly, props, commit, setEditing, setDialogOpen }}
      />
      <Tray
        title="When It Happens"
        items={trays.whenItHappens}
        {...{ slots, busyKeys, readOnly, props, commit, setEditing, setDialogOpen }}
      />

      <DccItemDialog
        open={dialogOpen}
        onClose={() => {
          setDialogOpen(false);
          router.refresh();
        }}
        ownerId={props.ownerId}
        item={editing}
        defaultSection={dialogSection}
        defaultClientId={dialogClientId}
        allItems={props.items}
        clients={props.clients}
        sections={props.sections}
      />

      {isPending && <span className="sr-only">Saving…</span>}
    </div>
  );
}

function StepButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="rounded-[7px] p-1.5 text-ink-soft transition hover:bg-surface-track disabled:cursor-not-allowed disabled:opacity-30"
    >
      {children}
    </button>
  );
}

function ReviewBar({
  canReview,
  status,
  note,
  onNote,
  onStatus,
  onCommitNote,
}: {
  canReview: boolean;
  status: string | null;
  note: string;
  onNote: (v: string) => void;
  onStatus: (s: string | null) => void;
  onCommitNote: () => void;
}) {
  const tint =
    status === "approved"
      ? { bg: "var(--color-green-bg)", border: "var(--color-green)" }
      : status === "needs_rework"
        ? { bg: "var(--color-amber-bg)", border: "var(--color-amber)" }
        : { bg: "var(--color-surface-soft)", border: "var(--color-hairline)" };

  if (!canReview) {
    return (
      <div
        className="rounded-[12px] border px-3.5 py-2.5 text-[13px] font-semibold text-ink-soft"
        style={{ background: tint.bg, borderColor: tint.border }}
      >
        {status === "approved"
          ? "✓ Approved by your manager"
          : status === "needs_rework"
            ? "Needs rework"
            : "Not reviewed yet"}
        {note && <span className="ml-2 font-normal text-ink-muted">— {note}</span>}
      </div>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-[12px] border px-3.5 py-2.5"
      style={{ background: tint.bg, borderColor: tint.border }}
    >
      <span className="text-kpi-label text-ink-subtle">Review</span>
      <button
        type="button"
        aria-pressed={status === "approved"}
        onClick={() => onStatus(status === "approved" ? null : "approved")}
        className="rounded-[8px] border px-2.5 py-1 text-[12.5px] font-bold transition"
        style={{
          background: status === "approved" ? "var(--color-green)" : "transparent",
          color: status === "approved" ? "#fff" : "var(--color-green-deep)",
          borderColor: "var(--color-green)",
        }}
      >
        ✓ Approved
      </button>
      <button
        type="button"
        aria-pressed={status === "needs_rework"}
        onClick={() => onStatus(status === "needs_rework" ? null : "needs_rework")}
        className="rounded-[8px] border px-2.5 py-1 text-[12.5px] font-bold transition"
        style={{
          background: status === "needs_rework" ? "var(--color-amber)" : "transparent",
          color: status === "needs_rework" ? "#fff" : "var(--color-amber-deep)",
          borderColor: "var(--color-amber)",
        }}
      >
        Needs Rework
      </button>
      <input
        value={note}
        onChange={(e) => onNote(e.target.value)}
        onBlur={onCommitNote}
        placeholder="Note to them…"
        aria-label="Review note"
        className="min-w-[180px] flex-1 rounded-[8px] border border-hairline bg-surface-card px-2.5 py-1.5 text-[13px] text-ink-strong outline-none focus:border-altus-red"
      />
    </div>
  );
}

/**
 * A collapsible tray for weekly / monthly / when-it-happens KPIs. Hidden
 * entirely when empty so the board doesn't grow three dead headings.
 */
function Tray({
  title,
  items,
  slots,
  busyKeys,
  readOnly,
  props,
  commit,
  setEditing,
  setDialogOpen,
}: {
  title: string;
  items: BoardItem[];
  slots: Map<string, SlotValue>;
  busyKeys: Set<string>;
  readOnly: boolean;
  props: DccBoardProps;
  commit: (item: BoardItem, subjectId: string | null, next: Partial<SlotValue>) => void;
  setEditing: (i: BoardItem | null) => void;
  setDialogOpen: (v: boolean) => void;
}) {
  const [open, setOpen] = React.useState(false);
  if (items.length === 0) return null;

  const done = items.filter(
    (i) => slots.get(slotKey(i.id, null, props.date))?.status === "Done",
  ).length;

  return (
    <section className="overflow-hidden rounded-[16px] border border-hairline bg-surface-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left transition hover:bg-surface-soft"
      >
        <h3 className="text-[14px] font-bold text-ink-strong">{title}</h3>
        <span className="text-[12px] text-ink-subtle tabular-nums">
          {done}/{items.length}
        </span>
        <ChevronDown
          size={16}
          className="ml-auto text-ink-subtle transition-transform"
          style={{ transform: open ? "rotate(180deg)" : undefined }}
        />
      </button>
      {open && (
        <div className="space-y-2 border-t border-hairline px-4 py-3">
          {items.map((item) => {
            const key = slotKey(item.id, null, props.date);
            return (
              <DccFillRow
                key={item.id}
                item={item}
                value={slots.get(key)}
                busy={busyKeys.has(key)}
                readOnly={readOnly}
                canEdit={props.canManage}
                onStatus={(status) => commit(item, null, { status })}
                onValue={(v) =>
                  commit(item, null, { valueNumber: v == null ? null : String(v) })
                }
                onNote={(note) => commit(item, null, { note })}
                onEdit={() => {
                  setEditing(item);
                  setDialogOpen(true);
                }}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}
