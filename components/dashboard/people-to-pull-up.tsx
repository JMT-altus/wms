"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { TrendingDown } from "lucide-react";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";
import type { DashboardInsights } from "@/lib/types";
import { SectionHeader } from "./section-header";
import { SectionShareActions, type SectionReportInput } from "./section-share";
import { SearchToggle, SortButton } from "./status-table";

type Row = DashboardInsights["pullUp"][number];
type SortKey = "score" | "name" | "overdue" | "late" | "sentBack" | "onTimePct";

const MONO = { fontFamily: "var(--font-mono-display), ui-monospace, monospace" } as const;
const TITLE = "People To Pull Up";
const HINT =
  "Doers with the most overdue, late and sent-back work — the top 10, most urgent first. " +
  "Each person is scored 2 per overdue task, 1 per task delivered late and 2 per sent-back task.";

const COLS: { key: Exclude<SortKey, "score" | "name">; label: string }[] = [
  { key: "overdue", label: "Overdue" },
  { key: "late", label: "Delivered late" },
  { key: "sentBack", label: "Sent back" },
  { key: "onTimePct", label: "On time" },
];

function Figure({ value, tone }: { value: number; tone?: "red" | "amber" }) {
  const color =
    value === 0 ? "#b4bcc9" : tone === "red" ? "#dc2626" : tone === "amber" ? "#d97706" : "var(--color-ink-strong)";
  return (
    <span className="text-[16px] font-bold tabular-nums" style={{ ...MONO, color }}>
      {value}
    </span>
  );
}

function cell(r: Row, key: (typeof COLS)[number]["key"]) {
  if (key === "overdue") return <Figure value={r.overdue} tone="red" />;
  if (key === "late") return <Figure value={r.late} tone="amber" />;
  if (key === "sentBack") return <Figure value={r.sentBack} tone="red" />;
  return r.onTimePct == null ? null : (
    <span
      className="text-[14px] font-bold tabular-nums"
      style={{ ...MONO, color: r.onTimePct < 50 ? "#b91c1c" : "#0B4FB8" }}
    >
      {r.onTimePct}%
    </span>
  );
}

/**
 * People To Pull Up — the doers with the most overdue, late and sent-back work
 * (top 10, most urgent first). A row opens that person's tasks.
 */
export function PeopleToPullUp({ rows }: { rows: DashboardInsights["pullUp"] }) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [collapsed, setCollapsed] = React.useState(false);
  const [sort, setSort] = React.useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "score", dir: "desc" });

  const sorted = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = (r: Row, k: SortKey): number => (k === "onTimePct" ? (r.onTimePct ?? -1) : (r[k as "score"] as number));
    return rows
      .filter((r) => !q || r.name.toLowerCase().includes(q))
      .sort((a, b) =>
        sort.key === "name" ? a.name.localeCompare(b.name) * dir : (val(a, sort.key) - val(b, sort.key)) * dir,
      );
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
      subtitle: `${sorted.length} ${sorted.length === 1 ? "person" : "people"}`,
      context: query.trim() ? `Search: ${query.trim()}` : "",
      columns: ["Person", "Overdue", "Delivered late", "Sent back", "On time"],
      rows: sorted.map((r) => [
        r.name,
        String(r.overdue),
        String(r.late),
        String(r.sentBack),
        r.onTimePct == null ? "" : `${r.onTimePct}%`,
      ]),
    }),
    [sorted, query],
  );

  const open = (id: string) => router.push(`/tasks?emp=${id}` as Route);

  return (
    <SectionHeader
      id="people-to-pull-up"
      icon={<TrendingDown size={18} strokeWidth={2.2} />}
      tone="blue"
      title={TITLE}
      hint={HINT}
      collapsed={collapsed}
      onToggle={() => setCollapsed((v) => !v)}
      actions={<SectionShareActions title={TITLE} buildReport={buildReport} />}
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
          <div className="flex flex-col items-center px-4 py-12 text-center">
            <TrendingDown size={20} className="text-ink-subtle" aria-hidden />
            <p className="mt-3 text-[14px] font-bold text-ink-strong">Nobody to show</p>
            <p className="mt-1.5 text-[12.5px] font-semibold text-ink-subtle">
              {rows.length === 0
                ? "Nobody needs a nudge in the current filters."
                : "No one matches your search."}
            </p>
          </div>
        ) : (
          <div className="kanban-scroll overflow-x-auto rounded-chip border border-hairline">
            <table className="w-full min-w-[560px] border-collapse">
              <thead>
                <tr className="border-b border-hairline">
                  <th className="px-4 py-2.5 text-left">
                    <SortButton label="Person" active={sort.key === "name"} dir={sort.dir} onClick={() => toggleSort("name")} />
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
                    aria-label={`Open ${r.name}'s tasks`}
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
                        <span className="text-[14.5px] font-bold text-ink-strong">{r.name}</span>
                      </span>
                    </td>
                    {COLS.map((c) => (
                      <td key={c.key} className="px-4 py-2 text-center">{cell(r, c.key)}</td>
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
