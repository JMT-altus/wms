"use client";

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatInrCompactPaise } from "@/lib/format";
import type { PeriodTotals } from "@/lib/queries/targets";
import { MEASURE_COLORS } from "./theme";

/** Rupee-crore axis — full paise figures would be unreadable at chart scale. */
const axisFmt = (v: number) => formatInrCompactPaise(v).replace("₹", "");

function ChartCard({
  title,
  hint,
  children,
  height = 280,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  height?: number;
}) {
  return (
    <div className="rounded-section border border-hairline bg-surface-card p-4 min-w-0">
      <p className="font-bold text-ink-strong" style={{ fontSize: 14.5 }}>
        {title}
      </p>
      {hint && (
        <p className="text-ink-muted mb-2" style={{ fontSize: 12.5 }}>
          {hint}
        </p>
      )}
      <div style={{ height }}>{children}</div>
    </div>
  );
}

// Recharts hands the formatter a loose ValueType, so coerce rather than assert.
const tooltipProps = {
  formatter: (v: unknown, name: unknown): [string, string] => [
    formatInrCompactPaise(Number(v) || 0),
    String(name ?? ""),
  ],
  contentStyle: {
    borderRadius: 10,
    border: "1px solid var(--color-hairline)",
    fontSize: 13,
  },
};

/** Target / Forecast / Estimated / Actual across the periods of a year. */
export function PeriodComparisonChart({ data }: { data: PeriodTotals[] }) {
  return (
    <ChartCard
      title="Target, forecast, estimate and actual"
      hint="Every period of the year side by side. Actual only exists once Tally has been imported."
      height={300}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 8, left: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-hairline)" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-18} textAnchor="end" height={54} />
          <YAxis tickFormatter={axisFmt} tick={{ fontSize: 11 }} width={62} />
          <Tooltip {...tooltipProps} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="targetPaise" name="Target" fill={MEASURE_COLORS.target} radius={[3, 3, 0, 0]} />
          <Bar dataKey="forecastPaise" name="Forecast" fill={MEASURE_COLORS.forecast} radius={[3, 3, 0, 0]} />
          <Bar dataKey="estimatedPaise" name="Estimated" fill={MEASURE_COLORS.estimated} radius={[3, 3, 0, 0]} />
          <Bar dataKey="actualPaise" name="Actual" fill={MEASURE_COLORS.actual} radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

export interface MoverRow {
  name: string;
  variancePaise: number;
}

/**
 * The customers furthest from their forecast, either way.
 *
 * Both directions on one chart on purpose: a customer massively over forecast
 * is as much a planning miss as one under, and only showing shortfalls trains
 * people to sandbag.
 */
export function TopMoversChart({ rows }: { rows: MoverRow[] }) {
  if (rows.length === 0) {
    return (
      <ChartCard title="Biggest gaps to forecast">
        <p className="text-ink-muted flex items-center justify-center h-full" style={{ fontSize: 13.5 }}>
          Nothing to compare yet — import some actuals first.
        </p>
      </ChartCard>
    );
  }
  return (
    <ChartCard
      title="Biggest gaps to forecast"
      hint="Actual minus forecast. Over-performance counts as a miss too."
      height={Math.max(200, rows.length * 34 + 40)}
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--color-hairline)" />
          <XAxis type="number" tickFormatter={axisFmt} tick={{ fontSize: 11 }} />
          <YAxis type="category" dataKey="name" tick={{ fontSize: 11.5 }} width={140} />
          <Tooltip {...tooltipProps} />
          <Bar dataKey="variancePaise" name="Variance" radius={[0, 3, 3, 0]}>
            {rows.map((r, i) => (
              <Cell
                key={i}
                fill={r.variancePaise >= 0 ? MEASURE_COLORS.actual : "#DC2626"}
              />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </ChartCard>
  );
}

/** A single horizontal bar: how far through the year's target we are. */
export function ProgressBar({
  targetPaise,
  forecastPaise,
  estimatedPaise,
  actualPaise,
}: {
  targetPaise: number;
  forecastPaise: number;
  estimatedPaise: number;
  actualPaise: number;
}) {
  const scale = Math.max(targetPaise, forecastPaise, estimatedPaise, actualPaise, 1);
  const bars = [
    { label: "Target", value: targetPaise, color: MEASURE_COLORS.target },
    { label: "Forecast", value: forecastPaise, color: MEASURE_COLORS.forecast },
    { label: "Estimated", value: estimatedPaise, color: MEASURE_COLORS.estimated },
    { label: "Actual", value: actualPaise, color: MEASURE_COLORS.actual },
  ];
  return (
    <div className="rounded-section border border-hairline bg-surface-card p-4">
      <p className="font-bold text-ink-strong mb-3" style={{ fontSize: 14.5 }}>
        Where the year stands
      </p>
      <div className="grid gap-2.5">
        {bars.map((b) => (
          <div key={b.label} className="flex items-center gap-3">
            <span
              className="shrink-0 uppercase font-bold tracking-[0.08em] text-ink-subtle"
              style={{ fontSize: 10.5, width: 78 }}
            >
              {b.label}
            </span>
            <span className="flex-1 min-w-0 h-5 rounded-pill" style={{ background: "var(--color-surface-soft)" }}>
              <span
                className="block h-full rounded-pill transition-all"
                style={{ width: `${Math.max(1, (b.value / scale) * 100)}%`, background: b.color }}
              />
            </span>
            <span
              className="shrink-0 font-bold text-ink-strong tabular-nums text-right"
              style={{ fontSize: 13, width: 92 }}
            >
              {formatInrCompactPaise(b.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
