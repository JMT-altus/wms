"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { ArrowLeftRight, ClipboardCheck } from "lucide-react";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";
import type { DashboardInsights } from "@/lib/types";
import { SectionHeader } from "./section-header";
import { SectionShareActions, type SectionReportInput } from "./section-share";
import { SearchToggle, SortButton } from "./status-table";

type Row = DashboardInsights["delegationScorecard"][number];
type SortKey = "name" | "delegated" | "completed" | "overdue" | "sentBack";

const MONO = { fontFamily: "var(--font-mono-display), ui-monospace, monospace" } as const;
const TITLE = "Delegation Scorecard";

const COLS: { key: Exclude<SortKey, "name">; label: string }[] = [
  { key: "delegated", label: "Delegated" },
  { key: "completed", label: "Completed" },
  { key: "overdue", label: "Overdue" },
  { key: "sentBack", label: "Sent back" },
];

/** A figure in the grid: bold, with an optional muted "/total" beside it. */
function Figure({ value, of, tone }: { value: number; of?: number; tone?: "red" }) {
  return (
    <span className="inline-flex items-baseline gap-0.5 tabular-nums" style={MONO}>
      <span
        className="text-[16px] font-bold"
        style={{ color: value === 0 ? "#b4bcc9" : tone === "red" ? "#dc2626" : "var(--color-ink-strong)" }}
      >
        {value}
      </span>
      {of != null && <span className="text-[12px] font-medium text-ink-subtle">/{of}</span>}
    </span>
  );
}

const reportsLabel = (n: number) => (n === 0 ? "No direct reports" : `${n} direct ${n === 1 ? "report" : "reports"}`);

/**
 * Delegation Scorecard — how the work each person hands to others is going:
 * per initiator, what they delegated, how much of it is completed, and how
 * much is overdue or sent back. A row opens the tasks that person created.
 */
export function DelegationScorecard({ rows }: { rows: DashboardInsights["delegationScorecard"] }) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [collapsed, setCollapsed] = React.useState(false);
  const [transposed, setTransposed] = React.useState(false);
  const [sort, setSort] = React.useState<{ key: SortKey; dir: "asc" | "desc" }>({
    key: "delegated",
    dir: "desc",
  });

  const sorted = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const dir = sort.dir === "asc" ? 1 : -1;
    return rows
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .sort((a, b) => (sort.key === "name" ? a.name.localeCompare(b.name) * dir : (a[sort.key] - b[sort.key]) * dir));
  }, [rows, query, sort]);

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
      subtitle: `${sorted.length} ${sorted.length === 1 ? "initiator" : "initiators"}`,
      context: query.trim() ? `Search: ${query.trim()}` : "",
      columns: ["Manager / Initiator", "Direct reports", "Delegated", "Completed", "Overdue", "Sent back"],
      rows: sorted.map((r) => [
        r.name,
        String(r.directReports),
        String(r.delegated),
        `${r.completed}/${r.delegated}`,
        String(r.overdue),
        String(r.sentBack),
      ]),
    }),
    [sorted, query],
  );

  const open = (id: string) => router.push(`/tasks?emp=${id}&view=initiator` as Route);
  const cellFor = (r: Row, key: Exclude<SortKey, "name">) =>
    key === "completed" ? (
      <Figure value={r.completed} of={r.delegated} />
    ) : key === "overdue" ? (
      <Figure value={r.overdue} tone="red" />
    ) : (
      <Figure value={r[key]} />
    );

  return (
    <SectionHeader
      id="delegation-scorecard"
      icon={<ClipboardCheck size={18} strokeWidth={2.2} />}
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
        className="rounded-section p-3 max-md:p-2.5"
        style={{
          background: "#ffffff",
          border: "1px solid var(--color-hairline-strong)",
          boxShadow: "0 1px 2px rgba(15, 23, 42, 0.05), 0 8px 24px -16px rgba(15, 23, 42, 0.16)",
        }}
      >
        {sorted.length === 0 ? (
          <p className="px-2 py-10 text-center text-[14px] text-ink-subtle">
            {rows.length === 0 ? "No delegated tasks for the current filters." : "No employees match your search."}
          </p>
        ) : transposed ? (
          <div className="kanban-scroll overflow-x-auto rounded-chip border border-hairline">
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
                    <td className="px-3 py-2 text-[13px] font-bold whitespace-nowrap text-ink-strong">{c.label}</td>
                    {sorted.map((r) => (
                      <td key={r.employeeId} className="px-3 py-2 text-center">{cellFor(r, c.key)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="kanban-scroll overflow-x-auto rounded-chip border border-hairline">
            <table className="w-full min-w-[640px] border-collapse">
              <thead>
                <tr className="border-b border-hairline">
                  <th className="px-4 py-2.5 text-left">
                    <SortButton label="Manager / Initiator" active={sort.key === "name"} dir={sort.dir} onClick={() => toggleSort("name")} />
                  </th>
                  {COLS.map((c) => (
                    <th key={c.key} className="px-4 py-2.5 text-center whitespace-nowrap">
                      <SortButton label={c.label} active={sort.key === c.key} dir={sort.dir} onClick={() => toggleSort(c.key)} />
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
                    aria-label={`Open the tasks ${r.name} created`}
                    onClick={() => open(r.employeeId)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        open(r.employeeId);
                      }
                    }}
                    className="cursor-pointer border-b border-[#EEF1F6] last:border-b-0 hover:bg-[#F7F9FD]"
                  >
                    <td className="px-4 py-2 whitespace-nowrap">
                      <span className="inline-flex items-center gap-3">
                        <EmployeeAvatar name={r.name} size="md" />
                        <span className="leading-tight">
                          <span className="block text-[14.5px] font-bold text-ink-strong">{r.name}</span>
                          <span className="block text-[11.5px] font-semibold text-ink-subtle">{reportsLabel(r.directReports)}</span>
                        </span>
                      </span>
                    </td>
                    {COLS.map((c) => (
                      <td key={c.key} className="px-4 py-2 text-center">{cellFor(r, c.key)}</td>
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
