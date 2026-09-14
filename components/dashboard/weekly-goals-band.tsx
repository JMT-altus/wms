"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { Target, ArrowUpRight } from "lucide-react";
import { PRIORITY_LABELS, type TaskPriority } from "@/db/enums";

export interface GoalBandRow {
  id: string;
  targetDone: string | null;
  priority: TaskPriority;
  pctDone: number;
}

const PRIORITY_TONE: Record<TaskPriority, string> = {
  imp_urgent: "red",
  imp_not_urgent: "amber",
  not_imp_urgent: "orange",
  not_imp_not_urgent: "slate",
};

/**
 * This week's goals, pinned at the top of the dashboard.
 *
 * It sits above the task numbers deliberately: the goals are what the week was
 * committed to, and the tables underneath are how it is actually going. One
 * row per goal — the commitment, its priority, and how far along it is — with
 * the planner one click away for editing. Nothing here is editable; the % is
 * owned by /weekly-goals.
 */
export function WeeklyGoalsBand({ goals }: { goals: GoalBandRow[] }) {
  if (goals.length === 0) return null;

  return (
    <section
      className="mx-auto max-w-[1600px] px-12 max-md:px-4 mt-8"
      aria-label="This week's goals"
    >
      <div
        className="overflow-hidden rounded-section border"
        style={{
          borderColor: "color-mix(in srgb, var(--color-altus-red) 28%, transparent)",
          background: "#ffffff",
        }}
      >
        <header
          className="flex items-center gap-3 px-4 py-3"
          style={{ background: "color-mix(in srgb, var(--color-altus-red) 5%, #ffffff)" }}
        >
          <span
            className="inline-flex items-center gap-1.5 rounded-pill px-2 py-1 text-[10.5px] font-bold uppercase"
            style={{
              letterSpacing: "0.06em",
              color: "var(--color-altus-red)",
              border: "1px solid color-mix(in srgb, var(--color-altus-red) 30%, transparent)",
              background: "color-mix(in srgb, var(--color-altus-red) 8%, #ffffff)",
            }}
          >
            <Target size={12} strokeWidth={2.6} aria-hidden />
            Weekly Goal
          </span>
          <h2
            className="text-ink-strong"
            style={{
              fontFamily: "var(--font-display), system-ui, sans-serif",
              fontWeight: 800,
              fontSize: 19,
              letterSpacing: "-0.02em",
            }}
          >
            This Week&apos;s Goals
          </h2>
          <span
            className="inline-flex min-w-6 items-center justify-center rounded-[8px] px-1.5 py-0.5 text-[12.5px] font-bold tabular-nums"
            style={{
              color: "var(--color-altus-red)",
              background: "color-mix(in srgb, var(--color-altus-red) 10%, #ffffff)",
            }}
          >
            {goals.length}
          </span>
          <Link
            href={"/weekly-goals" as Route}
            className="ml-auto inline-flex items-center gap-1 text-[13.5px] font-bold text-altus-red hover:underline"
          >
            Open Weekly Goals
            <ArrowUpRight size={14} strokeWidth={2.6} aria-hidden />
          </Link>
        </header>

        <ul>
          {goals.map((g) => {
            const pct = Math.max(0, Math.min(100, g.pctDone));
            const tone = PRIORITY_TONE[g.priority];
            return (
              <li
                key={g.id}
                className="flex items-center gap-3 border-t border-hairline px-4 py-3"
              >
                {/* Priority bar: the goal's own urgency, read before the text. */}
                <span
                  aria-hidden
                  className="h-6 w-[3px] shrink-0 rounded-pill"
                  style={{ background: `var(--color-${tone})` }}
                />
                <span className="min-w-0 flex-1 truncate text-[14.5px] font-semibold text-ink-strong">
                  {g.targetDone || "Untitled goal"}
                </span>
                <span
                  className="hidden shrink-0 rounded-[8px] px-2 py-1 text-[12px] font-bold sm:inline-flex"
                  style={{
                    color: `var(--color-${tone}-deep)`,
                    background: `color-mix(in srgb, var(--color-${tone}) 12%, #ffffff)`,
                  }}
                >
                  {PRIORITY_LABELS[g.priority]}
                </span>
                <span
                  className="hidden h-1.5 w-24 shrink-0 overflow-hidden rounded-pill sm:block"
                  style={{ background: "#eef0f3" }}
                  role="progressbar"
                  aria-valuenow={pct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${pct}% done`}
                >
                  <span
                    className="block h-full rounded-pill"
                    style={{
                      width: `${pct}%`,
                      background:
                        pct >= 100 ? "var(--color-success, #16a34a)" : "var(--color-altus-red)",
                    }}
                  />
                </span>
                <span className="w-10 shrink-0 text-right text-[13px] font-bold tabular-nums text-ink-soft">
                  {pct}%
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
