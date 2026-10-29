"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { shiftMonthKey } from "@/lib/salary/daily-report";
import { BORDER, NAVY, SLATE } from "@/components/attendance/overview/theme";

/**
 * The one control that drives the My Salary page: the month, kept in the URL
 * as `?month=YYYY-MM` so every card reads the same value. Bounded to the months
 * the employee has records for (`min`) and the current month (`max`).
 */
export function SalaryMonthPicker({
  month,
  min,
  max,
  basePath = "/my-salary",
  inputId = "my-salary-month",
  label = "Salary month",
}: {
  month: string;
  min: string;
  max: string;
  basePath?: string;
  /** The input's id and accessible name — the Salary page uses its own so the two never collide. */
  inputId?: string;
  label?: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (next: string) => {
    if (!/^\d{4}-\d{2}$/.test(next) || next < min || next > max || next === month) return;
    start(() => router.push(`${basePath}?month=${next}` as Route, { scroll: false }));
  };
  const prev = shiftMonthKey(month, -1);
  const next = shiftMonthKey(month, 1);
  const btn = "grid place-items-center size-9 rounded-lg transition-colors hover:bg-[#F3F6FA] disabled:opacity-35 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0A6CFF]";
  return (
    <div className="inline-flex items-center gap-1 rounded-lg bg-white p-0.5" style={{ border: `1px solid ${BORDER}`, color: SLATE }} aria-busy={pending}>
      <button type="button" aria-label="Previous month" className={btn} disabled={prev < min || pending} onClick={() => go(prev)}>
        <ChevronLeft size={16} strokeWidth={2.2} />
      </button>
      <label className="sr-only" htmlFor={inputId}>
        {label}
      </label>
      <input
        id={inputId}
        type="month"
        value={month}
        min={min}
        max={max}
        onChange={(e) => go(e.target.value)}
        className="h-9 rounded-md bg-transparent px-2 text-[14px] font-semibold tabular-nums focus-visible:outline-2 focus-visible:outline-[#0A6CFF]"
        style={{ color: NAVY }}
      />
      <button type="button" aria-label="Next month" className={btn} disabled={next > max || pending} onClick={() => go(next)}>
        <ChevronRight size={16} strokeWidth={2.2} />
      </button>
    </div>
  );
}
