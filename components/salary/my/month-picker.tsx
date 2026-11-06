"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { shiftMonthKey } from "@/lib/salary/daily-report";
import { BORDER, NAVY, SLATE } from "@/components/salary/ui";

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
  const btn =
    "grid size-8 place-items-center rounded-md transition-colors hover:bg-[#F3F6FA] hover:text-[#0B4FB8] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#0A6CFF]/20";
  return (
    <div className="inline-flex h-9 items-center gap-0.5 rounded-lg bg-white px-0.5" style={{ border: `1px solid ${BORDER}`, color: SLATE }} aria-busy={pending}>
      <button type="button" aria-label="Previous month" className={btn} disabled={prev < min || pending} onClick={() => go(prev)}>
        <ChevronLeft size={15} strokeWidth={2.2} />
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
        className="salary-month-input h-8 rounded-md border-0 bg-transparent px-1.5 text-[13px] font-semibold tabular-nums shadow-none focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#0A6CFF]/20"
        style={{ color: NAVY }}
      />
      <button type="button" aria-label="Next month" className={btn} disabled={next > max || pending} onClick={() => go(next)}>
        <ChevronRight size={15} strokeWidth={2.2} />
      </button>
    </div>
  );
}
