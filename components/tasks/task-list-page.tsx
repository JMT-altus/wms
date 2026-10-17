import Link from "next/link";
import type { Route } from "next";
import { TaskTable } from "./task-table";
import { FullscreenToggle } from "@/components/masters/fullscreen-toggle";
import type { TaskListRow, TaskListFilters } from "@/lib/types";
import { taskFiltersToSearchString } from "@/lib/task-filters";
import {
  PENDING_STATUSES as CANONICAL_PENDING_STATUSES,
  type TaskStatus,
  type StatusColorToken,
} from "@/db/enums";
import { STATUS_LABELS_FALLBACK, STATUS_TONES_FALLBACK } from "@/lib/format";

const DONE_STATUSES = new Set<TaskStatus>(["done", "approved"]);
// Sourced from the canonical export so Tier-3 statuses count correctly.
const PENDING_STATUSES = new Set<TaskStatus>(CANONICAL_PENDING_STATUSES);

export type KpiKey =
  | "notApproved"
  | "approved"
  | "done"
  | "pending"
  | "critical"
  | "urgent"
  | "notRead";

interface KpiSpec {
  key: KpiKey;
  label: string;
  /** Long form, used as the pill's tooltip — the strip itself stays terse. */
  sublabel: string;
  tone: "green" | "amber" | "red" | "orange" | "rose" | "slate" | "purple";
}

/** What a StatPill needs — shared by the summary pills and the per-status ones. */
interface PillSpec {
  label: string;
  sublabel: string;
  tone: string;
  /** Altus-style colour for the compact (Tasks page) strip — see ACCENTS. */
  accent?: string;
}

// The compact Tasks strip is colour-coded per pill (presentation only; the
// counts, links and filters behind each pill are unchanged).
const ACCENTS = {
  total: "#64748b",
  notRead: "#7c3aed",
  not_started: "#4f46e5",
  initiated: "#f59e0b",
  follow_up: "#f97316",
  need_info: "#dc2626",
  done: "#059669",
  abandoned: "#0ea5e9",
} as const;

// The summary strip: Total, Not read, these workflow statuses, Done (which
// counts Done + Approved) and Abandoned.
const WORKFLOW_PILL_STATUSES: readonly TaskStatus[] = [
  "not_started",
  "initiated",
  "follow_up",
  "need_info",
];

/** Rows per workflow status, from the rows the page already holds. */
export function computeStatusCounts(rows: TaskListRow[]): Partial<Record<TaskStatus, number>> {
  const out: Partial<Record<TaskStatus, number>> = {};
  for (const r of rows) out[r.status] = (out[r.status] ?? 0) + 1;
  return out;
}

// Seven summary pills, in the order they read across the header band. The
// five that map onto a status/priority filter (approved/done/pending/critical/
// urgent) are links; notApproved and notRead stay display-only because they
// cut across those dimensions rather than sitting inside one.
//
// Sentence case, not caps: at this size a row of shouting labels is harder to
// scan than the counts they sit next to, and the count is the point.
const KPI_SPECS: KpiSpec[] = [
  { key: "notApproved", label: "Not approved", sublabel: "Declined or awaiting sign-off", tone: "rose"   },
  { key: "approved",    label: "Approved",     sublabel: "Signed off",                    tone: "purple" },
  { key: "done",        label: "Done",         sublabel: "Done + Approved",               tone: "green"  },
  { key: "pending",     label: "Pending",      sublabel: "Open work",                     tone: "amber"  },
  { key: "critical",    label: "Critical",     sublabel: "Important & urgent",            tone: "red"    },
  { key: "urgent",      label: "Urgent",       sublabel: "Urgent priority",               tone: "orange" },
  { key: "notRead",     label: "Not read",     sublabel: "Unopened pending tasks",        tone: "slate"  },
];

const NOT_READ_SPEC = KPI_SPECS.find((k) => k.key === "notRead")!;
const DONE_SPEC = KPI_SPECS.find((k) => k.key === "done")!;

/** Open (pending) task the doer has not opened yet — what "Not read" counts and filters. */
export function isUnreadPending(r: TaskListRow): boolean {
  return PENDING_STATUSES.has(r.status) && r.firstReadAt == null;
}

/** Pure, testable count logic for the six summary cards. Operates on the
 *  already-filtered rows so every count respects the page filters. */
export function computeStatCounts(rows: TaskListRow[]): Record<KpiKey, number> {
  return {
    notApproved: rows.filter(
      (r) =>
        r.approvalStatus === "not_approved" ||
        r.status === "not_approved" ||
        (r.status === "done" && r.approvalStatus == null),
    ).length,
    // The manager's verdict, from either the column or a legacy imported row
    // that still carries it as a status. Overlaps `done` on purpose — Done
    // answers "is the work finished", Approved answers "has it been signed
    // off", and a task can be both.
    approved: rows.filter(
      (r) => r.approvalStatus === "approved" || r.status === "approved",
    ).length,
    done: rows.filter((r) => DONE_STATUSES.has(r.status)).length,
    pending: rows.filter((r) => PENDING_STATUSES.has(r.status)).length,
    critical: rows.filter((r) => r.priority === "imp_urgent").length,
    urgent: rows.filter((r) => r.priority === "not_imp_urgent").length,
    notRead: rows.filter(isUnreadPending).length,
  };
}

export function TaskListPage({
  title,
  rows,
  filters,
  employees,
  me,
  statusLabels,
  statusTones,
  subjects,
  clients,
  basePath = "/tasks",
  showStats = true,
  compact = false,
  colorStrip = false,
  leading,
  unreadOnly = false,
}: {
  title: string;
  rows: TaskListRow[];
  filters: TaskListFilters;
  employees: { id: string; name: string }[];
  me: { id: string; isAdmin: boolean };
  statusLabels?: Record<TaskStatus, string>;
  statusTones?: Record<TaskStatus, StatusColorToken>;
  /** Bulk-set option rosters, threaded down to the bulk-action bar. */
  subjects?: string[];
  clients?: string[];
  /** List route the summary cards link into (so Archived keeps its own scope). */
  basePath?: string;
  /** The Tasks page: colour-coded compact summary pills, and no page title or
   *  Full screen button in the strip (the header already names the page). */
  colorStrip?: boolean;
  /**
   * Show the six-card KPI strip. Off in the Archive, where the cards measure
   * open work — Pending, Critical, Urgent and Not Read are 0 by definition
   * once everything on the page is archived, so the row reads as five empty
   * boxes next to a Done count that just restates the list length.
   */
  showStats?: boolean;
  /** The Tasks page's compact layout: smaller heading and pills, dense table. */
  compact?: boolean;
  /** A badge shown right beside the title (e.g. the Unassigned pool link). */
  leading?: React.ReactNode;
  /** The list is narrowed to unread tasks (?unread=1) — the Not read pill is active. */
  unreadOnly?: boolean;
}) {
  const counts = computeStatCounts(rows);
  const statusCounts = computeStatusCounts(rows);
  const abandonedSpec: PillSpec = {
    label: statusLabels?.abandoned ?? STATUS_LABELS_FALLBACK.abandoned,
    sublabel: "Tasks with status Abandoned",
    tone: statusTones?.abandoned ?? STATUS_TONES_FALLBACK.abandoned,
    accent: colorStrip ? ACCENTS.abandoned : undefined,
  };
  const unreadHref = (() => {
    const qs = taskFiltersToSearchString({ ...filters, statuses: [], priorities: [] });
    return (qs ? `${basePath}?${qs}&unread=1` : `${basePath}?unread=1`) as Route;
  })();
  const totalHref = (() => {
    const qs = taskFiltersToSearchString({ ...filters, statuses: [], priorities: [] });
    return (qs ? `${basePath}?${qs}` : basePath) as Route;
  })();

  // Build each card's destination by overriding the relevant filter dimension
  // on top of the current filters — so date/employee/department scope carries
  // over, and the other status/priority filter is cleared for a clean view.
  type LinkedKey = "approved" | "done" | "pending" | "critical" | "urgent";

  function cardHref(key: LinkedKey): Route {
    const base = { ...filters };
    let next: TaskListFilters;
    if (key === "approved") {
      next = { ...base, statuses: ["approved"], priorities: [] };
    } else if (key === "done") {
      next = { ...base, statuses: ["done", "approved"], priorities: [] };
    } else if (key === "pending") {
      next = { ...base, statuses: [...CANONICAL_PENDING_STATUSES], priorities: [] };
    } else if (key === "critical") {
      next = { ...base, priorities: ["imp_urgent"], statuses: [] };
    } else {
      next = { ...base, priorities: ["not_imp_urgent"], statuses: [] };
    }
    const qs = taskFiltersToSearchString(next);
    return (qs ? `${basePath}?${qs}` : basePath) as Route;
  }

  // Highlight a card when the list is already filtered to exactly its view.
  function cardActive(key: LinkedKey): boolean {
    const s = new Set(filters.statuses);
    const p = new Set(filters.priorities);
    if (key === "approved") return p.size === 0 && s.size === 1 && s.has("approved");
    if (key === "done") return p.size === 0 && s.size === 2 && s.has("done") && s.has("approved");
    if (key === "pending")
      return p.size === 0 && s.size === PENDING_STATUSES.size && [...s].every((x) => PENDING_STATUSES.has(x));
    if (key === "critical") return s.size === 0 && p.size === 1 && p.has("imp_urgent");
    if (key === "urgent") return s.size === 0 && p.size === 1 && p.has("not_imp_urgent");
    return false;
  }

  function statusActive(status: TaskStatus): boolean {
    return filters.priorities.length === 0 && filters.statuses.length === 1 && filters.statuses[0] === status;
  }

  function statusHref(status: TaskStatus): Route {
    const qs = taskFiltersToSearchString({ ...filters, statuses: [status], priorities: [] });
    return (qs ? `${basePath}?${qs}` : basePath) as Route;
  }

  return (
    <main className={`wms-fill mx-auto max-w-[1600px] max-md:px-4 ${compact ? "px-8 pb-3" : "px-12 pb-4"}`}>
      {/* Title row — the module name, its counts and the screen control on
          ONE line. The counts sit beside the title rather than in a grid of
          cards below it because they are a readout, not six destinations: at
          a glance you want "3 not approved, 64 pending", and the table
          underneath is what you actually came to read.

          No frame and no fill: the page's own background runs straight through
          the row. The pills are the only thing here carrying meaning through
          colour, and both a border and a ground behind them would compete
          with that. */}
      <header
        className={`flex flex-wrap items-center gap-x-2 gap-y-1.5 ${
          compact ? "mt-3 mb-2.5 min-h-[36px]" : "mt-2 mb-2 min-h-[40px]"
        }`}
      >
        {colorStrip ? (
          <h1 className="sr-only">{title}</h1>
        ) : compact ? (
          // A level-1 heading on a div, on purpose: globals.css sizes every <h1>
          // at 30–46px with !important, so no inline size can shrink it. The role
          // keeps it the page's h1.
          <div
            role="heading"
            aria-level={1}
            className="shrink-0 text-ink-strong"
            style={{
              fontFamily: "var(--font-display), system-ui, sans-serif",
              fontWeight: 800,
              fontSize: 26,
              letterSpacing: "-0.02em",
              lineHeight: 1,
            }}
          >
            {title}
          </div>
        ) : (
          <h1
            className="shrink-0 text-ink-strong"
            style={{
              fontFamily: "var(--font-display), system-ui, sans-serif",
              fontWeight: 800,
              fontSize: 10,
              letterSpacing: "-0.03em",
              lineHeight: 1,
            }}
          >
            {title}
          </h1>
        )}
        {leading}

        {showStats && (
          // One line: the pills share the row with the title. The strip scrolls
          // sideways (thin scrollbar as the cue) if they cannot all fit.
          <ul className="flex min-w-0 flex-1 flex-nowrap items-center gap-[3px] px-0.5 py-1">
            {/* Total — every task in the current filter; clicking clears the
                status and priority filters. */}
            <li className="min-w-0 shrink">
              <Link
                href={totalHref}
                aria-label="View all tasks"
                className="block min-w-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-altus-red/40"
              >
                <StatPill
                  spec={{ label: "Total", sublabel: "All tasks in the current filter", tone: "slate", accent: colorStrip ? ACCENTS.total : undefined }}
                  value={rows.length}
                  active={!unreadOnly && filters.statuses.length === 0 && filters.priorities.length === 0}
                  compact={compact}
                />
              </Link>
            </li>
            {/* Not read — open tasks the doer has not opened. Click to narrow the
                list to them; click again to clear. */}
            <li className="min-w-0 shrink">
              <Link
                href={unreadOnly ? totalHref : unreadHref}
                aria-label="View unread tasks"
                aria-current={unreadOnly ? "true" : undefined}
                className="block min-w-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-altus-red/40"
              >
                <StatPill spec={{ ...NOT_READ_SPEC, accent: colorStrip ? ACCENTS.notRead : undefined }} value={counts.notRead} active={unreadOnly} compact={compact} />
              </Link>
            </li>
            {WORKFLOW_PILL_STATUSES.map((status) => {
              const spec: PillSpec = {
                label: statusLabels?.[status] ?? STATUS_LABELS_FALLBACK[status],
                sublabel: `Tasks with status ${statusLabels?.[status] ?? STATUS_LABELS_FALLBACK[status]}`,
                tone: statusTones?.[status] ?? STATUS_TONES_FALLBACK[status],
                accent: colorStrip ? (ACCENTS as Record<string, string>)[status] : undefined,
              };
              return (
                <li key={status} className="min-w-0 shrink">
                  <Link
                    href={statusHref(status)}
                    aria-label={`View ${spec.label.toLowerCase()} tasks`}
                    className="block min-w-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-altus-red/40"
                  >
                    <StatPill spec={spec} value={statusCounts[status] ?? 0} active={statusActive(status)} compact={compact} />
                  </Link>
                </li>
              );
            })}
            {/* Done — Done + Approved, as before. */}
            <li className="min-w-0 shrink">
              <Link
                href={cardHref("done")}
                aria-label={`View ${DONE_SPEC.label.toLowerCase()} tasks`}
                className="block min-w-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-altus-red/40"
              >
                <StatPill spec={{ ...DONE_SPEC, accent: colorStrip ? ACCENTS.done : undefined }} value={counts.done} active={cardActive("done")} compact={compact} />
              </Link>
            </li>
            <li className="min-w-0 shrink">
              <Link
                href={statusHref("abandoned")}
                aria-label="View abandoned tasks"
                className="block min-w-0 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-altus-red/40"
              >
                <StatPill spec={abandonedSpec} value={statusCounts.abandoned ?? 0} active={statusActive("abandoned")} compact={compact} />
              </Link>
            </li>
          </ul>
        )}

        {!colorStrip && (
          <div className="ml-auto shrink-0">
            <FullscreenToggle size="sm" />
          </div>
        )}
      </header>

      {rows.length === 0 ? (
        <div
          className="bg-surface-card rounded-section border border-hairline p-10 text-center"
          style={{ boxShadow: "0 14px 32px -20px rgba(10, 108, 255, 0.16), 0 2px 6px -2px rgba(15, 23, 42, 0.06)" }}
        >
          <p
            className="font-bold"
            style={{ fontSize: 20, color: "var(--color-ink-strong)" }}
          >
            No tasks match the current filter.
          </p>
          <p
            className="mt-2 font-semibold"
            style={{ fontSize: 15, color: "var(--color-ink-muted)" }}
          >
            Try widening your date range or clearing assignee filters.
          </p>
        </div>
      ) : (
        <TaskTable
          rows={rows}
          employees={employees}
          me={me}
          statusLabels={statusLabels}
          statusTones={statusTones}
          subjects={subjects}
          clients={clients}
          dense
          altus={colorStrip}
        />
      )}
    </main>
  );
}

/**
 * One count in the header band: a tinted lozenge with a solid dot, the figure,
 * and its label.
 *
 * The dot carries the hue at full strength while the fill stays at ~10% of it,
 * so seven of these in a row read as one strip rather than seven warning
 * banners — the colour is an index, not an alarm. Both figure and label take
 * the deep tone, which clears contrast on the pale fill in a way the base hue
 * does not.
 *
 * A zero is dimmed rather than hidden: "0 Critical" is information, and a pill
 * that disappears when it hits zero makes the row jump every time the filters
 * change.
 */
function StatPill({
  spec,
  value,
  active,
  compact = false,
}: {
  spec: PillSpec;
  value: number;
  active: boolean;
  compact?: boolean;
}) {
  if (compact && spec.accent) {
    const acc = spec.accent;
    const ink = `color-mix(in srgb, ${acc} 62%, #0b1220)`;
    return (
      <span
        title={spec.sublabel}
        className="inline-flex h-7 max-w-full items-center gap-1 rounded-full px-2 transition-all duration-150"
        style={{
          background: `color-mix(in srgb, ${acc} ${active ? 16 : 8}%, #fff)`,
          border: `1px solid color-mix(in srgb, ${acc} 38%, #fff)`,
          boxShadow: active ? `0 0 0 2px color-mix(in srgb, ${acc} 45%, transparent)` : undefined,
        }}
      >
        <span aria-hidden className="inline-block size-2 shrink-0 rounded-full" style={{ background: acc }} />
        <span
          className="shrink-0 font-extrabold tabular-nums leading-none"
          style={{ fontSize: 13.5, color: ink, fontFamily: "var(--font-mono-display), ui-monospace, monospace" }}
        >
          {value}
        </span>
        <span className="min-w-0 truncate whitespace-nowrap font-bold leading-none" style={{ fontSize: 12, color: ink }}>
          {spec.label}
        </span>
      </span>
    );
  }
  const hue = `var(--color-${spec.tone})`;
  // The stock stone is too pale for text on its own tint.
  const deep = spec.tone === "stone" ? "#4b5563" : `var(--color-${spec.tone}-deep)`;

  return (
    <span
      title={spec.sublabel}
      className={`inline-flex items-center transition-all duration-150 ${
        compact ? "h-6 max-w-full gap-1 rounded-md px-1.5" : "h-7 gap-1.5 rounded-[9px] px-2.5"
      }`}
      style={{
        background: `color-mix(in srgb, ${hue} ${active ? 24 : 15}%, #fff)`,
        // No border, measured — the tinted fill alone separates the pill from
        // the page. The filtered-by state gets a ring instead, so it reads as
        // pressed without adding an outline the other six don't have.
        // A hairline of the tone keeps every pill (the pale grey and slate
        // ones especially) readable against the page; the filtered-by state
        // swaps it for a heavier ring.
        boxShadow: active
          ? `0 0 0 2px color-mix(in srgb, ${hue} 60%, transparent)`
          : `inset 0 0 0 1px color-mix(in srgb, ${hue} 32%, transparent)`,
        // A zero stays fully legible — dimming it is what made the grey pills
        // look washed out.
        opacity: 1,
      }}
    >
      <span
        aria-hidden
        className="inline-block size-2 shrink-0 rounded-full max-xl:hidden"
        style={{ background: hue }}
      />
      <span
        className="shrink-0 font-bold tabular-nums leading-none"
        style={{ fontSize: 12.5, color: deep }}
      >
        {value}
      </span>
      <span
        className="min-w-0 truncate whitespace-nowrap font-semibold leading-none"
        style={{ fontSize: 12, color: deep }}
      >
        {spec.label}
      </span>
    </span>
  );
}
