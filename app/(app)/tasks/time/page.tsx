import Link from "next/link";
import type { Route } from "next";
import { ArrowLeft, Timer } from "lucide-react";
import { DashboardHeader } from "@/components/layout/header";
import { DashboardFooter } from "@/components/layout/footer";
import { requireUser } from "@/lib/auth/current";
import { timeByEmployee } from "@/lib/tasks/time-store";
import { formatDuration } from "@/lib/tasks/time-math";

export const dynamic = "force-dynamic";

/** The windows the report offers, newest-first in the tab strip. */
const RANGES = [
  { slug: "7d", label: "Last 7 days", days: 7 },
  { slug: "30d", label: "Last 30 days", days: 30 },
  { slug: "90d", label: "Last 90 days", days: 90 },
] as const;

type RangeSlug = (typeof RANGES)[number]["slug"];

interface PageProps {
  searchParams: Promise<{ range?: string }>;
}

/**
 * Time report — who spent how long, over a window.
 *
 * Reads resolved sessions rather than the per-task rollup, because the rollup
 * cannot be sliced by person or by date. Open sessions are excluded on purpose:
 * a report of a finished period should not change while you are reading it.
 *
 * Admin-only. A doer's own time is on their tasks; this is the cross-person
 * view, which is a management question.
 */
export default async function TaskTimeReportPage({ searchParams }: PageProps) {
  const me = await requireUser();
  const { range } = await searchParams;

  const active =
    RANGES.find((r) => r.slug === (range as RangeSlug)) ?? RANGES[1];

  const to = new Date();
  const from = new Date(to.getTime() - active.days * 24 * 60 * 60 * 1000);

  const rows = me.isAdmin ? await timeByEmployee(from, to) : [];
  const grandTotal = rows.reduce((sum, r) => sum + r.totalSeconds, 0);

  return (
    <>
      <DashboardHeader generatedAt={new Date()} title="WMS · Time Report" />
      <main className="wms-fill w-full">
        <div className="mx-auto w-full max-w-[1120px] px-8 max-md:px-4 pt-4 pb-3">
          <Link
            href={"/tasks" as Route}
            className="mb-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-ink-subtle transition-colors hover:text-ink-strong"
          >
            <ArrowLeft size={15} strokeWidth={2.4} />
            Back to Tasks
          </Link>

          {/* A heading div, not <h1>: the global h1 rule forces 30–46px. */}
          <div
            role="heading"
            aria-level={1}
            className="flex items-center gap-2 text-ink-strong"
            style={{
              fontFamily: "var(--font-display)",
              fontSize: 20,
              fontWeight: 800,
              letterSpacing: "-0.02em",
            }}
          >
            <Timer
              size={18}
              strokeWidth={2.2}
              style={{ color: "var(--color-altus-red)" }}
            />
            Time report
          </div>
          <p
            className="mb-4 mt-1 text-ink-soft"
            style={{ fontSize: 13, lineHeight: 1.5, maxWidth: "80ch" }}
          >
            Tracked time per person, from completed work sessions. Timers still
            running are not counted — this is a record of finished stretches,
            not a live board.
          </p>

          {!me.isAdmin ? (
            <div
              className="rounded-xl border border-hairline bg-surface-card px-6 py-10 text-center"
              style={{ boxShadow: "0 1px 3px rgba(15,23,42,0.04)" }}
            >
              <p
                className="font-semibold text-ink-strong"
                style={{ fontSize: 15 }}
              >
                Admins only
              </p>
              <p className="mt-1 text-ink-soft" style={{ fontSize: 13 }}>
                Your own tracked time is on each task you worked.
              </p>
            </div>
          ) : (
            <>
              {/* Window picker. A URL param, so any window is linkable — the
                  same rule the task list follows for every filter. */}
              <div className="mb-3 flex flex-wrap items-center gap-1.5">
                {RANGES.map((r) => {
                  const on = r.slug === active.slug;
                  return (
                    <Link
                      key={r.slug}
                      href={`/tasks/time?range=${r.slug}` as Route}
                      aria-current={on ? "page" : undefined}
                      className="inline-flex h-8 items-center rounded-lg border px-3 text-[13px] font-semibold transition-colors hover:bg-[#F5F8FE]"
                      style={{
                        borderColor: on
                          ? "var(--color-altus-red)"
                          : "var(--color-hairline)",
                        color: on
                          ? "var(--color-altus-red)"
                          : "var(--color-ink-soft)",
                        background: on
                          ? "color-mix(in srgb, var(--color-altus-red) 8%, transparent)"
                          : "var(--color-surface-card)",
                      }}
                    >
                      {r.label}
                    </Link>
                  );
                })}
                {grandTotal > 0 && (
                  <span className="ml-auto text-[14px] font-semibold tabular-nums text-ink-soft">
                    {formatDuration(grandTotal)} across {rows.length}{" "}
                    {rows.length === 1 ? "person" : "people"}
                  </span>
                )}
              </div>

              {rows.length === 0 ? (
                <div
                  className="rounded-xl border border-hairline bg-surface-card px-6 py-10 text-center"
                  style={{ boxShadow: "0 1px 3px rgba(15,23,42,0.04)" }}
                >
                  <p
                    className="font-semibold text-ink-strong"
                    style={{ fontSize: 15 }}
                  >
                    No time tracked in this window
                  </p>
                  <p className="mt-1 text-ink-soft" style={{ fontSize: 13 }}>
                    Start a timer from the list or a task to begin recording.
                  </p>
                </div>
              ) : (
                <div
                  className="overflow-x-auto rounded-xl border border-hairline bg-surface-card"
                  style={{ boxShadow: "0 1px 3px rgba(15,23,42,0.04)" }}
                >
                  <table className="w-full" style={{ borderCollapse: "collapse" }}>
                    <thead>
                      <tr className="border-b border-hairline bg-[#F5F7FB]">
                        {["Person", "Total", "Sessions", "Tasks"].map((h, i) => (
                          <th
                            key={h}
                            className="px-4 py-2 font-bold uppercase tracking-[0.06em] text-ink-subtle"
                            style={{
                              fontSize: 10.5,
                              textAlign: i === 0 ? "left" : "right",
                            }}
                          >
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr
                          key={r.employeeId}
                          className="border-b border-hairline last:border-b-0 hover:bg-[#F7F9FD]"
                        >
                          <td
                            className="px-4 py-2 font-semibold text-ink-strong"
                            style={{ fontSize: 14 }}
                          >
                            {r.employeeName ?? "Unknown"}
                          </td>
                          <td
                            className="px-4 py-2 text-right font-semibold tabular-nums text-ink-strong"
                            style={{ fontSize: 14 }}
                          >
                            {formatDuration(r.totalSeconds)}
                          </td>
                          <td
                            className="px-4 py-2 text-right tabular-nums text-ink-soft"
                            style={{ fontSize: 14 }}
                          >
                            {r.sessionCount}
                          </td>
                          <td
                            className="px-4 py-2 text-right tabular-nums text-ink-soft"
                            style={{ fontSize: 14 }}
                          >
                            {r.taskCount}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </main>
      <div className="[&>footer]:mt-6">
        <DashboardFooter />
      </div>
    </>
  );
}
