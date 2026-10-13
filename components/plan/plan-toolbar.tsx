"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { Route } from "next";
import { ListTree, Maximize2 } from "lucide-react";
import { KIND_LABEL_PLURAL } from "@/lib/plan/levels";
import { LEVEL_KIND, REGISTER_LEVELS, type RegisterLevel } from "@/lib/plan/register";
import type { PlanChip, PlanCounts } from "@/lib/plan/table";
import { PLAN_EDGE, PLAN_RED, TABULAR } from "./theme";

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

/** What each register lists, in one line under its title. */
const SUBTITLE: Record<RegisterLevel, string> = {
  projects: "Every project in the plan, with its status, progress and milestone rollup.",
  milestones: "Every milestone in the plan, with its status, progress and the results under it.",
  results: "Every result in the plan, with its status, progress and the actions under it.",
  actions: "Every action in the plan, with its status, schedule and linked WMS task.",
  "sub-actions": "Every sub-action in the plan, with its status and schedule.",
};

/** The chip row. A dot per level, in the tone that level reads as elsewhere. */
const CHIPS: ReadonlyArray<{
  key: NonNullable<PlanChip> | "total";
  label: string;
  dot: string;
  of: (c: PlanCounts) => number;
}> = [
  { key: "total", label: "Total", dot: "#64748B", of: (c) => c.total },
  // Navy, not the module's red: red is not a status, and this row is a summary.
  { key: "project", label: "Projects", dot: "#14336B", of: (c) => c.projects },
  { key: "milestone", label: "Milestones", dot: "#7C3AED", of: (c) => c.milestones },
  { key: "result", label: "Results", dot: "#0891B2", of: (c) => c.results },
  { key: "action", label: "Actions", dot: "#16A34A", of: (c) => c.actions },
  { key: "wms", label: "In WMS", dot: "#94A3B8", of: (c) => c.inWms },
  { key: "unscheduled", label: "Not scheduled", dot: "#94A3B8", of: (c) => c.notScheduled },
];

export type { PlanChip };

interface Props {
  level: RegisterLevel;
  /**
   * The board is showing. It lists EVERY kind of row together — containers sit
   * in the columns beside the work — so it is not "the Actions page" however
   * the route is parameterised. The heading says so and no level tab claims
   * the page.
   */
  board?: boolean;
  counts: PlanCounts;
  chip: PlanChip;
  onChip: (next: PlanChip) => void;
  onFullScreen: () => void;
}

/** The two quiet buttons on the right: same size, same thin border, navy on hover. */
const TOP_BTN =
  "inline-flex items-center gap-1.5 rounded-lg px-3 h-9 text-[13px] font-semibold whitespace-nowrap transition-colors duration-150 hover:bg-[#F1F5FB] hover:border-[#B9C6DA] hover:text-[#0B2250] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#14336B] active:bg-[#E7EDF7] motion-reduce:transition-none";

export function PlanToolbar({ level, board = false, counts, chip, onChip, onFullScreen }: Props) {
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
      {/* ── Title, subtitle, and the two page-level buttons ────────────── */}
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2.5 mb-3">
        <div className="min-w-0 flex-1 basis-[240px]">
          {/* A level-1 heading on a div, on purpose: globals.css sizes every
              <h1> at 30–46px with !important so page titles match app-wide, and
              no inline size can beat that. The role keeps it the page's h1. */}
          <div
            role="heading"
            aria-level={1}
            className="font-bold"
            style={{ fontSize: 20, lineHeight: 1.2, letterSpacing: "-0.012em", color: "#0B2250" }}
          >
            {board ? "Project Plan" : KIND_LABEL_PLURAL[LEVEL_KIND[level]]}
          </div>
          <p className="mt-0.5 text-[13px]" style={{ color: "var(--color-ink-muted)" }}>
            {board
              ? "Every row of the plan as a card, grouped by status — projects, milestones, results, actions and sub-actions together."
              : SUBTITLE[level]}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* The whole plan as one tree: a link to the existing Project Views. */}
          <Link
            href={"/project-plan/views" as Route}
            className={TOP_BTN}
            style={{ color: "var(--color-ink-muted)", background: "#FFFFFF", border: `1px solid ${PLAN_EDGE}` }}
          >
            <ListTree size={14} strokeWidth={2.2} />
            Hierarchy view
          </Link>
          <button
            type="button"
            onClick={onFullScreen}
            className={TOP_BTN}
            style={{ color: "var(--color-ink-muted)", background: "#FFFFFF", border: `1px solid ${PLAN_EDGE}` }}
          >
            <Maximize2 size={13} strokeWidth={2.3} />
            Full screen
          </button>
        </div>
      </div>

      {/* ── The level tabs, then the count chips (clickable as filters) ── */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <nav
          aria-label="Level"
          className="no-scrollbar inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-lg p-0.5"
          style={{ background: "#EEF2F8" }}
        >
          {REGISTER_LEVELS.map((l) => {
            const active = !board && l === level;
            return (
              <Link
                key={l}
                href={hrefFor(l)}
                aria-current={active ? "page" : undefined}
                className="inline-flex items-center gap-1.5 rounded-md px-3 h-8 text-[13.5px] font-semibold whitespace-nowrap transition-colors duration-150 hover:text-[#0B2250] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#14336B] motion-reduce:transition-none"
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
                className="inline-flex items-center gap-1.5 rounded-full px-2.5 h-7 text-[12.5px] font-semibold whitespace-nowrap transition-colors duration-150 hover:bg-[#F1F5FB] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[#14336B] motion-reduce:transition-none"
                style={{
                  color: active ? PLAN_RED : "var(--color-ink)",
                  background: active ? "#EAF0FA" : "#FFFFFF",
                  border: `1px solid ${active ? PLAN_RED : PLAN_EDGE}`,
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
        </div>
      </div>
    </div>
  );
}
