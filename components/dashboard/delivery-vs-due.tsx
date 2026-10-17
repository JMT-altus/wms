"use client";

import * as React from "react";
import { CalendarClock } from "lucide-react";
import type { DashboardInsights } from "@/lib/types";
import { SectionHeader } from "./section-header";
import { SectionShareActions, type SectionReportInput } from "./section-share";

type Delivery = DashboardInsights["delivery"];
type Bucket = Delivery["lateBuckets"][number];

/** One colour per bucket: warm and dark for the worst delays, cool for early. */
const TONES: Record<string, { fill: string; chip: string; chipText: string; outline?: boolean }> = {
  o22: { fill: "#6d28a8", chip: "#6d28a8", chipText: "#fff" },
  o15: { fill: "#7f1d1d", chip: "#7f1d1d", chipText: "#fff" },
  o8: { fill: "#dc2626", chip: "#dc2626", chipText: "#fff" },
  o4: { fill: "#f97316", chip: "#f97316", chipText: "#fff" },
  o1: { fill: "#fbbf24", chip: "#fbbf24", chipText: "#422006" },
  today: { fill: "#ffffff", chip: "#ffffff", chipText: "#0f172a", outline: true },
  b1: { fill: "#38bdf8", chip: "#38bdf8", chipText: "#fff" },
  b4: { fill: "#2563eb", chip: "#2563eb", chipText: "#fff" },
  b8: { fill: "#059669", chip: "#059669", chipText: "#fff" },
};

function BucketRow({ bucket, max }: { bucket: Bucket; max: number }) {
  const t = TONES[bucket.key] ?? TONES.o1!;
  const width = max > 0 ? (bucket.count / max) * 100 : 0;
  return (
    <div className="grid items-center gap-3" style={{ gridTemplateColumns: "minmax(0, 1.05fr) minmax(0, 1.2fr) 52px" }}>
      <span className="truncate text-[13px] font-bold text-ink-strong" title={bucket.label}>
        {bucket.label}
      </span>
      <div className="h-3 overflow-hidden rounded-full bg-[#F1F3F7]" style={t.outline ? { boxShadow: "inset 0 0 0 1px #d6dbe4" } : undefined}>
        <div
          className="h-full rounded-full"
          style={{
            width: `${width}%`,
            background: t.fill,
            boxShadow: t.outline ? "inset 0 0 0 1px #c3cad6" : undefined,
          }}
        />
      </div>
      <span
        className="inline-flex h-6 items-center justify-center rounded-md px-1.5 text-[12.5px] font-bold tabular-nums"
        style={{
          background: t.chip,
          color: t.chipText,
          boxShadow: t.outline ? "inset 0 0 0 1px #c3cad6" : undefined,
        }}
      >
        {bucket.count}
      </span>
    </div>
  );
}

/**
 * Delivery vs Due Date — when finished work (Done / Approved) was completed
 * against its ORIGINAL due date: how many days late on one side, on the day or
 * early on the other, with the on-time share summarised top right.
 */
export function DeliveryVsDue({ data }: { data: Delivery }) {
  const [collapsed, setCollapsed] = React.useState(false);
  const comparable = data.lateTotal + data.onBeforeTotal;
  const lateMax = Math.max(...data.lateBuckets.map((b) => b.count), 0);
  const onMax = Math.max(...data.onTimeBuckets.map((b) => b.count), 0);

  const buildReport = React.useCallback(
    (): SectionReportInput => ({
      title: "Delivery vs Due Date",
      subtitle: `${data.onTimePct}% on time · ${data.onBeforeTotal} on/before · ${data.lateTotal} late`,
      columns: ["When delivered", "Tasks"],
      rows: [...data.lateBuckets, ...data.onTimeBuckets].map((b) => [b.label, String(b.count)]),
    }),
    [data],
  );

  return (
    <SectionHeader
      id="delivery-vs-due"
      icon={<CalendarClock size={18} strokeWidth={2.2} />}
      tone="blue"
      title="Delivery vs Due Date"
      collapsed={collapsed}
      onToggle={() => setCollapsed((v) => !v)}
      actions={<SectionShareActions title="Delivery vs Due Date" buildReport={buildReport} />}
    >
      <div
        className="rounded-section p-4 max-md:p-3"
        style={{
          background: "#ffffff",
          border: "1px solid var(--color-hairline-strong)",
          boxShadow: "0 1px 2px rgba(15, 23, 42, 0.05), 0 8px 24px -16px rgba(15, 23, 42, 0.16)",
        }}
      >
        {comparable === 0 ? (
          <p className="px-3 py-8 text-center text-[13px] font-medium text-ink-subtle">
            No completed tasks with a completion date for the current filters.
          </p>
        ) : (
          <>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <span className="text-[13px] font-bold uppercase tracking-[0.1em] text-ink-strong">
                By original due date
              </span>
              <div
                className="inline-flex items-center gap-2.5 rounded-lg border border-hairline bg-white px-3 py-1.5 text-[12px] font-semibold text-ink-subtle"
                style={{ boxShadow: "0 1px 3px rgba(15,23,42,0.06)" }}
              >
                <span><span className="text-[15px] font-bold tabular-nums text-[#059669]">{data.onTimePct}%</span> on time</span>
                <span aria-hidden>•</span>
                <span><span className="text-[15px] font-bold tabular-nums text-ink-strong">{data.onBeforeTotal}</span> On / Before</span>
                <span aria-hidden>•</span>
                <span><span className="text-[15px] font-bold tabular-nums text-[#dc2626]">{data.lateTotal}</span> Late</span>
              </div>
            </div>

            <div className="grid gap-x-10 gap-y-6 lg:grid-cols-2">
              <div>
                <p className="mb-3 text-[11.5px] font-bold uppercase tracking-[0.08em] text-ink-subtle">Overdue</p>
                <div className="grid gap-3.5">
                  {data.lateBuckets.map((b) => (
                    <BucketRow key={b.key} bucket={b} max={lateMax} />
                  ))}
                </div>
              </div>
              <div>
                <p className="mb-3 text-[11.5px] font-bold uppercase tracking-[0.08em] text-ink-subtle">On time &amp; early</p>
                <div className="grid gap-3.5">
                  {data.onTimeBuckets.map((b) => (
                    <BucketRow key={b.key} bucket={b} max={onMax} />
                  ))}
                </div>
              </div>
            </div>
          </>
        )}

        {data.noComparableDate > 0 && (
          <p className="mt-4 text-[11.5px] font-bold text-ink-subtle">
            {data.noComparableDate} Done Without a Comparable Date — Not Counted.
          </p>
        )}

      </div>
    </SectionHeader>
  );
}
