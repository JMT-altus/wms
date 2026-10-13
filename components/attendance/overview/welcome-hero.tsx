import { CalendarDays } from "lucide-react";
import { ACCENT, ACCENT_TEXT, BORDER, NAVY, SLATE } from "./theme";

/**
 * The welcome area: light and understated — a strong navy heading, one line of
 * muted supporting text and a compact date. No surface of its own; it sits on
 * the page ground so the sections below carry the weight.
 *
 * Presentational only — the greeting, subtitle and date arrive as text, so the
 * name still comes from the signed-in employee in the page.
 */
export function WelcomeHero({
  greeting,
  subtitle,
  dateLabel,
}: {
  greeting: string;
  subtitle: string;
  dateLabel: string;
}) {
  return (
    <header className="flex items-end justify-between gap-x-6 gap-y-3 flex-wrap pt-1 pb-1">
      <div className="min-w-0">
        <p className="text-[12px] font-semibold uppercase tracking-[0.12em]" style={{ color: ACCENT_TEXT }}>
          Attendance
        </p>
        <h1
          className="mt-1 text-[26px] max-md:text-[22px] font-bold tracking-[-0.02em] leading-tight"
          style={{ color: NAVY }}
        >
          {greeting}
        </h1>
        <p className="mt-1.5 text-[14.5px] leading-snug" style={{ color: SLATE }}>
          {subtitle}
        </p>
      </div>

      <span
        className="inline-flex items-center gap-1.5 rounded-lg px-2.5 h-8 text-[13px] font-medium tabular-nums bg-white"
        style={{ color: NAVY, border: `1px solid ${BORDER}` }}
      >
        <CalendarDays size={14} strokeWidth={2} aria-hidden style={{ color: ACCENT }} />
        {dateLabel}
      </span>
    </header>
  );
}
