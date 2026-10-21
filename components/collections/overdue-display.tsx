"use client";

import * as React from "react";
import { businessDate, msUntilNextBusinessDay, type OverdueLevel } from "@/lib/collections/overdue";

/**
 * How the Collection screens show the overdue level (lib/collections/overdue.ts
 * decides it; COLLECTION_RULES holds the thresholds). Shared by the Collection
 * Tracker and the commitments page so both colour a company the same.
 */

/** Row tint, edge and label per overdue level. Colour is never the only signal. */
export const LEVEL_STYLE: Record<Exclude<OverdueLevel, "none">, { bg: string; edge: string; fg: string; label: string }> = {
  warning: { bg: "#FFFBEB", edge: "#F59E0B", fg: "#92400E", label: "Overdue" },
  critical: { bg: "#FEF2F2", edge: "#DC2626", fg: "#B91C1C", label: "Overdue" },
};

/** Row style for a level, or undefined for "none". */
export function overdueRowStyle(level: OverdueLevel): React.CSSProperties | undefined {
  if (level === "none") return undefined;
  const tone = LEVEL_STYLE[level];
  return { background: tone.bg, boxShadow: `inset 3px 0 0 ${tone.edge}` };
}

/** The "Overdue N days" pill shown next to the company name. */
export function OverdueBadge({ level, daysOverdue }: { level: OverdueLevel; daysOverdue: number | null }) {
  if (level === "none") return null;
  const tone = LEVEL_STYLE[level];
  return (
    <span className="ml-2 rounded-full px-1.5 py-0.5 text-[11px] font-bold" style={{ color: tone.fg, border: `1px solid ${tone.edge}` }}>
      {tone.label} {daysOverdue} day{daysOverdue === 1 ? "" : "s"}
    </span>
  );
}

/**
 * The business date, rolled over at India midnight while the page stays open,
 * so a row turns yellow/red on the right day without a reload.
 */
export function useBusinessToday(initial: string): string {
  const [rolled, setRolled] = React.useState<string | null>(null);
  React.useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const arm = () => {
      t = setTimeout(() => {
        setRolled(businessDate(new Date()));
        arm();
      }, msUntilNextBusinessDay(new Date()));
    };
    arm();
    return () => clearTimeout(t);
  }, []);
  // YYYY-MM-DD compares as text; the later of the server's date and the rollover wins.
  return rolled !== null && rolled > initial ? rolled : initial;
}
