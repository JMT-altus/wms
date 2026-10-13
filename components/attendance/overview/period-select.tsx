"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { ChevronDown, Loader2 } from "lucide-react";
import { MONTH_NAMES } from "@/lib/attendance/overview";
import { ACCENT, BORDER, NAVY, SLATE } from "./theme";

/**
 * The reporting period: a month and a year, read together as one period.
 *
 * Both are native <select>s — keyboard, screen-reader and mobile-picker
 * behaviour come for free — drawn as quiet bordered controls like the rest of
 * the app's. A change navigates to `?y=&m=`, which is also what the calendar's
 * arrows write, so the two are the same state: the URL. This component holds
 * no copy of it beyond the instant between picking and the page arriving, and
 * it is keyed by (year, month) at the call site so it resets itself whenever
 * the URL moves some other way.
 */
export function PeriodSelect({
  year,
  month,
  years,
  currentYear,
  currentMonth,
}: {
  year: number;
  month: number;
  /** Newest first. */
  years: number[];
  currentYear: number;
  currentMonth: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = React.useTransition();
  const [sel, setSel] = React.useState({ year, month });

  function go(next: { year: number; month: number }) {
    setSel(next);
    // The current month is the default, so it is the absence of a query.
    const q =
      next.year === currentYear && next.month === currentMonth
        ? ""
        : `?y=${next.year}&m=${next.month}`;
    startTransition(() => router.push(`/attendance${q}` as Route, { scroll: false }));
  }

  return (
    <div className="flex items-center gap-2" aria-busy={pending}>
      <Field label="Month">
        <select
          aria-label="Month"
          value={sel.month}
          onChange={(e) => go({ year: sel.year, month: Number(e.target.value) })}
          className={SELECT}
          style={{ color: NAVY, minWidth: 108 }}
        >
          {MONTH_NAMES.map((name, i) => (
            <option key={name} value={i + 1}>
              {name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Year">
        <select
          aria-label="Year"
          value={sel.year}
          onChange={(e) => go({ year: Number(e.target.value), month: sel.month })}
          className={SELECT}
          style={{ color: NAVY }}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </Field>
      {pending && (
        <Loader2
          size={15}
          strokeWidth={2.4}
          aria-label="Loading"
          className="animate-spin motion-reduce:animate-none"
          style={{ color: ACCENT }}
        />
      )}
    </div>
  );
}

const SELECT =
  "appearance-none h-full bg-transparent pr-6 text-[13.5px] font-semibold outline-none cursor-pointer";

/** A bordered shell with a chevron; the focus ring is drawn on the whole control. */
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label
      className="relative inline-flex items-center h-9 rounded-lg pl-3 pr-1 bg-white transition-colors duration-150 hover:border-[#C5D0DE] focus-within:border-[#0D9488] focus-within:shadow-[0_0_0_3px_rgba(13,148,136,0.18)] motion-reduce:transition-none"
      style={{ border: `1px solid ${BORDER}` }}
      title={label}
    >
      {children}
      <ChevronDown
        size={14}
        strokeWidth={2.2}
        aria-hidden
        className="pointer-events-none absolute right-2.5"
        style={{ color: SLATE }}
      />
    </label>
  );
}
