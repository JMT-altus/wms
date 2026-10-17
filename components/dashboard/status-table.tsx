"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Search, X, Users, ChevronsUpDown, ChevronUp, ChevronDown, ArrowLeftRight } from "lucide-react";
import type { EmployeeStatusRow, ViewMode } from "@/lib/types";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";
import { SectionHeader } from "./section-header";
import { SectionShareActions, type SectionReportInput } from "./section-share";

/** One numeric column of the table: where the count comes from and the colour
 *  it wears once it isn't zero. Order here is the order on screen. */
interface StatusColumn {
  key: keyof EmployeeStatusRow;
  label: string;
  tone: "green" | "red" | "amber" | "blue" | "purple" | "slate" | null;
}

const COLUMNS: StatusColumn[] = [
  { key: "approved", label: "Approved", tone: "green" },
  { key: "notApproved", label: "Not Approved", tone: "red" },
  { key: "done", label: "Done", tone: "green" },
  { key: "followUp", label: "Follow Up", tone: "amber" },
  { key: "needHelp", label: "Need Info", tone: "blue" },
  { key: "initiated", label: "Initiated", tone: "amber" },
  { key: "notStarted", label: "Not Started", tone: "purple" },
  { key: "criticalCount", label: "Critical", tone: "red" },
  // Total is the row's sum, not a status — it reads as plain bold text so it
  // doesn't compete with the coloured counts it adds up.
  { key: "total", label: "Total", tone: null },
];

const MONO = { fontFamily: "var(--font-mono-display), ui-monospace, monospace" } as const;

/** A count in the grid. Zero stays grey and flat: on a wide table most cells
 *  are zero, and colouring them would drown the handful that matter. */
function Count({ value, tone }: { value: number; tone: StatusColumn["tone"] }) {
  if (value === 0) {
    return <span className="text-[14px] tabular-nums text-ink-subtle/70" style={MONO}>0</span>;
  }
  if (tone === null) {
    return <span className="text-[14px] font-bold tabular-nums text-ink-strong" style={MONO}>{value}</span>;
  }
  return (
    <span
      className="inline-flex min-w-8 items-center justify-center rounded-md px-2 py-0.5 text-[14px] font-bold tabular-nums"
      style={{
        ...MONO,
        color: `var(--color-${tone}-deep)`,
        background: `color-mix(in srgb, var(--color-${tone}) 14%, #ffffff)`,
      }}
    >
      {value}
    </span>
  );
}

type SortKey = "employeeName" | keyof EmployeeStatusRow;

export function StatusTable({
  rows,
  view,
}: {
  rows: EmployeeStatusRow[];
  view: ViewMode;
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [team, setTeam] = React.useState<string | null>(null);
  const [collapsed, setCollapsed] = React.useState(false);
  const [transposed, setTransposed] = React.useState(false);
  const [sort, setSort] = React.useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "total",
    dir: "desc",
  });

  const title = `Status by ${view === "doer" ? "Doer" : "Initiator"}`;

  const hrefFor = React.useCallback(
    (employeeId: string): Route => {
      const viewParam = view === "initiator" ? "&view=initiator" : "";
      return `/tasks?emp=${employeeId}${viewParam}` as Route;
    },
    [view],
  );

  // Teams = the departments present in the data, plus an "Others" bucket for
  // people who aren't in one. Counted so each tab says how many it holds
  // before you click it.
  const teams = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const name = r.department?.trim() || "Others";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    // "Others" last; everything else alphabetical.
    return Array.from(counts.entries()).sort(([a], [b]) =>
      a === "Others" ? 1 : b === "Others" ? -1 : a.localeCompare(b),
    );
  }, [rows]);

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (team && (r.department?.trim() || "Others") !== team) return false;
      if (q && !r.employeeName.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, query, team]);

  const sorted = React.useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      if (sort.key === "employeeName") {
        return a.employeeName.localeCompare(b.employeeName) * dir;
      }
      const av = a[sort.key];
      const bv = b[sort.key];
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [filtered, sort]);

  function toggleSort(key: SortKey) {
    setSort((cur) =>
      cur.key === key
        ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
        : // Names read A→Z first; counts are only interesting biggest-first.
          { key, dir: key === "employeeName" ? "asc" : "desc" },
    );
  }

  // The section as a grid of strings — what gets typeset into the shared PDF.
  // Built on demand so it always matches the current team tab, search and sort.
  const buildReport = React.useCallback(
    (): SectionReportInput => ({
      title,
      subtitle: `${sorted.length} ${sorted.length === 1 ? "person" : "people"}`,
      context: [team ? `Team: ${team}` : null, query.trim() ? `Search: ${query.trim()}` : null]
        .filter(Boolean)
        .join(" · "),
      columns: ["Employee", ...COLUMNS.map((c) => c.label)],
      rows: sorted.map((r) => [
        r.employeeName,
        ...COLUMNS.map((c) => String(r[c.key] ?? 0)),
      ]),
    }),
    [sorted, title, team, query],
  );

  return (
    <SectionHeader
      id="status-by-doer"
      icon={<Users size={18} strokeWidth={2.2} />}
      tone="blue"
      title={title}
      collapsed={collapsed}
      onToggle={() => setCollapsed((v) => !v)}
      actions={
        <>
          <SectionShareActions title={title} buildReport={buildReport} />
          <button
            type="button"
            onClick={() => setTransposed((v) => !v)}
            aria-pressed={transposed}
            aria-label="Transpose"
            title="Transpose"
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
        {/* Team tabs */}
        <div
          className="mb-2 flex flex-wrap items-center gap-x-1 gap-y-0.5 rounded-xl p-1"
          style={{ background: "#EEF3FB" }}
          role="tablist"
          aria-label="Teams"
        >
          <TeamTab compact label="All Employees" count={rows.length} active={team === null} onClick={() => setTeam(null)} />
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

        {sorted.length === 0 ? (
          <p className="px-2 py-10 text-center text-[14px] text-ink-subtle">
            {rows.length === 0
              ? "No data for the current filter."
              : "No employees match your search."}
          </p>
        ) : transposed ? (
          <TransposedGrid rows={sorted} onOpen={(id) => router.push(hrefFor(id))} />
        ) : (
          <div className="kanban-scroll overflow-x-auto rounded-chip border border-hairline">
            <table className="w-full min-w-[880px] border-collapse">
              <thead>
                <tr className="border-b border-hairline">
                  <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left">
                    <SortButton
                      label="Employee"
                      active={sort.key === "employeeName"}
                      dir={sort.dir}
                      onClick={() => toggleSort("employeeName")}
                    />
                  </th>
                  {COLUMNS.map((c) => (
                    <th key={String(c.key)} className="px-3 py-2 text-right whitespace-nowrap">
                      <SortButton
                        label={c.label}
                        active={sort.key === c.key}
                        dir={sort.dir}
                        onClick={() => toggleSort(c.key)}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr
                    key={r.employeeId}
                    role="link"
                    tabIndex={0}
                    aria-label={`Open ${r.employeeName}'s tasks`}
                    onClick={() => router.push(hrefFor(r.employeeId))}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        router.push(hrefFor(r.employeeId));
                      }
                    }}
                    className="status-doer-row cursor-pointer border-b border-hairline last:border-b-0"
                  >
                    <td className="status-doer-name sticky left-0 z-10 bg-white px-3 py-1.5 whitespace-nowrap">
                      <span className="inline-flex items-center gap-3">
                        <EmployeeAvatar name={r.employeeName} size="md" />
                        <span className="text-[14.5px] font-bold text-ink-strong">
                          {r.employeeName}
                        </span>
                      </span>
                    </td>
                    {COLUMNS.map((c) => (
                      <td key={String(c.key)} className="px-3 py-1.5 text-right whitespace-nowrap">
                        <Count value={r[c.key] as number} tone={c.tone} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SectionHeader>
  );
}

/** Statuses down the side, people across the top — the same grid read the
 *  other way, for when the question is "who has follow-ups?" rather than
 *  "what does this person have?". */
function TransposedGrid({
  rows,
  onOpen,
}: {
  rows: EmployeeStatusRow[];
  onOpen: (employeeId: string) => void;
}) {
  return (
    <div className="kanban-scroll overflow-x-auto rounded-chip border border-hairline">
      <table className="w-full border-collapse" style={{ minWidth: 220 + rows.length * 132 }}>
        <thead>
          <tr className="border-b border-hairline">
            <th className="sticky left-0 z-10 bg-white px-3 py-2 text-left text-[13px] font-bold text-ink-strong">
              Status
            </th>
            {rows.map((r) => (
              <th key={r.employeeId} className="px-3 py-2 text-center whitespace-nowrap">
                <button
                  type="button"
                  onClick={() => onOpen(r.employeeId)}
                  className="inline-flex flex-col items-center gap-1.5 hover:underline"
                >
                  <EmployeeAvatar name={r.employeeName} size="sm" />
                  <span className="text-[12.5px] font-bold text-ink-strong">
                    {r.employeeName.split(/\s+/)[0]}
                  </span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {COLUMNS.map((c) => (
            <tr key={String(c.key)} className="border-b border-hairline last:border-b-0">
              <td className="sticky left-0 z-10 bg-white px-3 py-1.5 text-[13.5px] font-bold whitespace-nowrap text-ink-strong">
                {c.label}
              </td>
              {rows.map((r) => (
                <td key={r.employeeId} className="px-3 py-1.5 text-center">
                  <Count value={r[c.key] as number} tone={c.tone} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SortButton({
  label,
  active,
  dir,
  onClick,
}: {
  label: string;
  active: boolean;
  dir: "asc" | "desc";
  onClick: () => void;
}) {
  const Icon = !active ? ChevronsUpDown : dir === "asc" ? ChevronUp : ChevronDown;
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-[13.5px] font-bold whitespace-nowrap text-ink-strong transition-colors hover:text-ink-soft"
      aria-label={`Sort by ${label}`}
    >
      {label}
      <Icon size={13} strokeWidth={2.4} className={active ? "text-ink-strong" : "text-ink-subtle"} aria-hidden />
    </button>
  );
}

export function TeamTab({
  label,
  count,
  active,
  onClick,
  compact = false,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  /** Smaller type and padding, for a strip that spans the card. */
  compact?: boolean;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center rounded-pill font-semibold whitespace-nowrap transition-all ${
        compact ? "gap-1.5 px-2.5 py-1 text-[12px]" : "gap-2 px-3.5 py-1.5 text-[13.5px]"
      }`}
      style={{
        background: active ? "#ffffff" : "transparent",
        color: active ? "var(--color-ink-strong)" : "var(--color-ink-soft)",
        boxShadow: active ? "0 1px 3px rgba(15,23,42,0.12)" : "none",
      }}
    >
      {label}
      <span
        className="inline-flex min-w-5 items-center justify-center rounded-pill px-1.5 py-0.5 text-[11.5px] font-bold tabular-nums"
        style={{
          background: active ? "#eef0f3" : "rgba(15,23,42,0.06)",
          color: "var(--color-ink-soft)",
        }}
      >
        {count}
      </span>
    </button>
  );
}

export function SearchBox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative flex h-9 min-w-[200px] items-center rounded-[10px] border border-hairline-strong bg-white pl-2.5 pr-1.5 max-lg:min-w-[150px]">
      <Search size={15} className="shrink-0 text-ink-subtle" aria-hidden />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search employees"
        aria-label="Search employees"
        className="min-w-0 flex-1 border-0 bg-transparent px-2 text-[13.5px] text-ink outline-none placeholder:text-ink-subtle"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Clear search"
          className="inline-flex size-5 items-center justify-center rounded-full text-ink-subtle transition-colors hover:text-ink-strong"
        >
          <X size={13} strokeWidth={2.6} />
        </button>
      )}
    </div>
  );
}

/** Search as an icon button that opens into the usual search box. */
export function SearchToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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
