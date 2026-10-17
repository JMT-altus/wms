"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { ArrowLeftRight, Search, XCircle } from "lucide-react";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";
import type { DashboardInsights } from "@/lib/types";
import { SectionHeader } from "./section-header";
import { SectionShareActions, type SectionReportInput } from "./section-share";
import { SearchBox, SortButton, TeamTab } from "./status-table";

type Row = DashboardInsights["sentBack"][number];
type SortKey = "name" | "b15" | "b8" | "b4" | "b1" | "sentBack";

const COLS: { key: Exclude<SortKey, "name">; label: string }[] = [
  { key: "b15", label: "15+" },
  { key: "b8", label: "8–14" },
  { key: "b4", label: "4–7" },
  { key: "b1", label: "1–3" },
  { key: "sentBack", label: "Sent back" },
];

const TITLE = "Sent-Back Work, by Person and by How Overdue";

function Cell({ value, strong = false }: { value: number; strong?: boolean }) {
  if (value === 0) return <span className="text-[14px] tabular-nums text-[#c3cad6]">0</span>;
  return (
    <span
      className="text-[15px] font-bold tabular-nums"
      style={{
        color: strong ? "#9b1c1c" : "#e11d1d",
        fontFamily: "var(--font-mono-display), ui-monospace, monospace",
      }}
    >
      {value}
    </span>
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

/**
 * Sent-Back Work — tasks declined (Not approved) and sent back to the doer,
 * per person and by how overdue they are. Same layout as Overdue Tasks by
 * Person: department tabs, search, sortable columns, PDF share and the
 * rows/columns switch. A row opens that person's tasks.
 */
export function SentBackWork({ rows }: { rows: DashboardInsights["sentBack"] }) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [team, setTeam] = React.useState<string | null>(null);
  const [collapsed, setCollapsed] = React.useState(false);
  const [transposed, setTransposed] = React.useState(false);
  const [sort, setSort] = React.useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "sentBack",
    dir: "desc",
  });

  const teams = React.useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const name = r.department.trim() || "Others";
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }
    return Array.from(counts.entries()).sort(([a], [b]) =>
      a === "Others" ? 1 : b === "Others" ? -1 : a.localeCompare(b),
    );
  }, [rows]);

  const sorted = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const dir = sort.dir === "asc" ? 1 : -1;
    return rows
      .filter((r) => {
        if (team && (r.department.trim() || "Others") !== team) return false;
        if (q && !r.name.toLowerCase().includes(q)) return false;
        return true;
      })
      .sort((a, b) =>
        sort.key === "name" ? a.name.localeCompare(b.name) * dir : (a[sort.key] - b[sort.key]) * dir,
      );
  }, [rows, query, team, sort]);

  function toggleSort(key: SortKey) {
    setSort((cur) =>
      cur.key === key
        ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "name" ? "asc" : "desc" },
    );
  }

  const buildReport = React.useCallback(
    (): SectionReportInput => ({
      title: TITLE,
      subtitle: `${sorted.length} ${sorted.length === 1 ? "person" : "people"}`,
      context: [team ? `Team: ${team}` : null, query.trim() ? `Search: ${query.trim()}` : null]
        .filter(Boolean)
        .join(" · "),
      columns: ["Person", ...COLS.map((c) => c.label)],
      rows: sorted.map((r) => [r.name, ...COLS.map((c) => String(r[c.key]))]),
    }),
    [sorted, team, query],
  );

  const open = (id: string) => router.push(`/tasks?emp=${id}&status=not_approved` as Route);

  return (
    <SectionHeader
      id="sent-back-work"
      icon={<XCircle size={18} strokeWidth={2.2} />}
      tone="blue"
      title={TITLE}
      collapsed={collapsed}
      onToggle={() => setCollapsed((v) => !v)}
      actions={
        <>
          <SectionShareActions title={TITLE} buildReport={buildReport} />
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
        className="rounded-section p-2.5 max-md:p-2"
        style={{
          background: "#ffffff",
          border: "1px solid var(--color-hairline-strong)",
          boxShadow: "0 1px 2px rgba(15, 23, 42, 0.05), 0 8px 24px -16px rgba(15, 23, 42, 0.16)",
        }}
      >
        {rows.length === 0 ? (
          <div className="mx-auto flex max-w-[460px] flex-col items-center px-4 py-10 text-center">
            <span className="inline-flex size-12 items-center justify-center rounded-full bg-[#EEF1F6] text-ink-soft">
              <XCircle size={22} strokeWidth={2.2} aria-hidden />
            </span>
            <p className="mt-4 text-[17px] font-bold text-ink-strong">No tasks awaiting re-work</p>
            <p className="mt-2 text-[12.5px] font-medium leading-relaxed text-ink-subtle">
              Nothing has been sent back for correction. When an admin declines a task it appears here,
              by person and by how overdue it is.
            </p>
          </div>
        ) : (
          <>
            <div
              className="mb-1.5 flex flex-wrap items-center gap-x-1 gap-y-0.5 rounded-xl p-1"
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
              <p className="px-2 py-10 text-center text-[14px] text-ink-subtle">No employees match your search.</p>
            ) : transposed ? (
              <div className="kanban-scroll overflow-x-auto">
                <table className="w-full border-collapse" style={{ minWidth: 200 + sorted.length * 120 }}>
                  <thead>
                    <tr className="border-b border-hairline">
                      <th className="px-3 py-2 text-left text-[13px] font-bold text-ink-strong">Measure</th>
                      {sorted.map((r) => (
                        <th key={r.employeeId} className="px-3 py-2 text-center whitespace-nowrap">
                          <button type="button" onClick={() => open(r.employeeId)} className="inline-flex flex-col items-center gap-1 hover:underline">
                            <EmployeeAvatar name={r.name} size="sm" />
                            <span className="text-[12.5px] font-bold text-ink-strong">{r.name.split(/\s+/)[0]}</span>
                          </button>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {COLS.map((c) => (
                      <tr key={c.key} className="border-b border-[#EEF1F6] last:border-b-0">
                        <td className="px-3 py-1.5 text-[13px] font-bold whitespace-nowrap text-ink-strong">{c.label}</td>
                        {sorted.map((r) => (
                          <td key={r.employeeId} className="px-3 py-1.5 text-center">
                            <Cell value={r[c.key]} strong={c.key === "sentBack"} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="kanban-scroll overflow-x-auto">
                <table className="w-full min-w-[640px] border-separate border-spacing-y-1">
                  <thead>
                    <tr>
                      <th className="border-b border-hairline px-3 py-2 text-left">
                        <SortButton label="Person" active={sort.key === "name"} dir={sort.dir} onClick={() => toggleSort("name")} />
                      </th>
                      {COLS.map((c) => (
                        <th key={c.key} className="border-b border-hairline px-3 py-2 text-center whitespace-nowrap">
                          <SortButton label={c.label} active={sort.key === c.key} dir={sort.dir} onClick={() => toggleSort(c.key)} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r: Row) => (
                      <tr
                        key={r.employeeId}
                        role="link"
                        tabIndex={0}
                        aria-label={`Open ${r.name}'s sent-back tasks`}
                        onClick={() => open(r.employeeId)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            open(r.employeeId);
                          }
                        }}
                        className="group cursor-pointer"
                      >
                        <td className="rounded-l-xl bg-[#F6F8FC] px-3 py-1.5 whitespace-nowrap group-hover:bg-[#EEF3FB]">
                          <span className="inline-flex items-center gap-3">
                            <EmployeeAvatar name={r.name} size="sm" />
                            <span className="leading-tight">
                              <span className="block text-[14px] font-bold text-ink-strong">{r.name}</span>
                              <span className="block text-[11.5px] font-semibold text-ink-subtle">
                                {r.pct}% of {r.total} {r.total === 1 ? "task" : "tasks"}
                              </span>
                            </span>
                          </span>
                        </td>
                        {COLS.map((c, i) => (
                          <td
                            key={c.key}
                            className={`bg-[#F6F8FC] px-3 py-1.5 text-center group-hover:bg-[#EEF3FB] ${
                              i === COLS.length - 1 ? "rounded-r-xl" : ""
                            }`}
                          >
                            <Cell value={r[c.key]} strong={c.key === "sentBack"} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </SectionHeader>
  );
}
