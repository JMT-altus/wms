"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { ArrowLeftRight, Search, Users } from "lucide-react";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";
import type { DashboardInsights } from "@/lib/types";
import { SectionHeader } from "./section-header";
import { SectionShareActions, type SectionReportInput } from "./section-share";
import { SearchBox, SortButton, TeamTab } from "./status-table";

type Row = DashboardInsights["overdueByPerson"][number];
type SortKey = "name" | "onTimePct" | "b15" | "b8" | "b4" | "b1" | "overdue";

const COLS: { key: SortKey; label: string }[] = [
  { key: "b15", label: "15+" },
  { key: "b8", label: "8–14" },
  { key: "b4", label: "4–7" },
  { key: "b1", label: "1–3" },
  { key: "overdue", label: "Late" },
];

const TITLE = "Overdue Tasks by Person";

/** The on-time bar: JMT blue, switching to the warning red when most finished work was late. */
function rateTone(pct: number | null) {
  if (pct == null) return { fill: "#cbd5e1", text: "var(--color-ink-subtle)" };
  if (pct < 50) return { fill: "#b91c1c", text: "#b91c1c" };
  return { fill: "#0A6CFF", text: "#0B4FB8" };
}

/** Search as an icon button that opens into the usual search box. */
function SearchToggle({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = React.useState(false);
  if (open || value) {
    return (
      <div onBlur={(e) => { if (!value && !e.currentTarget.contains(e.relatedTarget)) setOpen(false); }}>
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

/**
 * Overdue Tasks by Person — open tasks past their due date, per doer: the
 * person with their finished-work count, their on-time rate, how late the
 * overdue ones are (15+ / 8–14 / 4–7 / 1–3 days) and the total. Department
 * tabs, search, sortable columns and the PDF share sit on top, like Status by
 * Doer. A row opens that person's tasks.
 */
export function OverdueByPerson({ rows }: { rows: DashboardInsights["overdueByPerson"] }) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [team, setTeam] = React.useState<string | null>(null);
  const [collapsed, setCollapsed] = React.useState(false);
  const [transposed, setTransposed] = React.useState(false);
  const [sort, setSort] = React.useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "overdue",
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
      .sort((a, b) => {
        if (sort.key === "name") return a.name.localeCompare(b.name) * dir;
        const av = sort.key === "onTimePct" ? (a.onTimePct ?? -1) : a[sort.key];
        const bv = sort.key === "onTimePct" ? (b.onTimePct ?? -1) : b[sort.key];
        return (av - bv) * dir;
      });
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
      columns: ["Person", "Done", "On-time rate", ...COLS.map((c) => c.label)],
      rows: sorted.map((r) => [
        r.name,
        String(r.delivered),
        r.onTimePct == null ? "" : `${r.onTimePct}%`,
        ...COLS.map((c) => String(r[c.key as "b15" | "b8" | "b4" | "b1" | "overdue"])),
      ]),
    }),
    [sorted, team, query],
  );

  const open = (id: string) => router.push(`/tasks?emp=${id}` as Route);

  return (
    <SectionHeader
      id="overdue-by-person"
      icon={<Users size={18} strokeWidth={2.2} />}
      tone="blue"
      title={TITLE}
            collapsed={collapsed}
      onToggle={() => setCollapsed((v) => !v)}
      actions={
        <>
          <SectionShareActions title={TITLE} buildReport={buildReport} />
          {/* Same swap Status by Doer has: people across the top instead of down the side. */}
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
          <p className="px-2 py-10 text-center text-[14px] text-ink-subtle">
            {rows.length === 0 ? "No overdue tasks for the current filters." : "No employees match your search."}
          </p>
        ) : transposed ? (
          <TransposedOverdue rows={sorted} onOpen={open} />
        ) : (
          <div className="kanban-scroll overflow-x-auto">
            <table className="w-full min-w-[760px] border-separate border-spacing-y-1">
              <thead>
                <tr>
                  <th className="border-b border-hairline px-3 py-2 text-left">
                    <SortButton label="Person" active={sort.key === "name"} dir={sort.dir} onClick={() => toggleSort("name")} />
                  </th>
                  <th className="border-b border-hairline px-3 py-2 text-left">
                    <SortButton
                      label="On-time rate"
                      active={sort.key === "onTimePct"}
                      dir={sort.dir}
                      onClick={() => toggleSort("onTimePct")}
                    />
                  </th>
                  {COLS.map((c) => (
                    <th key={c.key} className="border-b border-hairline px-3 py-2 text-center whitespace-nowrap">
                      <SortButton label={c.label} active={sort.key === c.key} dir={sort.dir} onClick={() => toggleSort(c.key)} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r: Row) => {
                  const tone = rateTone(r.onTimePct);
                  return (
                    <tr
                      key={r.employeeId}
                      role="link"
                      tabIndex={0}
                      aria-label={`Open ${r.name}'s tasks`}
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
                            <span className="block text-[11.5px] font-semibold text-ink-subtle">{r.delivered} done</span>
                          </span>
                        </span>
                      </td>
                      <td className="bg-[#F6F8FC] px-3 py-1.5 group-hover:bg-[#EEF3FB]">
                        <div className="flex items-center gap-3">
                          <div className="h-2.5 min-w-[160px] flex-1 overflow-hidden rounded-full" style={{ background: "#DCE6F5" }}>
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${r.onTimePct ?? 0}%`, background: tone.fill }}
                            />
                          </div>
                          <span className="w-12 shrink-0 whitespace-nowrap text-right text-[14px] font-bold tabular-nums" style={{ color: tone.text }}>
                            {r.onTimePct == null ? "" : `${r.onTimePct}%`}
                          </span>
                        </div>
                      </td>
                      <td className="bg-[#F6F8FC] px-3 py-1.5 text-center group-hover:bg-[#EEF3FB]"><Cell value={r.b15} /></td>
                      <td className="bg-[#F6F8FC] px-3 py-1.5 text-center group-hover:bg-[#EEF3FB]"><Cell value={r.b8} /></td>
                      <td className="bg-[#F6F8FC] px-3 py-1.5 text-center group-hover:bg-[#EEF3FB]"><Cell value={r.b4} /></td>
                      <td className="bg-[#F6F8FC] px-3 py-1.5 text-center group-hover:bg-[#EEF3FB]"><Cell value={r.b1} /></td>
                      <td className="rounded-r-xl bg-[#F6F8FC] px-3 py-1.5 text-center group-hover:bg-[#EEF3FB]"><Cell value={r.overdue} strong /></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </SectionHeader>
  );
}

/** People across the top, the measures down the side — the same data read the other way. */
function TransposedOverdue({ rows, onOpen }: { rows: Row[]; onOpen: (id: string) => void }) {
  const measures: { label: string; render: (r: Row) => React.ReactNode }[] = [
    { label: "Done", render: (r) => <span className="text-[14px] tabular-nums text-ink-soft">{r.delivered}</span> },
    {
      label: "On-time rate",
      render: (r) => (
        <span className="text-[14px] font-bold tabular-nums" style={{ color: rateTone(r.onTimePct).text }}>
          {r.onTimePct == null ? "" : `${r.onTimePct}%`}
        </span>
      ),
    },
    ...COLS.map((c) => ({
      label: c.label,
      render: (r: Row) => <Cell value={r[c.key as "b15" | "b8" | "b4" | "b1" | "overdue"]} strong={c.key === "overdue"} />,
    })),
  ];
  return (
    <div className="kanban-scroll overflow-x-auto">
      <table className="w-full border-collapse" style={{ minWidth: 200 + rows.length * 120 }}>
        <thead>
          <tr className="border-b border-hairline">
            <th className="px-3 py-2 text-left text-[13px] font-bold text-ink-strong">Measure</th>
            {rows.map((r) => (
              <th key={r.employeeId} className="px-3 py-2 text-center whitespace-nowrap">
                <button type="button" onClick={() => onOpen(r.employeeId)} className="inline-flex flex-col items-center gap-1 hover:underline">
                  <EmployeeAvatar name={r.name} size="sm" />
                  <span className="text-[12.5px] font-bold text-ink-strong">{r.name.split(/s+/)[0]}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {measures.map((m) => (
            <tr key={m.label} className="border-b border-[#EEF1F6] last:border-b-0">
              <td className="px-3 py-1.5 text-[13px] font-bold whitespace-nowrap text-ink-strong">{m.label}</td>
              {rows.map((r) => (
                <td key={r.employeeId} className="px-3 py-1.5 text-center">{m.render(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
