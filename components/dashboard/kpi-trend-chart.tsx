"use client";

import * as React from "react";
import { format, parseISO } from "date-fns";
import type { VelocityPoint } from "@/lib/types";

const W = 640;
const H = 180;
const PAD_X = 8;
const PAD_Y = 14;

/**
 * Created vs completed, day by day.
 *
 * Two series rather than one, because a KPI's own count says nothing about
 * whether the team is keeping up: work coming in (solid) read against work
 * going out (dashed) is the shape you actually want. Hovering anywhere on the
 * plot reads out both numbers for that day — no need to hit a 3px point.
 */
export function KpiTrendChart({ points }: { points: VelocityPoint[] }) {
  const [hover, setHover] = React.useState<number | null>(null);
  const series = points.length > 0 ? points : [];

  if (series.length < 2) {
    return (
      <div className="flex h-[180px] items-center justify-center text-[13px] text-ink-subtle">
        Not enough history to plot yet.
      </div>
    );
  }

  const max = Math.max(1, ...series.map((p) => Math.max(p.created, p.completed)));
  const xAt = (i: number) => PAD_X + (i / (series.length - 1)) * (W - 2 * PAD_X);
  const yAt = (v: number) => H - PAD_Y - (v / max) * (H - 2 * PAD_Y);

  const path = (pick: (p: VelocityPoint) => number) =>
    series
      .map((p, i) => `${i === 0 ? "M" : "L"}${xAt(i).toFixed(1)},${yAt(pick(p)).toFixed(1)}`)
      .join(" ");

  const createdPath = path((p) => p.created);
  const completedPath = path((p) => p.completed);
  const areaPath = `${createdPath} L${xAt(series.length - 1).toFixed(1)},${H - PAD_Y} L${xAt(0).toFixed(1)},${H - PAD_Y} Z`;

  const active = hover != null ? series[hover] : null;
  // Flip the tooltip to the left of the guide once the point is past the
  // halfway mark, so it never runs off the panel.
  const activeLeftPct = hover != null ? (xAt(hover) / W) * 100 : 0;
  const flip = activeLeftPct > 55;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full touch-none"
        style={{ height: H }}
        role="img"
        aria-label="Tasks created versus completed per day"
        onPointerLeave={() => setHover(null)}
        onPointerMove={(e) => {
          const box = e.currentTarget.getBoundingClientRect();
          const ratio = (e.clientX - box.left) / box.width;
          const i = Math.round(ratio * (series.length - 1));
          setHover(Math.min(series.length - 1, Math.max(0, i)));
        }}
      >
        <defs>
          <linearGradient id="kpi-trend-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-ink-strong)" stopOpacity={0.12} />
            <stop offset="100%" stopColor="var(--color-ink-strong)" stopOpacity={0} />
          </linearGradient>
        </defs>

        <path d={areaPath} fill="url(#kpi-trend-fill)" />

        {active && hover != null && (
          <line
            x1={xAt(hover)}
            y1={PAD_Y - 6}
            x2={xAt(hover)}
            y2={H - PAD_Y}
            stroke="var(--color-hairline-strong)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        )}

        <path
          d={completedPath}
          fill="none"
          stroke="var(--color-slate)"
          strokeWidth={1.8}
          strokeDasharray="5 4"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={createdPath}
          fill="none"
          stroke="var(--color-ink-strong)"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {active && hover != null && (
          <>
            <circle
              cx={xAt(hover)}
              cy={yAt(active.completed)}
              r={4}
              fill="#ffffff"
              stroke="var(--color-slate)"
              strokeWidth={1.8}
              vectorEffect="non-scaling-stroke"
            />
            <circle cx={xAt(hover)} cy={yAt(active.created)} r={4} fill="var(--color-ink-strong)" />
          </>
        )}
      </svg>

      {active && (
        <div
          className="pointer-events-none absolute top-2 z-10 rounded-chip border border-hairline-strong bg-white px-3 py-2 shadow-lg"
          style={{
            left: `${activeLeftPct}%`,
            transform: flip ? "translateX(calc(-100% - 10px))" : "translateX(10px)",
          }}
        >
          <p className="text-[13px] font-bold text-ink-strong">
            {format(parseISO(active.date), "d MMM yyyy")}
          </p>
          <p className="mt-1 flex items-center gap-1.5 text-[12.5px] text-ink-soft">
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ background: "var(--color-ink-strong)" }}
            />
            <span className="font-bold text-ink-strong tabular-nums">{active.created}</span>
            Tasks Created
          </p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[12.5px] text-ink-soft">
            <span
              aria-hidden
              className="h-0 w-3 border-t-2 border-dashed"
              style={{ borderColor: "var(--color-slate)" }}
            />
            <span className="font-bold text-ink-strong tabular-nums">{active.completed}</span>
            Completed
          </p>
        </div>
      )}

      {/* Axis ends + legend, on one line: the range is the two dates, and the
          legend explains the two strokes without a boxed key. */}
      <div className="mt-1.5 flex items-center justify-between gap-3 text-[11.5px] font-semibold text-ink-subtle">
        <span className="tabular-nums">{format(parseISO(series[0]!.date), "d MMM yyyy")}</span>
        <span className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="size-2 rounded-full"
              style={{ background: "var(--color-ink-strong)" }}
            />
            Created
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden
              className="h-0 w-4 border-t-2 border-dashed"
              style={{ borderColor: "var(--color-slate)" }}
            />
            Completed
          </span>
        </span>
        <span className="tabular-nums">
          {format(parseISO(series[series.length - 1]!.date), "d MMM yyyy")}
        </span>
      </div>
    </div>
  );
}
