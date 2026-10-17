"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import * as Popover from "@radix-ui/react-popover";
import { AlertTriangle, ArrowLeftRight, Check, ChevronDown, ChevronRight, ChevronsUpDown, Flame, ArrowDownUp, Search } from "lucide-react";
import Link from "next/link";
import type { Route } from "next";
import { AGE_BUCKETS, type AgeBucketId } from "@/db/enums";
import type { AgingRow, HeatmapCellTask } from "@/lib/types";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SectionHeader } from "./section-header";
import { SectionShareActions, type SectionReportInput } from "./section-share";
import { SearchBox, TeamTab } from "./status-table";

// Age-coded palette: cool/green for fresh, hot/red for old.
// Bars use a gradient pair for depth; deep is the saturated label color.
const BUCKET_COLOR: Record<
  AgeBucketId,
  { fill: string; deep: string; tint: string; light: string }
> = {
  "0-3":   { fill: "#86efac", deep: "#15803d", tint: "#dcfce7", light: "#bbf7d0" },
  "4-7":   { fill: "#4ade80", deep: "#15803d", tint: "#d1fae5", light: "#86efac" },
  "8-14":  { fill: "#bef264", deep: "#65a30d", tint: "#ecfccb", light: "#d9f99d" },
  "15-20": { fill: "#fcd34d", deep: "#b45309", tint: "#fef3c7", light: "#fde68a" },
  "21-30": { fill: "#fb923c", deep: "#c2410c", tint: "#ffedd5", light: "#fdba74" },
  "31-45": { fill: "#f87171", deep: "#b91c1c", tint: "#fee2e2", light: "#fca5a5" },
  "46-60": { fill: "#ef4444", deep: "#991b1b", tint: "#fecaca", light: "#f87171" },
  "60+":   { fill: "#b91c1c", deep: "#7f1d1d", tint: "#fecaca", light: "#ef4444" },
};

const BUCKET_WEIGHT: Record<AgeBucketId, number> = {
  "0-3": 1, "4-7": 2, "8-14": 3, "15-20": 5,
  "21-30": 7, "31-45": 10, "46-60": 14, "60+": 20,
};

const CRITICAL_BUCKETS: AgeBucketId[] = ["31-45", "46-60", "60+"];

function riskScore(row: AgingRow): number {
  if (row.total === 0) return 0;
  const weighted = AGE_BUCKETS.reduce(
    (s, b) => s + row.buckets[b.id] * BUCKET_WEIGHT[b.id],
    0,
  );
  const raw = weighted / row.total;
  return Math.round(((raw - 1) / 19) * 100);
}

type SortMode = "risk" | "total" | "oldest";

const SORT_LABELS: Record<SortMode, string> = { risk: "Risk", total: "Total", oldest: "Oldest" };

export function AgingHeatmap({
  rows,
  cellTasks,
  hiddenCells = {},
}: {
  rows: AgingRow[];
  cellTasks: Record<string, Record<string, HeatmapCellTask[]>>;
  /** Per cell, how many tasks this viewer isn't allowed to open. */
  hiddenCells?: Record<string, Record<string, number>>;
}) {
  const router = useRouter();
  const [sortMode, setSortMode] = React.useState<SortMode>("risk");
  const [query, setQuery] = React.useState("");
  const [team, setTeam] = React.useState<string | null>(null);
  const [ages, setAges] = React.useState<AgeBucketId[]>([]);
  const [collapsed, setCollapsed] = React.useState(false);
  const [transposed, setTransposed] = React.useState(false);

  const enriched = React.useMemo(
    () => rows.map((r) => ({ ...r, risk: riskScore(r) })),
    [rows],
  );

  const teams = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of enriched) {
      const name = r.department?.trim() || "Others";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort(([x], [y]) =>
      x === "Others" ? 1 : y === "Others" ? -1 : x.localeCompare(y),
    );
  }, [enriched]);

  // Department tab + search narrow the people; the age legend narrows to people
  // who have tasks in the chosen age range(s).
  const scoped = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return enriched.filter((r) => {
      if (team && (r.department?.trim() || "Others") !== team) return false;
      if (q && !r.employeeName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [enriched, team, query]);

  const visible = React.useMemo(
    () => (ages.length === 0 ? scoped : scoped.filter((r) => ages.some((b) => r.buckets[b] > 0))),
    [scoped, ages],
  );

  const sorted = React.useMemo(() => {
    const copy = [...visible];
    if (sortMode === "total") copy.sort((a, b) => b.total - a.total);
    else if (sortMode === "risk") copy.sort((a, b) => b.risk - a.risk);
    else
      copy.sort(
        (a, b) =>
          CRITICAL_BUCKETS.reduce((s, k) => s + b.buckets[k], 0) -
          CRITICAL_BUCKETS.reduce((s, k) => s + a.buckets[k], 0),
      );
    return copy;
  }, [visible, sortMode]);

  const top12 = sorted.slice(0, 12);
  const maxTotal = Math.max(...top12.map((r) => r.total), 1);

  // The alert reads the whole picture, not the current tab/search.
  const criticalTotal = enriched.reduce(
    (s, r) => s + CRITICAL_BUCKETS.reduce((acc, k) => acc + r.buckets[k], 0),
    0,
  );

  const bucketCounts = React.useMemo(() => {
    const m = Object.fromEntries(AGE_BUCKETS.map((b) => [b.id, 0])) as Record<AgeBucketId, number>;
    for (const r of scoped) for (const b of AGE_BUCKETS) m[b.id] += r.buckets[b.id];
    return m;
  }, [scoped]);

  const buildReport = React.useCallback(
    (): SectionReportInput => ({
      title: "Aging Heatmap",
      subtitle: `${sorted.length} ${sorted.length === 1 ? "person" : "people"}`,
      context: [
        team ? `Team: ${team}` : null,
        query.trim() ? `Search: ${query.trim()}` : null,
        ages.length ? `Age: ${ages.map((a) => `${a}d`).join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
      columns: ["Employee", "Risk", ...AGE_BUCKETS.map((b) => `${b.id}d`), "Total"],
      rows: sorted.map((r) => [
        r.employeeName,
        String(r.risk),
        ...AGE_BUCKETS.map((b) => String(r.buckets[b.id])),
        String(r.total),
      ]),
    }),
    [sorted, team, query, ages],
  );

  return (
    <SectionHeader
      id="aging-heatmap"
      icon={<Flame size={18} strokeWidth={2.2} />}
      tone="blue"
      title="Aging Heatmap"
      collapsed={collapsed}
      onToggle={() => setCollapsed((v) => !v)}
      actions={
        <>
          <SortMenu value={sortMode} onChange={setSortMode} />
          <SectionShareActions title="Aging Heatmap" buildReport={buildReport} />
          {/* Same swap Status by Doer has: people across the top, ages down the side. */}
          <button
            type="button"
            onClick={() => setTransposed((v) => !v)}
            aria-pressed={transposed}
            aria-label="Switch rows and columns"
            title="Switch rows and columns"
            className="inline-flex size-9 items-center justify-center rounded-[10px] border border-hairline-strong bg-white text-ink-strong transition-colors hover:bg-surface-soft aria-pressed:bg-surface-soft"
          >
            <ArrowLeftRight size={16} strokeWidth={2.2} aria-hidden />
          </button>
        </>
      }
      trailing={<SearchToggle value={query} onChange={setQuery} />}
    >
      <div
        className="rounded-section p-3 max-md:p-2.5"
        style={{
          background: "#ffffff",
          border: "1px solid var(--color-hairline-strong)",
          boxShadow: "0 1px 2px rgba(15, 23, 42, 0.05), 0 8px 24px -16px rgba(15, 23, 42, 0.16)",
        }}
      >
        {criticalTotal > 0 && <AlertBanner count={criticalTotal} />}

        {enriched.length > 0 && (
          <div
            className="mb-2 flex flex-wrap items-center gap-x-1 gap-y-0.5 rounded-xl p-1"
            style={{ background: "#EEF3FB" }}
            role="tablist"
            aria-label="Teams"
          >
            <TeamTab compact label="All Employees" count={enriched.length} active={team === null} onClick={() => setTeam(null)} />
            {teams.map(([name, count]) => (
              <TeamTab
                compact
                key={name}
                label={name}
                count={count}
                active={team === name}
                onClick={() => setTeam(team === name ? null : name)}
              />
            ))}
          </div>
        )}

        <Legend
          counts={bucketCounts}
          active={ages}
          onToggle={(id) => setAges((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]))}
        />

        {top12.length === 0 ? (
          <p className="mt-3 px-1 py-6 text-center text-[13.5px] font-semibold text-ink-subtle">
            {enriched.length === 0
              ? "No pending tasks for the current filter."
              : "No employees match the current selection."}
          </p>
        ) : transposed ? (
          <TransposedAging rows={top12} onOpen={(id) => router.push(`/tasks?emp=${id}` as Route)} />
        ) : (
          <div className="mt-2">
            <LaneHeader sortMode={sortMode} onSort={setSortMode} />
            {top12.map((r, i) => (
              <Lane
                key={r.employeeId}
                row={r}
                maxTotal={maxTotal}
                index={i}
                employeeTasks={cellTasks[r.employeeId] ?? {}}
                employeeHidden={hiddenCells[r.employeeId] ?? {}}
              />
            ))}
          </div>
        )}
      </div>
    </SectionHeader>
  );
}

/** People across the top, the age ranges (oldest first), risk and total down the side. */
function TransposedAging({
  rows,
  onOpen,
}: {
  rows: (AgingRow & { risk: number })[];
  onOpen: (employeeId: string) => void;
}) {
  const buckets = [...AGE_BUCKETS].reverse();
  return (
    <div className="kanban-scroll mt-2 overflow-x-auto">
      <table className="w-full border-collapse" style={{ minWidth: 180 + rows.length * 110 }}>
        <thead>
          <tr className="border-b border-hairline">
            <th className="px-3 py-2 text-left text-[12px] font-bold uppercase tracking-[0.08em] text-ink-strong">Age</th>
            {rows.map((r) => (
              <th key={r.employeeId} className="px-3 py-2 text-center whitespace-nowrap">
                <button type="button" onClick={() => onOpen(r.employeeId)} className="inline-flex flex-col items-center gap-1 hover:underline">
                  <EmployeeAvatar name={r.employeeName} size="sm" />
                  <span className="text-[12.5px] font-bold text-ink-strong">{r.employeeName.split(/s+/)[0]}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-b border-[#EEF1F6]">
            <td className="px-3 py-1.5 text-[13px] font-bold text-ink-strong">Risk</td>
            {rows.map((r) => (
              <td key={r.employeeId} className="px-3 py-1.5 text-center"><RiskChip score={r.risk} /></td>
            ))}
          </tr>
          {buckets.map((b) => {
            const c = BUCKET_COLOR[b.id];
            return (
              <tr key={b.id} className="border-b border-[#EEF1F6]">
                <td className="px-3 py-1.5">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-0.5 text-[12px] font-bold tabular-nums"
                    style={{ background: c.tint, color: c.deep, border: `1px solid ${c.light}` }}
                  >
                    <span className="inline-block size-2 rounded-full" style={{ background: c.fill }} />
                    {b.id}d
                  </span>
                </td>
                {rows.map((r) => {
                  const v = r.buckets[b.id];
                  return (
                    <td key={r.employeeId} className="px-3 py-1.5 text-center">
                      {v === 0 ? (
                        <span className="text-[14px] tabular-nums text-[#c3cad6]">0</span>
                      ) : (
                        <span
                          className="inline-flex min-w-8 items-center justify-center rounded-md px-2 py-0.5 text-[14px] font-bold tabular-nums"
                          style={{ background: c.tint, color: c.deep }}
                        >
                          {v}
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          <tr>
            <td className="px-3 py-1.5 text-[13px] font-bold text-ink-strong">Total</td>
            {rows.map((r) => (
              <td key={r.employeeId} className="px-3 py-1.5 text-center text-[15px] font-extrabold tabular-nums text-ink-strong">
                {r.total}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

/** "Sort by: Risk ⌄" — the same three sorts, as a dropdown. */
function SortMenu({ value, onChange }: { value: SortMode; onChange: (m: SortMode) => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Sort aging table"
          className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-hairline-strong bg-white px-3 text-[13px] font-semibold text-ink-strong outline-none transition-colors hover:bg-surface-soft focus-visible:ring-2 focus-visible:ring-[#0A6CFF]/40"
        >
          <ArrowDownUp size={14} className="text-ink-subtle" />
          Sort by: {SORT_LABELS[value]}
          <ChevronDown size={13} className="text-ink-subtle" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-[160px]">
        {(Object.keys(SORT_LABELS) as SortMode[]).map((m) => (
          <DropdownMenuItem
            key={m}
            onSelect={() => onChange(m)}
            className="justify-between text-[13px] font-medium"
          >
            {SORT_LABELS[m]}
            {value === m && <Check size={14} strokeWidth={2.4} className="text-[#0A6CFF]" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Search as an icon button that opens into the usual search box. */
function SearchToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = React.useState(false);
  if (open || value) {
    return (
      <div
        onBlur={(e) => {
          if (!value && !e.currentTarget.contains(e.relatedTarget)) setOpen(false);
        }}
      >
        <SearchBox value={value} onChange={onChange} />
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Search employees"
      title="Search employees"
      className="inline-flex size-9 items-center justify-center rounded-[10px] border border-hairline-strong bg-white text-ink-soft transition-colors hover:bg-surface-soft hover:text-ink-strong"
    >
      <Search size={16} strokeWidth={2.2} />
    </button>
  );
}

function AlertBanner({ count }: { count: number }) {
  return (
    <div
      className="mb-2 flex items-center gap-2.5 rounded-lg px-3 py-2"
      style={{ background: "#FEECEC", borderLeft: "3px solid #dc2626" }}
      role="status"
    >
      <AlertTriangle className="size-4 shrink-0" style={{ color: "#dc2626" }} />
      <p className="text-[13px] text-ink-soft">
        <span className="font-bold tabular-nums text-ink-strong">{count}</span>{" "}
        {count === 1 ? "task is" : "tasks are"} aging more than 30 days — escalate or close
      </p>
    </div>
  );
}

function Legend({
  counts,
  active,
  onToggle,
}: {
  counts: Record<AgeBucketId, number>;
  active: AgeBucketId[];
  onToggle: (id: AgeBucketId) => void;
}) {
  // Oldest first, as the reference reads.
  const buckets = [...AGE_BUCKETS].reverse();
  return (
    <div className="flex flex-wrap items-center gap-1.5 border-b border-hairline pb-2.5">
      <span
        className="mr-1 text-[11.5px] font-bold uppercase tracking-[0.1em] text-ink-subtle"
        style={{ fontFamily: "var(--font-mono-display), ui-monospace, monospace" }}
      >
        Age:
      </span>
      {buckets.map((b) => {
        const c = BUCKET_COLOR[b.id];
        const on = active.includes(b.id);
        return (
          <button
            key={b.id}
            type="button"
            onClick={() => onToggle(b.id)}
            aria-pressed={on}
            title={`Show people with tasks aged ${b.id} days`}
            className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 text-[12px] font-bold tabular-nums outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-[#0A6CFF]/40"
            style={{
              background: c.tint,
              color: c.deep,
              border: `1px solid ${on ? c.deep : c.light}`,
              boxShadow: on ? `0 0 0 2px ${c.light}` : "none",
            }}
          >
            <span className="inline-block size-2 rounded-full" style={{ background: c.fill }} />
            {b.id}d <span className="font-semibold opacity-70">({counts[b.id]})</span>
          </button>
        );
      })}
    </div>
  );
}

const LANE_COLUMNS = "minmax(150px, 240px) 72px 1fr 56px 24px";

function LaneHeader({ sortMode, onSort }: { sortMode: SortMode; onSort: (m: SortMode) => void }) {
  const base =
    "text-[12px] font-bold uppercase tracking-[0.08em] text-ink-strong";
  const mono = { fontFamily: "var(--font-mono-display), ui-monospace, monospace" } as const;
  const sortBtn = (mode: SortMode, label: string) => (
    <button
      type="button"
      onClick={() => onSort(mode)}
      aria-label={`Sort by ${label}`}
      className={`inline-flex items-center gap-1 ${base} hover:text-ink-soft`}
      style={mono}
    >
      {label}
      <ChevronsUpDown size={12} strokeWidth={2.4} className={sortMode === mode ? "text-ink-strong" : "text-ink-subtle"} aria-hidden />
    </button>
  );
  return (
    <div
      className="grid items-center gap-3 border-b border-hairline px-2 py-2 max-md:hidden"
      style={{ gridTemplateColumns: LANE_COLUMNS }}
    >
      <span className={base} style={mono}>Employee</span>
      <span className="justify-self-center">{sortBtn("risk", "Risk")}</span>
      <span className={base} style={mono}>Pending by age (oldest →)</span>
      <span className="justify-self-end">{sortBtn("total", "Total")}</span>
      <span aria-hidden />
    </div>
  );
}

function Lane({
  row,
  maxTotal,
  index,
  employeeTasks,
  employeeHidden,
}: {
  row: AgingRow & { risk: number };
  maxTotal: number;
  index: number;
  employeeTasks: Record<string, HeatmapCellTask[]>;
  employeeHidden: Record<string, number>;
}) {
  const router = useRouter();
  const lengthPct = (row.total / maxTotal) * 100;
  const target = `/tasks?emp=${row.employeeId}` as Route;

  return (
    <div
      role="link"
      tabIndex={0}
      aria-label={`Open ${row.employeeName}'s aging tasks (risk ${row.risk}, ${row.total} pending)`}
      onClick={() => router.push(target)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(target);
        }
      }}
      // Tier-3 mobile fix — below md the grid collapses to a stacked layout via
      // `aging-lane-mobile` (globals.css), so nothing overflows at 390px.
      className="aging-lane aging-lane-mobile grid items-center gap-3 border-b border-[#EEF1F6] px-2 py-1.5 transition-colors last:border-b-0 hover:bg-[#F7F9FD] max-md:gap-2 max-md:py-2"
      style={{
        gridTemplateColumns: LANE_COLUMNS,
        opacity: 0,
        animation: `fadeUp 420ms ease-out ${index * 40 + 120}ms forwards`,
        cursor: "pointer",
      }}
    >
      {/* Employee — avatar + name */}
      <div className="flex min-w-0 items-center gap-2.5">
        <EmployeeAvatar name={row.employeeName} size="sm" />
        <span className="truncate text-[14px] font-bold text-ink-strong">{row.employeeName}</span>
      </div>

      {/* Risk score */}
      <RiskChip score={row.risk} />

      {/* Heat bar */}
      <div className="relative h-6 overflow-hidden rounded-md bg-[#F1F4F9]">
        <div
          className="absolute inset-y-0 left-0 flex"
          style={{
            width: `${lengthPct}%`,
            transition: "width 600ms cubic-bezier(0.16, 1, 0.3, 1)",
          }}
        >
          {AGE_BUCKETS.map((b) => {
            const v = row.buckets[b.id];
            if (v === 0) return null;
            const segPct = (v / row.total) * 100;
            return (
              <Segment
                key={b.id}
                bucketId={b.id}
                bucketLabel={b.label}
                count={v}
                widthPct={segPct}
                employeeName={row.employeeName}
                tasks={employeeTasks[b.id] ?? []}
                hidden={employeeHidden[b.id] ?? 0}
              />
            );
          })}
        </div>
      </div>

      {/* Total */}
      <span className="text-right text-[16px] font-extrabold tabular-nums text-ink-strong">{row.total}</span>

      {/* Chevron — telegraphs click target */}
      <span
        className="aging-lane-chevron inline-flex items-center justify-center"
        aria-hidden
        style={{ color: "var(--color-ink-subtle)" }}
      >
        <ChevronRight size={18} strokeWidth={2.4} />
      </span>
    </div>
  );
}

function RiskChip({ score }: { score: number }) {
  const palette =
    score >= 60
      ? { bg: "#FEE2E2", fg: "#991B1B" }
      : score >= 35
        ? { bg: "#FEF3C7", fg: "#92400E" }
        : { bg: "#DCFCE7", fg: "#166534" };
  return (
    <span
      className="mx-auto inline-flex min-w-[40px] items-center justify-center rounded-md px-2 py-0.5 text-[13px] font-bold tabular-nums"
      style={{ background: palette.bg, color: palette.fg }}
      title={`Aging risk score: ${score}/100`}
    >
      {score}
    </span>
  );
}

function Segment({
  bucketId,
  bucketLabel,
  count,
  widthPct,
  employeeName,
  tasks,
  hidden,
}: {
  bucketId: AgeBucketId;
  bucketLabel: string;
  count: number;
  widthPct: number;
  employeeName: string;
  tasks: HeatmapCellTask[];
  /** Tasks in this cell the viewer may not open (private to someone else). */
  hidden: number;
}) {
  const c = BUCKET_COLOR[bucketId];
  const showLabel = widthPct > 8;
  const isCritical = CRITICAL_BUCKETS.includes(bucketId);

  const [open, setOpen] = React.useState(false);
  const contentRef = React.useRef<HTMLDivElement | null>(null);
  // Close the panel when the PAGE scrolls — once the bar it anchors to scrolls
  // away, a detached floating popover is confusing. Capture phase is needed to
  // catch scrolls in nested containers, but that also catches the popover's own
  // task list, which used to dismiss the panel the moment you tried to reach
  // the tasks at the bottom of it. Scrolls originating inside the content are
  // therefore ignored.
  React.useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      const target = e.target as Node | null;
      if (target && contentRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", close, true);
    return () => window.removeEventListener("scroll", close, true);
  }, [open]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          // Crucial: keep the segment click from bubbling up to the lane's
          // navigation handler so the popover opens instead of redirecting.
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") e.stopPropagation();
          }}
          className="aging-segment h-full flex items-center justify-center text-white transition-all duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 hover:brightness-110 hover:scale-y-110 origin-bottom"
          style={{
            width: `${widthPct}%`,
            background: `linear-gradient(180deg, ${c.light}, ${c.fill})`,
            minWidth: 0,
            outlineColor: c.deep,
            animation: isCritical
              ? "heatPulse 2.4s ease-in-out infinite"
              : "none",
            fontFamily: "var(--font-display), system-ui, sans-serif",
            fontWeight: 800,
            fontSize: 13,
            textShadow: "0 1px 2px rgba(0,0,0,0.28)",
          }}
          aria-label={`${employeeName}, ${bucketLabel}: ${count} pending`}
        >
          {showLabel && <span className="tabular-nums">{count}</span>}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          ref={contentRef}
          side="top"
          align="center"
          sideOffset={10}
          collisionPadding={12}
          className="z-[100] bg-surface-card border rounded-section overflow-hidden max-h-[var(--radix-popover-content-available-height)] flex flex-col"
          style={{
            borderColor: c.deep,
            borderWidth: 2,
            boxShadow:
              "0 24px 56px -16px rgba(15, 23, 42, 0.24), 0 8px 24px -8px rgba(15, 23, 42, 0.14)",
            // Fixed, bounded width so a long task title can never stretch the
            // popover off-screen — titles wrap inside instead. Never exceeds
            // the viewport minus the 12px collision gutter on each side.
            width: "min(420px, calc(100vw - 24px))",
            maxWidth: "calc(100vw - 24px)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header — coloured band with the bucket label */}
          <div
            className="px-5 py-4 shrink-0"
            style={{
              background: `linear-gradient(135deg, ${c.fill}, ${c.deep})`,
              color: "#ffffff",
            }}
          >
            <p
              className="font-black leading-tight"
              style={{
                fontFamily: "var(--font-display), system-ui, sans-serif",
                fontSize: 22,
                letterSpacing: "-0.01em",
              }}
            >
              {employeeName}
            </p>
            <p
              className="uppercase tracking-[0.12em] font-bold mt-1.5 opacity-95"
              style={{
                fontFamily: "var(--font-mono-display), ui-monospace, monospace",
                fontSize: 13,
              }}
            >
              {bucketLabel} · {tasks.length}{" "}
              {tasks.length === 1 ? "task" : "tasks"}
            </p>
          </div>

          {/* Task list — each title wraps to 2 lines (with long URLs/emails
              broken) so nothing spills out of the popover. The list scrolls
              when there are many tasks. */}
          <ul className="flex flex-col flex-1 min-h-0 p-2 overflow-y-auto bg-surface-card">
            {tasks.length === 0 && (
              <li
                className="py-4 px-3 font-semibold"
                style={{ fontSize: 16, color: "var(--color-ink-muted)" }}
              >
                {hidden > 0
                  ? `${hidden} ${hidden === 1 ? "task" : "tasks"} — private to ${employeeName}.`
                  : "No tasks."}
              </li>
            )}
            {tasks.map((t) => (
              <li key={t.id}>
                <Link
                  href={`/tasks/${t.id}` as Route}
                  className="aging-popover-row flex items-start justify-between gap-3 py-3 px-3 rounded-chip transition-colors"
                >
                  <span
                    className="text-ink-strong font-bold min-w-0"
                    style={{
                      fontSize: 15.5,
                      lineHeight: 1.4,
                      overflowWrap: "anywhere",
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {t.title}
                  </span>
                  <span
                    className="tabular-nums font-black shrink-0 rounded-pill px-2.5 py-1 mt-0.5"
                    style={{
                      fontFamily: "var(--font-display), system-ui, sans-serif",
                      fontSize: 15,
                      color: c.deep,
                      background: c.tint,
                      border: `1px solid ${c.light}`,
                    }}
                  >
                    {t.ageDays}d
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          {/* The bar counts every pending task; the list above only shows the
              ones this viewer may open. Say so rather than letting a "6" bar
              quietly render one row. */}
          {tasks.length > 0 && hidden > 0 && (
            <p
              className="shrink-0 px-5 py-2.5 font-semibold"
              style={{
                fontSize: 13.5,
                color: "var(--color-ink-subtle)",
                borderTop: "1px solid var(--color-hairline)",
                background: "var(--color-surface-soft)",
              }}
            >
              +{hidden} more private to {employeeName}
            </p>
          )}
          <Popover.Arrow style={{ fill: c.deep }} width={14} height={8} />
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
