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
    notRead: rows.filter(
      (r) => PENDING_STATUSES.has(r.status) && r.firstReadAt == null,
    ).length,
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
  /**
   * Show the six-card KPI strip. Off in the Archive, where the cards measure
   * open work — Pending, Critical, Urgent and Not Read are 0 by definition
   * once everything on the page is archived, so the row reads as five empty
   * boxes next to a Done count that just restates the list length.
   */
  showStats?: boolean;
}) {
  const counts = computeStatCounts(rows);

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
    return s.size === 0 && p.size === 1 && p.has("not_imp_urgent");
  }

  return (
    <main className="mx-auto max-w-[1600px] px-12 max-md:px-4 pb-16">
      {/* Title row — the module name, its counts and the screen control on
          ONE line. The counts sit beside the title rather than in a grid of
          cards below it because they are a readout, not six destinations: at
          a glance you want "3 not approved, 64 pending", and the table
          underneath is what you actually came to read.

          No frame and no fill: the page's own background runs straight through
          the row. The pills are the only thing here carrying meaning through
          colour, and both a border and a ground behind them would compete
          with that. */}
      <header className="mt-2 mb-2 flex min-h-[40px] flex-wrap items-center gap-x-2.5 gap-y-1.5">
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

        {showStats && (
          <ul className="flex flex-wrap items-center gap-1">
            {KPI_SPECS.map((spec) => {
              const value = counts[spec.key];
              // notApproved and notRead cut ACROSS the status/priority
              // dimensions rather than sitting inside one, so there is no
              // filter to send you to — they stay readouts.
              if (spec.key === "notApproved" || spec.key === "notRead") {
                return (
                  <li key={spec.key}>
                    <StatPill spec={spec} value={value} active={false} />
                  </li>
                );
              }
              const filterKey = spec.key;
              return (
                <li key={spec.key}>
                  <Link
                    href={cardHref(filterKey)}
                    aria-label={`View ${spec.label.toLowerCase()} tasks`}
                    className="block rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-altus-red/40"
                  >
                    <StatPill
                      spec={spec}
                      value={value}
                      active={cardActive(filterKey)}
                    />
                  </Link>
                </li>
              );
            })}
          </ul>
        )}

        <div className="ml-auto shrink-0">
          <FullscreenToggle size="sm" />
        </div>
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
}: {
  spec: KpiSpec;
  value: number;
  active: boolean;
}) {
  const hue = `var(--color-${spec.tone})`;
  const deep = `var(--color-${spec.tone}-deep)`;
  const empty = value === 0;

  return (
    <span
      title={spec.sublabel}
      className="inline-flex h-7 items-center gap-1.5 rounded-[9px] px-2.5 transition-all duration-150"
      style={{
        background: `color-mix(in srgb, ${hue} ${active ? 20 : 11}%, #fff)`,
        // No border, measured — the tinted fill alone separates the pill from
        // the page. The filtered-by state gets a ring instead, so it reads as
        // pressed without adding an outline the other six don't have.
        boxShadow: active
          ? `0 0 0 2px color-mix(in srgb, ${hue} 55%, transparent)`
          : "none",
        opacity: empty && !active ? 0.72 : 1,
      }}
    >
      <span
        aria-hidden
        className="inline-block size-2 shrink-0 rounded-full"
        style={{ background: hue }}
      />
      <span
        className="font-bold tabular-nums leading-none"
        style={{ fontSize: 14, color: deep }}
      >
        {value}
      </span>
      <span
        className="whitespace-nowrap font-medium leading-none"
        style={{ fontSize: 12.5, color: deep }}
      >
        {spec.label}
      </span>
    </span>
  );
}
