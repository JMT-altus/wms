"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Route } from "next";
import { Maximize2 } from "lucide-react";
import { KIND_LABEL_PLURAL } from "@/lib/plan/levels";
import { LEVEL_KIND, REGISTER_LEVELS, type RegisterLevel } from "@/lib/plan/register";
import type { PlanChip, PlanCounts } from "@/lib/plan/table";
import { PLAN_RED, TABULAR } from "./theme";

/**
 * The Project Plan header — the title, the level tabs and the count chips.
 *
 * Every number here is counted over the WHOLE TREE, never the rendered rows.
 * Results start collapsed, so counting what is on screen would report
 * "0 Actions" on a plan full of them.
 */

const ROUTE_FOR: Record<RegisterLevel, string> = {
  projects: "/project-plan",
  milestones: "/project-plan/milestones",
  results: "/project-plan/results",
  actions: "/project-plan/actions",
  "sub-actions": "/project-plan/sub-actions",
};

/** The chip row. A dot per level, in the tone that level reads as elsewhere. */
const CHIPS: ReadonlyArray<{
  key: NonNullable<PlanChip> | "total";
  label: string;
  dot: string;
  of: (c: PlanCounts) => number;
}> = [
  { key: "total", label: "Total", dot: "#64748B", of: (c) => c.total },
  { key: "project", label: "Projects", dot: "#E10600", of: (c) => c.projects },
  { key: "milestone", label: "Milestones", dot: "#7C3AED", of: (c) => c.milestones },
  { key: "result", label: "Results", dot: "#0891B2", of: (c) => c.results },
  { key: "action", label: "Actions", dot: "#16A34A", of: (c) => c.actions },
  { key: "wms", label: "In WMS", dot: "#94A3B8", of: (c) => c.inWms },
  { key: "unscheduled", label: "Not scheduled", dot: "#94A3B8", of: (c) => c.notScheduled },
];

export type { PlanChip };

interface Props {
  level: RegisterLevel;
  counts: PlanCounts;
  chip: PlanChip;
  onChip: (next: PlanChip) => void;
  onFullScreen: () => void;
}

export function PlanToolbar({ level, counts, chip, onChip, onFullScreen }: Props) {
  /**
   * Carry `?view=` across the level tabs.
   *
   * The view is a URL parameter, so a bare tab href dropped it and every level
   * you opened snapped back to the hierarchy — you would choose Table on
   * Milestones, click Results, and be back in List. Which level you are
   * reading and how you want it drawn are separate questions; changing the
   * first should not answer the second for you.
   */
  const view = useSearchParams().get("view");
  const hrefFor = (l: RegisterLevel) =>
    (view ? `${ROUTE_FOR[l]}?view=${encodeURIComponent(view)}` : ROUTE_FOR[l]) as Route;

  return (
    <div className="mb-3">
      {/* ── Title + the level tabs ─────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-4 mb-3">
        <h1
          className="font-black shrink-0"
          style={{ fontSize: 27, letterSpacing: "-0.022em", color: "var(--color-ink-strong)" }}
        >
          Project Plan
        </h1>

        <nav
          aria-label="Level"
          className="inline-flex items-center gap-1 rounded-xl p-1"
          style={{ background: "color-mix(in srgb, var(--color-ink-strong) 5%, transparent)" }}
        >
          {REGISTER_LEVELS.map((l) => {
            const active = l === level;
            return (
              <Link
                key={l}
                href={hrefFor(l)}
                aria-current={active ? "page" : undefined}
                className="inline-flex items-center gap-1.5 rounded-lg px-3 h-8 text-[14.5px] font-bold whitespace-nowrap transition-colors"
                style={
                  active
                    ? { background: PLAN_RED, color: "#fff" }
                    : { color: "var(--color-ink-muted)" }
                }
              >
                {KIND_LABEL_PLURAL[LEVEL_KIND[l]]}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* ── The chips, clickable as filters ────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5">
        {CHIPS.map((c) => {
          const value = c.key === "total" ? null : (c.key as PlanChip);
          const active = chip === value;
          const n = c.of(counts);
          return (
            <button
              key={c.key}
              type="button"
              onClick={() => onChip(active ? null : value)}
              aria-pressed={active}
              className="inline-flex items-center gap-1.5 rounded-lg px-2.5 h-8 text-[13.5px] font-semibold whitespace-nowrap"
              style={{
                color: active ? PLAN_RED : "var(--color-ink)",
                background: "var(--color-surface-card)",
                border: `1px solid ${
                  active
                    ? PLAN_RED
                    : "var(--color-hairline-strong)"
                }`,
                // A count of nothing is still worth showing — it is the answer
                // to "how many are not scheduled?" — but it should not shout.
                opacity: n === 0 ? 0.55 : 1,
              }}
            >
              <span
                aria-hidden
                className="rounded-full shrink-0"
                style={{ width: 6, height: 6, background: c.dot }}
              />
              <strong style={TABULAR}>{n}</strong>
              <span style={{ fontWeight: 500 }}>{c.label}</span>
            </button>
          );
        })}

        <span className="flex-1" />

        <button
          type="button"
          onClick={onFullScreen}
          className="inline-flex items-center gap-1.5 rounded-lg px-3 h-8 text-[13.5px] font-semibold whitespace-nowrap"
          style={{
            color: "var(--color-ink)",
            background: "var(--color-surface-card)",
            border: "1px solid var(--color-hairline-strong)",
          }}
        >
          <Maximize2 size={13} strokeWidth={2.4} />
          Full screen
        </button>
      </div>
    </div>
  );
}
