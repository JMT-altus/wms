"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { CalendarCheck } from "lucide-react";
import type { DashboardInsights, DashboardData } from "@/lib/types";
import { SectionHeader } from "./section-header";
import { SectionShareActions, type SectionReportInput } from "./section-share";
import { SearchToggle, SortButton } from "./status-table";

type SortKey = "title" | "assignee" | "daysLate" | "dueAt" | "completedAt";

const TITLE = "Delivered on Time";
const MONO = { fontFamily: "var(--font-mono-display), ui-monospace, monospace" } as const;

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Asia/Kolkata" });

/** The gauge's colour follows the rate: warning red, then amber, then JMT green. */
function gaugeColor(pct: number) {
  if (pct < 50) return "#b91c1c";
  if (pct < 80) return "#d97706";
  return "#059669";
}

/** A half-circle gauge with the on-time share in the middle. */
function Gauge({ pct }: { pct: number }) {
  const r = 70;
  const arc = Math.PI * r;
  const color = gaugeColor(pct);
  return (
    <div className="relative mx-auto w-[240px]" role="img" aria-label={`${pct}% delivered on time`}>
      <svg viewBox="0 0 180 100" className="w-full">
        <path d="M 20 90 A 70 70 0 0 1 160 90" fill="none" stroke="#E8EAEE" strokeWidth="14" strokeLinecap="round" />
        {pct > 0 && (
          <path
            d="M 20 90 A 70 70 0 0 1 160 90"
            fill="none"
            stroke={color}
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={`${(pct / 100) * arc} ${arc}`}
          />
        )}
      </svg>
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center leading-none">
        <span className="text-[44px] font-extrabold tabular-nums" style={{ color, fontFamily: "var(--font-display), system-ui, sans-serif" }}>
          {pct}
          <span className="text-[24px]">%</span>
        </span>
        <span className="mt-1 text-[11px] font-bold uppercase tracking-[0.18em] text-ink-subtle" style={MONO}>
          On time
        </span>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  note,
  tone,
  emphasised = false,
}: {
  label: string;
  value: number;
  note?: string;
  tone: "slate" | "green" | "red";
  emphasised?: boolean;
}) {
  const color = tone === "green" ? "#059669" : tone === "red" ? "#dc2626" : "#334155";
  return (
    <div
      className="rounded-xl bg-white px-3.5 py-2.5"
      style={{
        border: emphasised ? "1.5px solid #f2a4a4" : "1px solid var(--color-hairline-strong)",
        background: emphasised ? "#FFF5F5" : "#ffffff",
      }}
    >
      <p className="text-[10.5px] font-bold uppercase tracking-[0.08em] text-ink-subtle">{label}</p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="text-[24px] font-extrabold tabular-nums leading-none" style={{ color, ...MONO }}>
          {value}
        </span>
        {note && <span className="text-[12px] font-bold tabular-nums" style={{ color }}>{note}</span>}
      </p>
      <p className="text-[11.5px] font-semibold text-ink-subtle">tasks</p>
    </div>
  );
}

/**
 * Delivered on Time — how finished work (Done / Approved) landed against its
 * ORIGINAL due date: the on-time share as a gauge, the on-time and late
 * counts, and the late deliveries themselves (task, assignee, days late). The
 * numbers are the same ones Delivery vs Due Date uses.
 */
export function DeliveredOnTime({
  delivery,
  late,
}: {
  delivery: DashboardInsights["delivery"];
  late: DashboardData["lateDeliveries"];
}) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [collapsed, setCollapsed] = React.useState(false);
  const [sort, setSort] = React.useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "daysLate", dir: "desc" });

  const total = delivery.onBeforeTotal + delivery.lateTotal;
  const latePct = total > 0 ? 100 - delivery.onTimePct : 0;

  const rows = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    const dir = sort.dir === "asc" ? 1 : -1;
    return late.tasks
      .filter((t) => !q || t.title.toLowerCase().includes(q) || t.assignee.toLowerCase().includes(q) || (t.client ?? "").toLowerCase().includes(q))
      .sort((a, b) => {
        if (sort.key === "daysLate") return (a.daysLate - b.daysLate) * dir;
        return String(a[sort.key]).localeCompare(String(b[sort.key])) * dir;
      });
  }, [late.tasks, query, sort]);

  function toggleSort(key: SortKey) {
    setSort((cur) =>
      cur.key === key
        ? { key, dir: cur.dir === "asc" ? "desc" : "asc" }
        : { key, dir: key === "daysLate" || key === "dueAt" || key === "completedAt" ? "desc" : "asc" },
    );
  }

  const buildReport = React.useCallback(
    (): SectionReportInput => ({
      title: TITLE,
      subtitle: `${delivery.onTimePct}% on time · ${delivery.onBeforeTotal} on time · ${delivery.lateTotal} late`,
      context: query.trim() ? `Search: ${query.trim()}` : "",
      columns: ["Task", "Client", "Assignee", "Days late", "Due", "Completed"],
      rows: rows.map((t) => [
        t.title,
        t.client ?? "",
        t.assignee,
        String(t.daysLate),
        fmtDate(t.dueAt),
        fmtDate(t.completedAt),
      ]),
    }),
    [rows, delivery, query],
  );

  const hiddenNote = late.hidden > 0 ? ` (${late.hidden} private)` : "";

  return (
    <SectionHeader
      id="delivered-on-time"
      icon={<CalendarCheck size={18} strokeWidth={2.2} />}
      tone="blue"
      title={TITLE}
      collapsed={collapsed}
      onToggle={() => setCollapsed((v) => !v)}
      actions={<SectionShareActions title={TITLE} buildReport={buildReport} />}
      trailing={<SearchToggle value={query} onChange={setQuery} />}
    >
      <div
        className="rounded-section p-4 max-md:p-3"
        style={{
          background: "#ffffff",
          border: "1px solid var(--color-hairline-strong)",
          boxShadow: "0 1px 2px rgba(15, 23, 42, 0.05), 0 8px 24px -16px rgba(15, 23, 42, 0.16)",
        }}
      >
        {total === 0 ? (
          <p className="px-3 py-10 text-center text-[13px] font-medium text-ink-subtle">
            No completed tasks with a completion date for the current filters.
          </p>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(280px,360px)_1fr]">
            <div>
              <Gauge pct={delivery.onTimePct} />
              <p className="mt-3 flex items-center justify-center gap-4 text-[12.5px] font-bold">
                <span className="inline-flex items-center gap-1.5 text-ink-soft">
                  <span className="size-2 rounded-full bg-[#10b981]" />
                  On time <span className="tabular-nums text-ink-strong">{delivery.onBeforeTotal}</span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-ink-soft">
                  <span className="size-2 rounded-full bg-[#dc2626]" />
                  Late <span className="tabular-nums text-[#dc2626]">{delivery.lateTotal}</span>
                </span>
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2.5">
                <div className="col-span-2">
                  <StatCard label="Total completed" value={total} tone="slate" />
                </div>
                <StatCard label="On time" value={delivery.onBeforeTotal} note={`(${delivery.onTimePct}%)`} tone="green" />
                <StatCard label="Late deliveries" value={delivery.lateTotal} note={`(${latePct}%)`} tone="red" emphasised />
              </div>
            </div>

            <div className="flex min-w-0 flex-col overflow-hidden rounded-chip border border-hairline">
              {rows.length === 0 ? (
                <p className="px-3 py-10 text-center text-[13px] font-medium text-ink-subtle">
                  {late.tasks.length === 0 ? "No late deliveries to list." : "No tasks match your search."}
                </p>
              ) : (
                <div className="kanban-scroll max-h-[360px] overflow-auto">
                  <table className="w-full min-w-[640px] border-collapse">
                    <thead className="sticky top-0 z-10 bg-white">
                      <tr className="border-b border-hairline">
                        <th className="px-3 py-2.5 text-left">
                          <SortButton label="Task" active={sort.key === "title"} dir={sort.dir} onClick={() => toggleSort("title")} />
                        </th>
                        <th className="px-3 py-2.5 text-left">
                          <SortButton label="Assignee" active={sort.key === "assignee"} dir={sort.dir} onClick={() => toggleSort("assignee")} />
                        </th>
                        <th className="px-3 py-2.5 text-center whitespace-nowrap">
                          <SortButton label="Days late" active={sort.key === "daysLate"} dir={sort.dir} onClick={() => toggleSort("daysLate")} />
                        </th>
                        <th className="px-3 py-2.5 text-center whitespace-nowrap">
                          <SortButton label="Due" active={sort.key === "dueAt"} dir={sort.dir} onClick={() => toggleSort("dueAt")} />
                        </th>
                        <th className="px-3 py-2.5 text-center whitespace-nowrap">
                          <SortButton label="Completed" active={sort.key === "completedAt"} dir={sort.dir} onClick={() => toggleSort("completedAt")} />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((t) => (
                        <tr
                          key={t.id}
                          role="link"
                          tabIndex={0}
                          aria-label={`Open ${t.title}`}
                          onClick={() => router.push(`/tasks/${t.id}` as Route)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              router.push(`/tasks/${t.id}` as Route);
                            }
                          }}
                          className="cursor-pointer border-b border-[#EEF1F6] last:border-b-0 hover:bg-[#F7F9FD]"
                        >
                          <td className="max-w-[360px] px-3 py-2">
                            <span className="block truncate text-[14px] font-bold text-ink-strong" title={t.title}>{t.title}</span>
                            {t.client && <span className="block truncate text-[11.5px] font-semibold text-ink-subtle">{t.client}</span>}
                          </td>
                          <td className="px-3 py-2 text-[14px] font-bold whitespace-nowrap text-ink-strong">{t.assignee}</td>
                          <td className="px-3 py-2 text-center">
                            <span className="inline-flex min-w-9 items-center justify-center rounded-md bg-[#FEE2E2] px-2 py-0.5 text-[13px] font-bold tabular-nums text-[#b91c1c]" style={MONO}>
                              {t.daysLate}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-center text-[13px] tabular-nums text-ink-soft">{fmtDate(t.dueAt)}</td>
                          <td className="px-3 py-2 text-center text-[13px] tabular-nums text-ink-soft">{fmtDate(t.completedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="border-t border-hairline bg-[#F7F9FC] px-3 py-2 text-[11.5px] font-bold text-ink-subtle">
                Showing {rows.length} of {late.tasks.length}
                {hiddenNote}
              </p>
            </div>
          </div>
        )}

        {delivery.noComparableDate > 0 && (
          <p className="mt-4 text-[11.5px] font-bold text-ink-subtle">
            {delivery.noComparableDate} Done Without a Comparable Date — Not Counted.
          </p>
        )}
      </div>
    </SectionHeader>
  );
}
