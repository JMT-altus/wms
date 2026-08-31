"use client";

import * as React from "react";
import { Flame, ListChecks, PenLine } from "lucide-react";
import { pctTone } from "@/lib/dcc/util";
import type { DayStats, TrendDay } from "@/lib/dcc/board-model";

/** SVG progress ring — the day's compliance at a glance. */
export function ComplianceRing({
  pct,
  done,
  due,
}: {
  pct: number;
  done: number;
  due: number;
}) {
  const size = 92;
  const stroke = 9;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const tone = pctTone(pct);
  return (
    <div className="flex items-center gap-3.5">
      <svg width={size} height={size} className="shrink-0 -rotate-90" aria-hidden>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--color-surface-track)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone.solid}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c - (Math.min(100, Math.max(0, pct)) / 100) * c}
          style={{ transition: "stroke-dashoffset 420ms cubic-bezier(.4,0,.2,1)" }}
        />
      </svg>
      <div>
        <div
          className="text-[30px] font-black leading-none tabular-nums"
          style={{ color: tone.fg, fontFamily: "var(--font-serif)" }}
        >
          {pct}%
        </div>
        <div className="mt-1 text-[12px] font-semibold text-ink-subtle tabular-nums">
          {done}/{due} done
        </div>
      </div>
    </div>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-kpi border border-hairline bg-surface-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      {children}
    </div>
  );
}

function CardLabel({ children }: { children: React.ReactNode }) {
  return <div className="text-kpi-label mb-2 text-ink-subtle">{children}</div>;
}

/** The four-up stat grid. Collapses to two columns on small screens. */
export function DccStatCards({
  stats,
  streak,
  totalItems,
}: {
  stats: DayStats;
  streak: number;
  totalItems: number;
}) {
  const filledTone = pctTone(stats.filledPct);
  return (
    <div className="grid grid-cols-4 gap-3 max-lg:grid-cols-2">
      <Card>
        <CardLabel>Compliance</CardLabel>
        <ComplianceRing pct={stats.pct} done={stats.done} due={stats.due} />
      </Card>

      <Card>
        <CardLabel>Filled</CardLabel>
        <div className="flex items-baseline gap-1.5">
          <span
            className="text-[30px] font-black leading-none tabular-nums"
            style={{ color: filledTone.fg, fontFamily: "var(--font-serif)" }}
          >
            {stats.filled}
          </span>
          <span className="text-[15px] font-bold text-ink-subtle tabular-nums">
            /{stats.due}
          </span>
          <PenLine size={15} className="ml-auto text-ink-subtle" aria-hidden />
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-track">
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{
              width: `${Math.min(100, stats.filledPct)}%`,
              background: filledTone.solid,
            }}
          />
        </div>
      </Card>

      <Card>
        <CardLabel>Streak</CardLabel>
        <div className="flex items-center gap-2">
          <Flame
            size={26}
            style={{ color: streak > 0 ? "var(--color-orange)" : "var(--color-stone)" }}
            aria-hidden
          />
          <span
            className="text-[30px] font-black leading-none tabular-nums text-ink-strong"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {streak}
          </span>
          <span className="self-end pb-1 text-[12px] font-semibold text-ink-subtle">
            {streak === 1 ? "day" : "days"}
          </span>
        </div>
        <div className="mt-2 text-[11.5px] text-ink-subtle">
          {streak > 0 ? "Every due KPI filled" : "Fill today's list to start one"}
        </div>
      </Card>

      <Card>
        <CardLabel>KPIs</CardLabel>
        <div className="flex items-center gap-2">
          <ListChecks size={24} className="text-ink-muted" aria-hidden />
          <span
            className="text-[30px] font-black leading-none tabular-nums text-ink-strong"
            style={{ fontFamily: "var(--font-serif)" }}
          >
            {stats.due}
          </span>
        </div>
        <div className="mt-2 text-[11.5px] text-ink-subtle tabular-nums">
          due this day · {totalItems} total
        </div>
      </Card>
    </div>
  );
}

/**
 * 21-day trend strip. Bar height scales with that day's %, colour follows the
 * same 80/60 thresholds, and a day with nothing due is grey rather than red —
 * a Sunday is not a failure.
 */
export function DccTrendStrip({
  days,
  selected,
  onSelect,
}: {
  days: TrendDay[];
  selected: string;
  onSelect: (date: string) => void;
}) {
  return (
    <div className="rounded-kpi border border-hairline bg-surface-card p-4">
      <div className="text-kpi-label mb-3 text-ink-subtle">Last 21 days</div>
      <div className="flex items-end gap-[3px]" style={{ height: 56 }}>
        {days.map((d) => {
          const tone = pctTone(d.pct);
          const height = d.idle ? 6 : Math.max(6, (d.pct / 100) * 48);
          const isSelected = d.date === selected;
          return (
            <button
              key={d.date}
              type="button"
              onClick={() => onSelect(d.date)}
              title={`${d.date} — ${d.idle ? "nothing due" : `${d.done}/${d.due} (${d.pct}%)`}`}
              aria-label={`${d.date}, ${d.idle ? "nothing due" : `${d.pct} percent`}`}
              className="group flex flex-1 flex-col justify-end rounded-[3px] transition"
              style={{ height: "100%" }}
            >
              <span
                className="w-full rounded-[3px] transition-all"
                style={{
                  height,
                  background: d.idle ? "var(--color-surface-track)" : tone.solid,
                  outline: isSelected ? "2px solid var(--color-ink-strong)" : undefined,
                  outlineOffset: 1,
                }}
              />
            </button>
          );
        })}
      </div>
    </div>
  );
}
