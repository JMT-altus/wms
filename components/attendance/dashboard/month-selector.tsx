"use client";

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { ChevronLeft, ChevronRight } from "lucide-react";

const MONTH_LABELS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** A native month input would be ideal, but support is patchy — so we drive
 *  the `?y=&m=` query with a labelled month/year pair plus prev/next chevrons.
 *  Server re-renders the dashboard for the chosen month. */
export function AttendanceMonthSelector({
  year,
  month,
}: {
  year: number;
  month: number;
}) {
  const router = useRouter();

  function go(y: number, m: number) {
    // Normalise month overflow/underflow into year rollover.
    let yy = y;
    let mm = m;
    if (mm < 1) {
      mm = 12;
      yy -= 1;
    } else if (mm > 12) {
      mm = 1;
      yy += 1;
    }
    router.push(`/attendance/dashboard?y=${yy}&m=${mm}` as Route);
  }

  // Year window: current ± a few, so the picker stays sane.
  const years: number[] = [];
  for (let y = year - 3; y <= year + 1; y++) years.push(y);

  return (
    <div className="inline-flex items-center gap-1.5">
      <button
        type="button"
        aria-label="Previous month"
        onClick={() => go(year, month - 1)}
        className="inline-flex size-9 items-center justify-center rounded-lg border border-[#D6DEEB] bg-white text-[#475569] transition-colors hover:border-[#0A6CFF] hover:text-[#0B4FB8] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#0A6CFF]/20"
      >
        <ChevronLeft size={15} strokeWidth={2.4} />
      </button>

      <select
        value={month}
        aria-label="Month"
        onChange={(e) => go(year, Number(e.target.value))}
        className="h-9 rounded-lg border border-[#D6DEEB] bg-white px-2.5 text-[13px] font-semibold text-[#0B1F44] transition-colors hover:border-[#B9C6DB] focus:border-[#0A6CFF] focus:outline-none focus:ring-[3px] focus:ring-[#0A6CFF]/15"
      >
        {MONTH_LABELS.map((label, i) => (
          <option key={label} value={i + 1}>
            {label}
          </option>
        ))}
      </select>

      <select
        value={year}
        aria-label="Year"
        onChange={(e) => go(Number(e.target.value), month)}
        className="h-9 rounded-lg border border-[#D6DEEB] bg-white px-2.5 text-[13px] font-semibold text-[#0B1F44] transition-colors hover:border-[#B9C6DB] focus:border-[#0A6CFF] focus:outline-none focus:ring-[3px] focus:ring-[#0A6CFF]/15 tabular-nums"
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>

      <button
        type="button"
        aria-label="Next month"
        onClick={() => go(year, month + 1)}
        className="inline-flex size-9 items-center justify-center rounded-lg border border-[#D6DEEB] bg-white text-[#475569] transition-colors hover:border-[#0A6CFF] hover:text-[#0B4FB8] focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-[#0A6CFF]/20"
      >
        <ChevronRight size={15} strokeWidth={2.4} />
      </button>
    </div>
  );
}
