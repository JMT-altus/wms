"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { Trophy, ChevronRight } from "lucide-react";
import type { TopPerformer } from "@/lib/types";
import { EmployeeAvatar } from "@/components/ui/employee-avatar";
import { SectionHeader } from "./section-header";
import { SectionShareActions, type SectionReportInput } from "./section-share";
import { SearchToggle } from "./status-table";

const TITLE = "Top Performers";

function ordinal(n: number): string {
  // 11th/12th/13th are the exceptions to the 1st/2nd/3rd rule.
  const teens = n % 100;
  if (teens >= 11 && teens <= 13) return `${n}th`;
  const suffix = ["th", "st", "nd", "rd"][n % 10] ?? "th";
  return `${n}${suffix}`;
}

function onTimePct(p: TopPerformer): number {
  return p.doneCount > 0 ? Math.round((p.onTimeCount / p.doneCount) * 100) : 0;
}

function avgText(p: TopPerformer): string {
  return p.avgTurnaroundDays == null ? "N/A avg" : `${p.avgTurnaroundDays.toFixed(1)}d avg`;
}

/**
 * The leaderboard: a podium of three cards on the left, everyone else as a
 * ranked list on the right.
 *
 * Two shapes for the same data on purpose — the top three are the ones people
 * look for by name, so they get room for the count and the on-time line, while
 * ranks four and down are scanned as a column and only need enough to compare.
 * Every entry opens that person's completed tasks.
 */
export function TopPerformersSection({ performers }: { performers: TopPerformer[] }) {
  const router = useRouter();
  const [query, setQuery] = React.useState("");
  const [collapsed, setCollapsed] = React.useState(false);

  const hrefFor = (employeeId: string): Route =>
    `/tasks?emp=${employeeId}&status=done,approved` as Route;

  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return performers;
    return performers.filter(
      (p) =>
        p.employeeName.toLowerCase().includes(q) || p.department.toLowerCase().includes(q),
    );
  }, [performers, query]);

  // The podium is the top three OF WHAT'S SHOWN. Searching narrows the board
  // rather than re-ranking it, so each card still shows the person's real rank.
  const podium = filtered.slice(0, 3);
  const rest = filtered.slice(3);

  const buildReport = React.useCallback(
    (): SectionReportInput => ({
      title: TITLE,
      subtitle: `${filtered.length} ${filtered.length === 1 ? "person" : "people"} ranked by completed tasks`,
      context: query.trim() ? `Search: ${query.trim()}` : undefined,
      columns: ["Rank", "Employee", "Team", "Completed", "On time", "Avg turnaround"],
      rows: filtered.map((p) => [
        ordinal(p.rank),
        p.employeeName,
        p.department || "—",
        String(p.doneCount),
        `${onTimePct(p)}% (${p.onTimeCount}/${p.doneCount})`,
        avgText(p),
      ]),
    }),
    [filtered, query],
  );

  return (
    <SectionHeader
      id="top-performers"
      icon={<Trophy size={18} strokeWidth={2.2} />}
      tone="blue"
      title={TITLE}
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
        {filtered.length === 0 ? (
          <p className="px-2 py-10 text-center text-[14px] text-ink-subtle">
            {performers.length === 0
              ? "No completed tasks in this period."
              : "Nobody matches your search."}
          </p>
        ) : (
          <div className="grid grid-cols-[minmax(260px,420px)_1fr] gap-3 max-lg:grid-cols-1">
            {/* Podium */}
            <div className="kanban-scroll flex max-h-[560px] flex-col gap-2.5 overflow-y-auto pr-1">
              {podium.map((p) => (
                <PodiumCard
                  key={p.employeeId}
                  performer={p}
                  onOpen={() => router.push(hrefFor(p.employeeId))}
                />
              ))}
            </div>

            {/* Everyone else */}
            <div
              className={`kanban-scroll flex max-h-[560px] flex-col gap-2 overflow-y-auto pr-1 ${
                rest.length === 0 ? "items-center justify-center rounded-lg border border-dashed border-[#d6dbe4] px-4 py-8 max-lg:py-5" : ""
              }`}
            >
              {rest.length === 0 ? (
                <p className="text-center text-[13px] font-semibold text-ink-subtle">
                  No one outside the top three yet.
                </p>
              ) : (
                rest.map((p) => (
                  <RankRow
                    key={p.employeeId}
                    performer={p}
                    onOpen={() => router.push(hrefFor(p.employeeId))}
                  />
                ))
              )}
            </div>
          </div>
        )}
      </div>
    </SectionHeader>
  );
}

function PodiumCard({
  performer: p,
  onOpen,
}: {
  performer: TopPerformer;
  onOpen: () => void;
}) {
  const pct = onTimePct(p);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${p.employeeName}'s completed tasks`}
      className="group w-full rounded-lg border border-hairline-strong bg-white p-3 text-left transition-all duration-200 hover:border-[#9fb2d1] hover:shadow-md"
    >
      <div className="flex items-start gap-3">
        <EmployeeAvatar name={p.employeeName} size="lg" className="!size-12 !text-[15px]" />
        <div className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-bold text-ink-strong">{p.employeeName}</span>
          {p.department && (
            <span
              className="mt-1 inline-flex items-center rounded-pill px-2 py-0.5 text-[11px] font-semibold text-ink-soft"
              style={{ background: "#f1f2f4", border: "1px solid var(--color-hairline)" }}
            >
              {p.department}
            </span>
          )}
        </div>
        <span
          className="shrink-0 rounded-pill px-2 py-0.5 text-[12px] font-bold tabular-nums text-ink-soft"
          style={{ background: "#EEF2F8" }}
          title={`${ordinal(p.rank)} by completed tasks`}
        >
          #{p.rank}
        </span>
      </div>

      <hr className="my-2.5 border-hairline" />

      <div className="flex items-baseline gap-2">
        <span
          className="tabular-nums text-ink-strong"
          style={{
            fontFamily: "var(--font-display), system-ui, sans-serif",
            fontWeight: 800,
            fontSize: 24,
            letterSpacing: "-0.02em",
            lineHeight: 1,
          }}
        >
          {p.doneCount}
        </span>
        <span className="text-[11.5px] font-bold uppercase tracking-[0.08em] text-ink-subtle">
          Completed
        </span>
      </div>
      <p className="mt-1.5 text-[12.5px] font-bold" style={{ color: "var(--color-green-deep)" }}>
        {pct}% on time{" "}
        <span className="font-semibold text-ink-subtle">
          ({p.onTimeCount}/{p.doneCount})
        </span>
        <span className="font-semibold text-ink-subtle"> · {avgText(p)}</span>
      </p>
    </button>
  );
}

function RankRow({ performer: p, onOpen }: { performer: TopPerformer; onOpen: () => void }) {
  const pct = onTimePct(p);
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={`Open ${p.employeeName}'s completed tasks`}
      className="group flex w-full items-center gap-3 rounded-lg border border-hairline-strong bg-white px-3 py-2 text-left transition-all duration-200 hover:border-[#9fb2d1] hover:shadow-md"
    >
      <span className="w-5 shrink-0 text-center text-[13px] font-bold tabular-nums text-ink-soft">
        {p.rank}
      </span>
      <EmployeeAvatar name={p.employeeName} size="sm" className="!size-8" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15px] font-bold text-ink-strong">
          {p.employeeName}
        </span>
        {p.department && (
          <span
            className="mt-1 inline-flex items-center rounded-pill px-2 py-0.5 text-[11.5px] font-semibold text-ink-soft"
            style={{ background: "#f1f2f4" }}
          >
            {p.department}
          </span>
        )}
      </span>

      {/* On-time rate as a bar: the number says how good, the bar says how it
          compares to the rows above and below without reading each one. */}
      <span
        className="hidden h-1.5 w-32 shrink-0 overflow-hidden rounded-pill md:block"
        style={{ background: "#eef0f3" }}
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={`${pct}% on time`}
      >
        <span
          className="block h-full rounded-pill"
          style={{ width: `${pct}%`, background: "var(--color-green)" }}
        />
      </span>
      <span
        className="shrink-0 text-[13px] font-bold whitespace-nowrap"
        style={{ color: "var(--color-green-deep)" }}
      >
        {pct}% on time
      </span>
      <span
        className="inline-flex min-w-10 shrink-0 items-center justify-center rounded-[10px] px-2.5 py-1.5 text-[15px] font-bold tabular-nums"
        style={{
          color: "var(--color-green-deep)",
          background: "color-mix(in srgb, var(--color-green) 12%, #ffffff)",
          border: "1px solid color-mix(in srgb, var(--color-green) 28%, transparent)",
        }}
      >
        {p.doneCount}
      </span>
      <ChevronRight
        size={17}
        strokeWidth={2.2}
        aria-hidden
        className="shrink-0 text-ink-subtle transition-transform group-hover:translate-x-0.5"
      />
    </button>
  );
}
