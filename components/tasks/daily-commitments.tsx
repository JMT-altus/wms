"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  ArrowLeft,
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  Pencil,
  Plus,

  CalendarClock,
  Check,
  Clock,
  ListChecks,
  Target,
  Copy,
  PauseCircle,
  Search,
  User,
  X,
} from "lucide-react";
import { setTaskRevisedTargetDate, setTaskStatus } from "@/app/(app)/tasks/actions";
import { fireToast } from "@/lib/toast";
import type { DayPlanTask, PlanTask } from "@/lib/queries/my-day";
import { PRIORITY_LABELS, type TaskStatus } from "@/db/enums";

export interface PlanGoal {
  id: string;
  title: string;
  pctDone: number;
}

/**
 * What Change Plan does while "All Employees" is selected. The plan board edits
 * ONE person's days, so it has to pick someone:
 *   "own-plan" — switch the employee filter to the signed-in person and open theirs.
 * This is the single place the rule lives — both Change Plan buttons go through
 * openBoard(), so changing the behaviour later is a change to this value and to
 * openBoard() only.
 */
const CHANGE_PLAN_WITH_ALL_EMPLOYEES = "own-plan" as const;

type Mode = "plan" | "board" | "review" | "full";

/** What the user did to a task during this review (kept locally until the page refreshes). */
type Outcome = "done" | "tomorrow" | "dayafter" | "pending";

const MONO = { fontFamily: "var(--font-mono-display), ui-monospace, monospace" } as const;

/** yyyy-mm-dd plus n days (calendar arithmetic, no time zone involved). */
function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
const fmtDay = (ymd: string) =>
  new Date(`${ymd}T00:00:00Z`)
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" })
    .replace(/ /g, "-");

/** Calendar icon that opens the browser date picker; picking a day calls onPick(yyyy-mm-dd). */
function ReschedulePicker({
  min,
  disabled,
  title,
  onPick,
}: {
  min: string;
  disabled: boolean;
  title: string;
  onPick: (ymd: string) => void;
}) {
  const ref = React.useRef<HTMLInputElement>(null);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        disabled={disabled}
        title={title}
        aria-label={title}
        onClick={() => {
          const el = ref.current;
          if (!el) return;
          if (typeof el.showPicker === "function") el.showPicker();
          else el.click();
        }}
        className="inline-flex size-7 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-surface-soft hover:text-ink-strong disabled:cursor-not-allowed disabled:opacity-40"
      >
        <CalendarClock size={15} aria-hidden />
      </button>
      <input
        ref={ref}
        type="date"
        min={min}
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0"
        onChange={(e) => {
          if (e.target.value) onPick(e.target.value);
          e.target.value = "";
        }}
      />
    </span>
  );
}

function TaskTag({ daily }: { daily: boolean }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-[4px] border border-[#E3E7EE] bg-[#F5F7FA] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-ink-soft">
      <span aria-hidden className={`size-1.5 rounded-full ${daily ? "bg-[#10b981]" : "bg-[#0A6CFF]"}`} />
      {daily ? "Daily commitment" : "WMS task"}
    </span>
  );
}

/**
 * Daily Commitments — "Your Day Is Planned", the Change Plan board and the full
 * My Day workspace, in one page.
 *
 * A day's plan is the person's open tasks that fall due that day. Moving a task
 * into a day (the + button) or out of it (the x, which carries it to the next
 * day) is a revised-target-date change — the same field, and the same
 * admin-only rule, the task edit form uses — so the original due date is never
 * lost and shows as "carried forward from …". Everyone can read the board;
 * only admins can change it.
 */
export function DailyCommitments({
  people,
  selectedId,
  canPickPerson,
  canEdit,
  allPeople,
  dayYmd,
  dayPlan,
  planError,
  statusLabels,
  todayYmd,
  planTasks,
  goals,
  review,
}: {
  people: { id: string; name: string }[];
  selectedId: string;
  canPickPerson: boolean;
  canEdit: boolean;
  /** Showing everyone's plan, not one person's. */
  allPeople: boolean;
  /** The day whose plan the "Your Day Is Planned" list shows (IST yyyy-mm-dd). */
  dayYmd: string;
  /** Every task planned for that day, for the selected employee(s). */
  dayPlan: DayPlanTask[];
  /** The plan could not be loaded — show an error, not an empty day. */
  planError: boolean;
  statusLabels: Record<TaskStatus, string>;
  todayYmd: string;
  planTasks: PlanTask[];
  goals: PlanGoal[];
  /** The existing My Day workspace (filter bar + agenda/list), shown on demand. */
  review: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [mode, setMode] = React.useState<Mode>("plan");
  const [day, setDay] = React.useState(todayYmd);
  const [windowStart, setWindowStart] = React.useState(todayYmd);
  const [tab, setTab] = React.useState<"todo" | "upcoming">("todo");
  const [busy, setBusy] = React.useState<string | null>(null);
  const [query, setQuery] = React.useState("");
  const [searchOpen, setSearchOpen] = React.useState(false);
  const [outcomes, setOutcomes] = React.useState<Record<string, Outcome>>({});
  /** Rows dismissed with × — hidden from this review only; the task itself is untouched. */
  const [dismissed, setDismissed] = React.useState<Set<string>>(() => new Set());
  const [tokens, setTokens] = React.useState<Record<string, string>>({});
  const [loading, startTransition] = React.useTransition();

  const selectedName = people.find((p) => p.id === selectedId)?.name ?? "";

  /** Change one URL filter (or clear it with null) — the server re-fetches the plan. */
  function setParam(key: "who" | "day", value: string | null) {
    const sp = new URLSearchParams(searchParams.toString());
    if (value) sp.set(key, value);
    else sp.delete(key);
    startTransition(() => router.replace(`${pathname}?${sp.toString()}` as Route));
  }
  async function moveTo(task: PlanTask, ymd: string) {
    if (!canEdit || busy) return;
    setBusy(task.id);
    const res = await setTaskRevisedTargetDate(task.id, {
      revisedTargetDate: new Date(`${ymd}T12:00:00.000Z`).toISOString(),
    });
    setBusy(null);
    if (!res.ok) {
      fireToast({ message: res.message ?? "Couldn't change the plan." });
      return;
    }
    startTransition(() => router.refresh());
  }

  // ── Review Today actions ────────────────────────────────────────────────
  async function markDone(t: DayPlanTask) {
    if (busy) return;
    setBusy(t.id);
    const res = await setTaskStatus(t.id, "done", tokens[t.id] ?? t.updatedAt);
    setBusy(null);
    if (!res.ok) {
      fireToast({ message: res.message ?? "Couldn't mark the task done." });
      return;
    }
    setTokens((cur) => ({ ...cur, [t.id]: res.updatedAt }));
    setOutcomes((cur) => ({ ...cur, [t.id]: "done" }));
    startTransition(() => router.refresh());
  }

  /** Tomorrow / Day After: the admin-only revised-target-date change the plan board uses. */
  async function pushOut(t: DayPlanTask, days: 1 | 2) {
    return moveReviewTask(t, addDays(dayYmd, days), days === 1 ? "tomorrow" : "dayafter");
  }

  /** Tomorrow / Day After / a picked date: the admin-only revised-target-date change the plan board uses. */
  async function moveReviewTask(t: DayPlanTask, ymd: string, outcome: Outcome) {
    if (!canEdit || busy) return;
    setBusy(t.id);
    const res = await setTaskRevisedTargetDate(t.id, {
      revisedTargetDate: new Date(`${ymd}T12:00:00.000Z`).toISOString(),
    });
    setBusy(null);
    if (!res.ok) {
      fireToast({ message: res.message ?? "Couldn't move the task." });
      return;
    }
    setOutcomes((cur) => ({ ...cur, [t.id]: outcome }));
    startTransition(() => router.refresh());
  }

  /** Pending: leaves the task exactly as it is — only marks it as reviewed here. */
  function keepPending(t: DayPlanTask) {
    setOutcomes((cur) => {
      const next = { ...cur };
      if (next[t.id] === "pending") delete next[t.id];
      else next[t.id] = "pending";
      return next;
    });
  }

  /** Change Plan — every Change Plan button calls this. See CHANGE_PLAN_WITH_ALL_EMPLOYEES. */
  function openBoard() {
    if (allPeople && CHANGE_PLAN_WITH_ALL_EMPLOYEES === "own-plan") setParam("who", selectedId);
    setMode("board");
  }

  function finishDay() {
    const counts = { done: 0, moved: 0, pending: 0 };
    for (const o of Object.values(outcomes)) {
      if (o === "done") counts.done++;
      else if (o === "pending") counts.pending++;
      else counts.moved++;
    }
    fireToast({
      message: `Day reviewed — ${counts.done} done, ${counts.moved} moved, ${counts.pending} left pending.`,
    });
    setOutcomes({});
    setMode("plan");
  }

  const planFor = (ymd: string) => planTasks.filter((t) => t.dueYmd === ymd);
  const overdueNow = planTasks.filter((t) => t.dueYmd < todayYmd).length;

  const shown = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return q
      ? dayPlan.filter((t) => t.title.toLowerCase().includes(q) || t.doerName.toLowerCase().includes(q))
      : dayPlan;
  }, [dayPlan, query]);
  const employeesShown = new Set(shown.map((t) => t.doerId)).size;
  const completed = shown.filter((t) => t.status === "done" || t.status === "approved").length;

  const chip =
    "inline-flex h-9 items-center rounded-[10px] border border-hairline-strong bg-white text-[13px] font-semibold text-ink-strong";
  /** Search: an icon that opens into a box — on the planned view and on Review. */
  const searchControl =
    searchOpen || query ? (
      <label className={`${chip} min-w-[220px] gap-2 px-3`}>
        <Search size={14} className="text-ink-subtle" aria-hidden />
        <span className="sr-only">Search tasks</span>
        <input
          type="search"
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onBlur={() => !query && setSearchOpen(false)}
          placeholder="Search tasks…"
          aria-label="Search planned tasks"
          className="min-w-0 flex-1 bg-transparent text-[13px] font-medium outline-none placeholder:text-ink-subtle"
        />
      </label>
    ) : (
      <button
        type="button"
        onClick={() => setSearchOpen(true)}
        aria-label="Search tasks"
        title="Search tasks"
        className={`${chip} size-9 justify-center text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink-strong`}
      >
        <Search size={16} strokeWidth={2.2} aria-hidden />
      </button>
    );

  const filterBar = (
    <div className="mb-3 flex flex-wrap items-center gap-2" role="search" aria-label="Daily commitments filters">
      <button
        type="button"
        onClick={() => setMode("review")}
        className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-[#BBD3F7] bg-[#EEF4FF] px-3 text-[13px] font-semibold text-[#0B4FB8] transition-colors hover:bg-[#E2ECFD] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A6CFF]"
      >
        <ClipboardCheck size={15} strokeWidth={2.2} aria-hidden />
        Review My Day
      </button>
      <label className={`relative ${chip} pl-3 pr-8`}>
        <span className="sr-only">Employee</span>
        <select
          value={allPeople ? "all" : selectedId}
          disabled={!canPickPerson}
          onChange={(e) => setParam("who", e.target.value === "all" ? "all" : e.target.value)}
          aria-label="Employee"
          className="h-full cursor-pointer appearance-none bg-transparent pr-2 outline-none disabled:cursor-default"
        >
          {canPickPerson && <option value="all">All Employees</option>}
          {people.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {canPickPerson && (
          <ChevronDown size={14} className="pointer-events-none absolute right-2.5 text-ink-subtle" aria-hidden />
        )}
      </label>
      <div className="ml-auto">{searchControl}</div>
    </div>
  );

  // ── Open full My Day: the workspace that was here before ─────────────────
  if (mode === "full") {
    return (
      <>
        <div className="mx-auto flex max-w-[1600px] items-center px-8 pt-3 max-md:px-4">
          <button
            type="button"
            onClick={() => setMode("plan")}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-hairline-strong bg-white px-3 text-[13px] font-semibold text-ink-strong transition-colors hover:bg-surface-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A6CFF]"
          >
            <ArrowLeft size={14} strokeWidth={2.4} aria-hidden />
            Your day
          </button>
        </div>
        {review}
      </>
    );
  }

  // ── Review Today: go through the day's tasks one by one ──────────────────
  if (mode === "review") {
    const days = Array.from({ length: 7 }, (_, i) => addDays(windowStart, i));
    const label = (ymd: string) => {
      const diff = daysBetween(todayYmd, ymd);
      if (diff === 0) return "Today";
      if (diff === 1) return "Tomorrow";
      if (diff === 2) return "Day After";
      return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
    };
    const sub = (ymd: string) =>
      new Date(`${ymd}T00:00:00Z`)
        .toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
        .toUpperCase();
    const goDay = (ymd: string) => setParam("day", ymd === todayYmd ? null : ymd);
    const list = shown.filter(
      (t) => outcomes[t.id] !== "tomorrow" && outcomes[t.id] !== "dayafter" && !dismissed.has(t.id),
    );
    const actionBtn =
      "inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-[11.5px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-40";

    return (
      <main className="wms-fill mx-auto w-full max-w-[1240px] px-8 max-md:px-4 pt-4 pb-3" aria-busy={loading}>
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-0.5 rounded-xl border border-hairline-strong bg-white p-0.5" role="tablist" aria-label="Day">
            <button
              type="button"
              aria-label="Earlier days"
              onClick={() => setWindowStart((w) => (addDays(w, -7) < todayYmd ? todayYmd : addDays(w, -7)))}
              disabled={windowStart <= todayYmd}
              className="inline-flex size-7 items-center justify-center rounded-lg text-ink-soft hover:bg-surface-soft disabled:opacity-40"
            >
              <ChevronLeft size={14} />
            </button>
            {days.map((d) => {
              const on = d === dayYmd;
              return (
                <button
                  key={d}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => goDay(d)}
                  className="flex min-w-[58px] flex-col items-center rounded-lg px-2 py-0.5 text-center leading-tight transition-colors"
                  style={{ background: on ? "#0A6CFF" : "transparent", color: on ? "#ffffff" : "var(--color-ink-strong)" }}
                >
                  <span className="text-[11.5px] font-bold">{label(d)}</span>
                  <span className="text-[8.5px] font-semibold uppercase opacity-80">{sub(d)}</span>
                </button>
              );
            })}
            <button
              type="button"
              aria-label="Later days"
              onClick={() => setWindowStart(addDays(windowStart, 7))}
              disabled={daysBetween(todayYmd, windowStart) >= 7}
              className="inline-flex size-7 items-center justify-center rounded-lg text-ink-soft hover:bg-surface-soft disabled:opacity-40"
            >
              <ChevronRight size={14} />
            </button>
          </div>
          {/* Back to today — switched off while today is already showing. */}
          <button
            type="button"
            onClick={() => {
              setWindowStart(todayYmd);
              goDay(todayYmd);
            }}
            disabled={dayYmd === todayYmd && windowStart === todayYmd}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[#BBD3F7] bg-[#EEF4FF] px-3 text-[12.5px] font-semibold text-[#0B4FB8] transition-colors hover:bg-[#E2ECFD] disabled:cursor-not-allowed disabled:border-hairline-strong disabled:bg-white disabled:text-ink-subtle disabled:opacity-60"
          >
            <CalendarCheck size={14} aria-hidden />
            Today
          </button>
          <label className="relative inline-flex h-8 items-center rounded-lg border border-hairline-strong bg-white pl-3 pr-8 text-[12.5px] font-semibold text-ink-strong">
            <span className="sr-only">Employee</span>
            <select
              value={allPeople ? "all" : selectedId}
              disabled={!canPickPerson}
              onChange={(e) => setParam("who", e.target.value)}
              aria-label="Employee"
              className="h-full cursor-pointer appearance-none bg-transparent pr-2 outline-none disabled:cursor-default"
            >
              {canPickPerson && <option value="all">All Employees</option>}
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {canPickPerson && (
              <ChevronDown size={14} className="pointer-events-none absolute right-2.5 text-ink-subtle" aria-hidden />
            )}
          </label>
          <div className="ml-auto">{searchControl}</div>
        </div>

        <section aria-label="Review today">
          <div className="mb-3 flex items-center gap-3">
            <span className="inline-flex size-9 items-center justify-center rounded-lg bg-[#0A6CFF] text-white">
              <ClipboardCheck size={19} aria-hidden />
            </span>
            <div role="heading" aria-level={1} className="text-[22px] font-extrabold text-ink-strong" style={{ fontFamily: "var(--font-display), system-ui, sans-serif" }}>
              Review {dayYmd === todayYmd ? "Today" : fmtDay(dayYmd)}
            </div>
          </div>

          {!canEdit && (
            <p className="mb-3 rounded-lg border border-[#FDE6B3] bg-[#FFF8E8] px-3 py-2 text-[12.5px] font-medium text-[#9A5B00]">
              Moving a task to Tomorrow or the Day After is admin-only, so those buttons are switched off for you. Done and Pending are available.
            </p>
          )}

          {planError ? (
            <p className="px-3 py-8 text-center text-[13px] font-semibold text-[#b91c1c]" role="alert">
              Couldn&apos;t load the plan for this day.
            </p>
          ) : list.length === 0 ? (
            <p className="px-3 py-10 text-center text-[13px] font-medium text-ink-subtle">
              Nothing left to review for this day.
            </p>
          ) : (
            <ul className="grid gap-2">
              {list.map((t) => {
                const out = outcomes[t.id];
                const isDone = out === "done" || t.status === "done" || t.status === "approved";
                return (
                  <li key={t.id} className="flex flex-wrap items-center gap-4 rounded-md border border-[#E3E7EE] bg-white px-4 py-2.5 transition-colors hover:border-[#c9d3e3]">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/tasks/${t.id}` as Route}
                        className={`block text-[14.5px] font-bold leading-snug hover:underline ${isDone ? "text-ink-subtle line-through" : "text-ink-strong"}`}
                      >
                        {t.title}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-3">
                        <TaskTag daily={t.daily} />
                        <span className="inline-flex items-center gap-1 text-[11.5px] font-medium text-ink-soft">
                          <User size={12} className="text-ink-subtle" aria-hidden />
                          {t.doerName}
                        </span>
                        {t.carriedFrom && (
                          <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#b45309]">
                            Carried forward · from {fmtDay(t.carriedFrom)}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        onClick={() => markDone(t)}
                        disabled={isDone || busy === t.id}
                        aria-pressed={isDone}
                        className={`${actionBtn} border-[#34d399] bg-white text-[#047857] hover:bg-[#ECFDF5]`}
                      >
                        <Check size={12} strokeWidth={3} aria-hidden /> Done
                      </button>
                      <button
                        type="button"
                        onClick={() => pushOut(t, 1)}
                        disabled={!canEdit || isDone || busy === t.id}
                        title={canEdit ? "Move to the next day" : "Only an admin can reschedule tasks"}
                        className={`${actionBtn} border-[#fb923c] bg-[#FFEDD5] text-[#c2410c] hover:bg-[#FED7AA]`}
                      >
                        Tomm
                      </button>
                      <button
                        type="button"
                        onClick={() => pushOut(t, 2)}
                        disabled={!canEdit || isDone || busy === t.id}
                        title={canEdit ? "Move two days ahead" : "Only an admin can reschedule tasks"}
                        className={`${actionBtn} border-[#93b4f5] bg-[#EEF4FF] text-[#1d4ed8] hover:bg-[#DBE7FF]`}
                      >
                        Day After
                      </button>
                      <button
                        type="button"
                        onClick={() => keepPending(t)}
                        disabled={isDone}
                        aria-pressed={out === "pending"}
                        title="Leave it as it is"
                        className={`${actionBtn} ${
                          out === "pending"
                            ? "border-[#ef4444] bg-[#FEE2E2] text-[#b91c1c]"
                            : "border-[#fca5a5] bg-white text-[#b91c1c] hover:bg-[#FFF1F1]"
                        }`}
                      >
                        <PauseCircle size={12} aria-hidden /> Pending
                      </button>
                      <ReschedulePicker
                        min={todayYmd}
                        disabled={!canEdit || isDone || busy === t.id}
                        title={canEdit ? "Move to another day" : "Only an admin can reschedule tasks"}
                        onPick={(ymd) => {
                          if (ymd !== dayYmd) void moveReviewTask(t, ymd, "tomorrow");
                        }}
                      />
                      <Link
                        href={`/tasks/new?from=${t.id}` as Route}
                        title="Duplicate this task"
                        aria-label={`Duplicate ${t.title}`}
                        className="inline-flex size-7 items-center justify-center rounded-md border border-[#f2c66d] bg-[#FFFBEB] text-[#b45309] transition-colors hover:bg-[#FEF3C7]"
                      >
                        <Copy size={13} aria-hidden />
                      </Link>
                      <button
                        type="button"
                        onClick={() => setDismissed((cur) => new Set(cur).add(t.id))}
                        title="Hide from this review (the task is not changed)"
                        aria-label={`Hide ${t.title} from this review`}
                        className="inline-flex size-7 items-center justify-center rounded-md border border-[#E3E7EE] bg-white text-ink-subtle transition-colors hover:bg-surface-soft hover:text-ink-strong"
                      >
                        <X size={13} aria-hidden />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="mt-4 flex items-center justify-between">
          <button
            type="button"
            onClick={openBoard}
            title={allPeople ? "Opens your own plan — the board changes one person's days" : undefined}
            className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-hairline-strong bg-white px-4 text-[14px] font-semibold text-ink-strong transition-colors hover:bg-surface-soft"
          >
            <ArrowLeft size={14} strokeWidth={2.4} aria-hidden />
            Change plan
          </button>
          <button
            type="button"
            onClick={finishDay}
            className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-[#0A6CFF] px-5 text-[14px] font-semibold text-white shadow-sm transition-colors hover:bg-[#0858d6]"
          >
            <CheckCircle2 size={15} aria-hidden />
            Finish day
          </button>
        </div>
      </main>
    );
  }

  // ── Change Plan: pick a day, pull tasks in, push them out ────────────────
  if (mode === "board") {
    const days = Array.from({ length: 7 }, (_, i) => addDays(windowStart, i));
    const label = (ymd: string) => {
      const diff = daysBetween(todayYmd, ymd);
      if (diff === 0) return "Today";
      if (diff === 1) return "Tomorrow";
      if (diff === 2) return "Day After";
      return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
    };
    const sub = (ymd: string) =>
      new Date(`${ymd}T00:00:00Z`)
        .toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" })
        .toUpperCase();

    const planned = planFor(day);
    const before = planTasks.filter((t) => t.dueYmd < day);
    const after = planTasks.filter((t) => t.dueYmd > day);
    const list = tab === "todo" ? before : after;

    const card = "flex min-h-[340px] flex-col rounded-xl border border-hairline-strong bg-white";
    const countChip =
      "inline-flex min-w-6 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-bold tabular-nums";

    return (
      <main className="wms-fill mx-auto w-full max-w-[1320px] px-8 max-md:px-4 pt-4 pb-3">
        {/* Controls: back, day, today, review, whose plan */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setMode("plan")}
            title="Back to your day"
            className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-hairline-strong bg-white px-3 text-[13px] font-semibold text-ink-strong transition-colors hover:bg-surface-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A6CFF]"
          >
            <ArrowLeft size={14} strokeWidth={2.4} aria-hidden />
            Your day
          </button>
          <div className="flex items-center gap-0.5 rounded-xl border border-hairline-strong bg-white p-0.5" role="tablist" aria-label="Planning date">
            <button
              type="button"
              aria-label="Earlier days"
              title="Earlier days"
              onClick={() => setWindowStart((w) => (addDays(w, -7) < todayYmd ? todayYmd : addDays(w, -7)))}
              disabled={windowStart <= todayYmd}
              className="inline-flex size-7 items-center justify-center rounded-lg text-ink-soft hover:bg-surface-soft disabled:opacity-40"
            >
              <ChevronLeft size={14} />
            </button>
            {days.map((d) => {
              const on = d === day;
              return (
                <button
                  key={d}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => setDay(d)}
                  className="flex min-w-[58px] flex-col items-center rounded-lg px-2 py-0.5 text-center leading-tight transition-colors"
                  style={{ background: on ? "#0A6CFF" : "transparent", color: on ? "#ffffff" : "var(--color-ink-strong)" }}
                >
                  <span className="text-[11.5px] font-bold">{label(d)}</span>
                  <span className="text-[8.5px] font-semibold uppercase opacity-80">{sub(d)}</span>
                </button>
              );
            })}
            <button
              type="button"
              aria-label="Later days"
              title="Later days"
              onClick={() => setWindowStart(addDays(windowStart, 7))}
              disabled={daysBetween(todayYmd, windowStart) >= 7}
              className="inline-flex size-7 items-center justify-center rounded-lg text-ink-soft hover:bg-surface-soft disabled:opacity-40"
            >
              <ChevronRight size={14} />
            </button>
          </div>
          {/* Back to today — switched off while today is already showing. */}
          <button
            type="button"
            onClick={() => {
              setDay(todayYmd);
              setWindowStart(todayYmd);
            }}
            disabled={day === todayYmd && windowStart === todayYmd}
            className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-[#BBD3F7] bg-[#EEF4FF] px-3 text-[12.5px] font-semibold text-[#0B4FB8] transition-colors hover:bg-[#E2ECFD] disabled:cursor-not-allowed disabled:border-hairline-strong disabled:bg-white disabled:text-ink-subtle disabled:opacity-60"
          >
            <CalendarCheck size={14} aria-hidden />
            Today
          </button>
          <button
            type="button"
            onClick={() => setMode("review")}
            className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-[#BBD3F7] bg-[#EEF4FF] px-3 text-[12.5px] font-semibold text-[#0B4FB8] transition-colors hover:bg-[#E2ECFD]"
          >
            <ClipboardCheck size={14} aria-hidden />
            Review My Day
          </button>
          {/* Whose plan: one person at a time — the board edits one person's days. */}
          <label className="relative inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-hairline-strong bg-white pl-2.5 pr-8 text-[12.5px] font-semibold text-ink-strong">
            <User size={14} className="text-ink-subtle" aria-hidden />
            <span className="sr-only">Employee</span>
            <select
              value={selectedId}
              disabled={!canPickPerson}
              onChange={(e) => setParam("who", e.target.value)}
              aria-label="Employee"
              className="h-full cursor-pointer appearance-none bg-transparent pr-1 outline-none disabled:cursor-default"
            >
              {people.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
            {canPickPerson && (
              <ChevronDown size={14} className="pointer-events-none absolute right-2.5 text-ink-subtle" aria-hidden />
            )}
          </label>
        </div>

        {!canEdit && (
          <p className="mb-3 rounded-lg border border-[#FDE6B3] bg-[#FFF8E8] px-3 py-2 text-[12.5px] font-medium text-[#9A5B00]">
            Only an admin can move tasks between days. You can see the plan, but the + and × are switched off.
          </p>
        )}

        <div className="grid items-stretch gap-4 lg:grid-cols-2">
          {/* Left: what could be brought into the day */}
          <section className={card} aria-label="Tasks to bring in">
            <div className="border-b border-hairline p-2.5">
              <div className="grid grid-cols-2 gap-1 rounded-lg bg-[#EEF3FB] p-1" role="tablist">
                {(
                  [
                    ["todo", "WMS To-Do", before.length, ListChecks],
                    ["upcoming", "Upcoming", after.length, Clock],
                  ] as const
                ).map(([key, text, n, Icon]) => {
                  const on = tab === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => setTab(key)}
                      className="inline-flex items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-[12.5px] font-bold transition-colors"
                      style={{ background: on ? "#0A6CFF" : "transparent", color: on ? "#ffffff" : "var(--color-ink-soft)" }}
                    >
                      <Icon size={14} aria-hidden />
                      {text}
                      <span
                        className={countChip}
                        style={{ background: on ? "rgba(255,255,255,0.22)" : "#ffffff", color: on ? "#ffffff" : "var(--color-ink-soft)" }}
                      >
                        {n}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="flex items-center justify-between px-3.5 pt-2.5 pb-1.5">
              <span className="text-[12.5px] font-bold text-ink-strong">{tab === "todo" ? "Your Due Tasks" : "Coming Up"}</span>
              <span className={`${countChip} bg-[#F1F4F9] text-ink-soft`}>{list.length}</span>
            </div>
            {list.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center px-4 pb-6 text-center">
                <ListChecks size={20} className="text-ink-subtle" aria-hidden />
                <p className="mt-2 text-[13px] font-semibold text-ink-soft">
                  {tab === "todo" ? "No overdue tasks to bring in." : "Nothing coming up after this day."}
                </p>
              </div>
            ) : (
              <div className="kanban-scroll mx-2.5 mb-2.5 max-h-[420px] overflow-auto rounded-lg border border-hairline">
                <table className="w-full border-collapse text-[12.5px]">
                  <thead className="sticky top-0 z-10 bg-[#F5F7FB] text-left text-[10.5px] font-bold uppercase tracking-[0.06em] text-ink-subtle">
                    <tr>
                      <th className="px-3 py-2">{tab === "todo" ? "Overdue date" : "Due date"}</th>
                      <th className="px-3 py-2">Subject</th>
                      <th className="px-3 py-2">Task</th>
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((t) => {
                      const gap = daysBetween(t.dueYmd, day);
                      return (
                        <tr key={t.id} className="border-t border-[#EEF1F6] align-top hover:bg-[#F7F9FD]">
                          <td className="px-3 py-2 whitespace-nowrap font-semibold tabular-nums text-ink-soft" style={MONO}>
                            {fmtDay(t.dueYmd)}
                          </td>
                          <td className="px-3 py-2 font-semibold text-ink-soft">{t.subject ?? "—"}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-start gap-2">
                              <button
                                type="button"
                                onClick={() => moveTo(t, day)}
                                disabled={!canEdit || busy === t.id}
                                aria-label={`Add ${t.title} to ${fmtDay(day)}`}
                                title={canEdit ? `Plan this for ${fmtDay(day)}` : "Only an admin can change the plan"}
                                className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-[#0A6CFF] text-white transition-colors hover:bg-[#0858d6] disabled:cursor-not-allowed disabled:opacity-40"
                              >
                                <Plus size={13} strokeWidth={3} />
                              </button>
                              <div className="min-w-0 flex-1">
                                <Link href={`/tasks/${t.id}` as Route} className="block text-[13px] font-semibold leading-snug text-ink-strong hover:underline">
                                  {t.title}
                                </Link>
                                <div className="mt-1 flex flex-wrap items-center gap-2">
                                  <TaskTag daily={t.daily} />
                                  <span className={`text-[11px] font-bold ${gap > 0 ? "text-[#b91c1c]" : "text-ink-subtle"}`}>
                                    {gap > 0 ? `${gap} day${gap === 1 ? "" : "s"} overdue` : `due in ${-gap} day${gap === -1 ? "" : "s"}`}
                                  </span>
                                </div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* Right: the plan for the chosen day */}
          <section className={card} aria-label={`Plan for ${fmtDay(day)}`}>
            <div className="flex items-center gap-2 border-b border-hairline px-3.5 py-3">
              <span className="inline-flex size-7 items-center justify-center rounded-lg bg-[#EEF4FF] text-[#0A6CFF]">
                <CalendarCheck size={15} aria-hidden />
              </span>
              <span className="text-[13.5px] font-bold text-ink-strong">
                Plan for {day === todayYmd ? "today" : fmtDay(day)}
              </span>
              <span className={`${countChip} bg-[#EEF4FF] text-[#0B4FB8]`}>{planned.length} to do</span>
            </div>
            {planned.length === 0 ? (
              <div className="flex flex-1 flex-col items-center justify-center px-4 py-6 text-center">
                <CalendarCheck size={20} className="text-ink-subtle" aria-hidden />
                <p className="mt-2 text-[13px] font-semibold text-ink-soft">Nothing planned for this day yet.</p>
                <p className="mt-0.5 text-[12px] font-medium text-ink-subtle">Use + on a task to bring it in.</p>
              </div>
            ) : (
              <ul className="kanban-scroll grid max-h-[460px] gap-2 overflow-auto p-2.5">
                {planned.map((t) => (
                  <li key={t.id} className="flex items-start gap-2 rounded-lg border border-[#E3E7EE] bg-white px-3 py-2 transition-colors hover:border-[#c9d3e3]">
                    <div className="min-w-0 flex-1">
                      <Link href={`/tasks/${t.id}` as Route} className="block text-[13.5px] font-semibold leading-snug text-ink-strong hover:underline">
                        {t.title}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <TaskTag daily={t.daily} />
                        {t.revised && t.originalYmd !== day && (
                          <span className="text-[10.5px] font-bold uppercase tracking-[0.06em] text-[#b45309]">
                            Carried forward · from {fmtDay(t.originalYmd)}
                          </span>
                        )}
                      </div>
                    </div>
                    <Link
                      href={`/tasks/${t.id}` as Route}
                      aria-label={`Open ${t.title}`}
                      title="Open the task to edit it"
                      className="mt-0.5 inline-flex size-7 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-surface-soft hover:text-ink-strong"
                    >
                      <Pencil size={13} />
                    </Link>
                    <button
                      type="button"
                      onClick={() => moveTo(t, addDays(day, 1))}
                      disabled={!canEdit || busy === t.id}
                      aria-label={`Carry ${t.title} forward to ${fmtDay(addDays(day, 1))}`}
                      title={canEdit ? `Carry forward to ${fmtDay(addDays(day, 1))}` : "Only an admin can change the plan"}
                      className="mt-0.5 inline-flex size-7 items-center justify-center rounded-md text-ink-subtle transition-colors hover:bg-[#FEE2E2] hover:text-[#b91c1c] disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      <X size={14} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* This week's goals */}
        <section className="mt-4 overflow-hidden rounded-xl border border-hairline-strong bg-white" aria-label="This week's goals">
          <header className="flex items-center gap-2 border-b border-hairline px-3.5 py-3">
            <span className="inline-flex size-7 items-center justify-center rounded-lg bg-[#EEF4FF] text-[#0A6CFF]">
              <Target size={15} aria-hidden />
            </span>
            <h2 className="text-[13.5px] font-bold text-ink-strong">This Week&apos;s Goals</h2>
            <span className={`${countChip} bg-[#EEF4FF] text-[#0B4FB8]`}>{goals.length}</span>
          </header>
          {goals.length === 0 ? (
            <p className="px-4 py-5 text-center text-[13px] font-medium text-ink-subtle">No goals set for this week.</p>
          ) : (
            <ul>
              {goals.map((g) => (
                <li key={g.id} className="flex items-center gap-3 border-b border-[#EEF1F6] px-4 py-2 last:border-b-0">
                  <span aria-hidden className="h-5 w-0.5 shrink-0 rounded-full bg-[#0A6CFF]" />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-semibold text-ink-strong" title={g.title}>
                    {g.title}
                  </span>
                  <span className="h-1.5 w-28 shrink-0 overflow-hidden rounded-full bg-[#E8EDF5] max-sm:hidden">
                    <span className="block h-full rounded-full bg-[#0A6CFF]" style={{ width: `${g.pctDone}%` }} />
                  </span>
                  <span className="w-10 shrink-0 text-right text-[12px] font-bold tabular-nums text-ink-soft" style={MONO}>
                    {g.pctDone}%
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    );
  }

  // ── Your Day Is Planned ───────────────────────────────────────────────────
  const dayLabel = dayYmd === todayYmd ? "today" : fmtDay(dayYmd);
  return (
    <main className="wms-fill mx-auto w-full max-w-[1120px] px-8 max-md:px-4 pt-4 pb-3">
      {filterBar}

      <section
        aria-label="Your day"
        aria-busy={loading}
        className="rounded-2xl p-4 max-md:p-3"
        style={{ background: "#F3F8FF", border: "1px solid #CFE0FB", opacity: loading ? 0.7 : 1 }}
      >
        <div className="mb-3 flex items-center justify-center gap-3">
          <span
            className="inline-flex size-11 items-center justify-center rounded-xl text-white"
            style={{ background: "#0A6CFF", boxShadow: "0 5px 12px -6px rgba(10,108,255,0.6)" }}
          >
            <CheckCircle2 size={24} strokeWidth={2.2} aria-hidden />
          </span>
          <div
            role="heading"
            aria-level={1}
            className="text-ink-strong"
            style={{
              fontFamily: "var(--font-display), system-ui, sans-serif",
              fontWeight: 800,
              fontSize: 26,
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
            }}
          >
            Your Day Is Planned
          </div>
        </div>

        {planError ? (
          <div className="rounded-xl border border-[#f2a4a4] bg-[#FFF5F5] px-4 py-8 text-center" role="alert">
            <p className="text-[14px] font-bold text-[#b91c1c]">Couldn&apos;t load the plan</p>
            <p className="mt-1 text-[12.5px] font-medium text-ink-soft">
              Something went wrong fetching the tasks for this day. Try again in a moment.
            </p>
            <button
              type="button"
              onClick={() => startTransition(() => router.refresh())}
              className="mt-3 inline-flex h-8 items-center rounded-lg border border-hairline-strong bg-white px-3 text-[12.5px] font-semibold text-ink-strong hover:bg-surface-soft"
            >
              Try again
            </button>
          </div>
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center rounded-xl border border-dashed border-[#CFE0FB] bg-white px-4 py-10 text-center">
            <CalendarCheck size={22} className="text-ink-subtle" aria-hidden />
            <p className="mt-3 text-[15px] font-bold text-ink-strong">
              {dayPlan.length === 0 ? "No tasks planned for this day" : "No tasks match your search"}
            </p>
            <p className="mt-1 text-[13px] font-medium text-ink-subtle">
              {dayPlan.length === 0
                ? `Try another date${canPickPerson && !allPeople ? " or select All Employees" : ""}.${
                    overdueNow > 0 && !allPeople ? ` ${overdueNow} overdue — use Change Plan to bring them into the day.` : ""
                  }`
                : "Clear the search or pick another employee."}
            </p>
          </div>
        ) : (
          <ul className="grid gap-2">
            {shown.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/tasks/${t.id}` as Route}
                  className="block rounded-xl border border-hairline-strong bg-white px-4 py-3 transition-colors hover:border-[#9fb2d1] hover:bg-[#F7F9FD] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A6CFF]"
                >
                  <span className="flex items-start justify-between gap-3">
                    <span className="block text-[15.5px] font-semibold leading-snug text-ink-strong">{t.title}</span>
                  </span>
                  <span className="mt-2 flex flex-wrap items-center gap-2">
                    <TaskTag daily={t.daily} />
                    <span className="rounded-md bg-[#EEF4FF] px-2 py-0.5 text-[11.5px] font-bold text-[#0B4FB8]">
                      {statusLabels[t.status] ?? t.status}
                    </span>
                    <span className="rounded-md bg-[#F1F4F9] px-2 py-0.5 text-[11.5px] font-bold text-ink-soft">
                      {PRIORITY_LABELS[t.priority]}
                    </span>
                    <span className="text-[11.5px] font-semibold text-ink-subtle">Due {dayLabel}</span>
                    {t.carriedFrom && (
                      <span className="text-[11.5px] font-bold uppercase tracking-[0.04em] text-[#9A5B00]">
                        Carried forward · from {fmtDay(t.carriedFrom)}
                      </span>
                    )}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}

        <div className="mt-5 flex items-center justify-center gap-2.5">
          <button
            type="button"
            onClick={openBoard}
            title={allPeople ? "Opens your own plan — the board changes one person's days" : undefined}
            className="inline-flex h-10 items-center gap-1.5 rounded-[10px] border border-hairline-strong bg-white px-4 text-[14px] font-semibold text-ink-strong transition-colors hover:bg-surface-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A6CFF]"
          >
            <ArrowLeft size={14} strokeWidth={2.4} aria-hidden />
            Change Plan
          </button>
          <button
            type="button"
            onClick={() => setMode("review")}
            className="inline-flex h-10 items-center gap-1.5 rounded-[10px] bg-[#0A6CFF] px-5 text-[14px] font-semibold text-white shadow-sm transition-colors hover:bg-[#0858d6] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A6CFF]"
          >
            <ClipboardCheck size={15} strokeWidth={2.2} aria-hidden />
            Review My Day
          </button>
        </div>
      </section>
    </main>
  );
}
