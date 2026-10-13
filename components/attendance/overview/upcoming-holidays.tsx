import { CalendarHeart, ChevronDown, Info } from "lucide-react";
import { timeUntil } from "@/lib/attendance/overview";
import type { HolidayRow } from "@/lib/queries/holidays";
import { ACCENT, ACCENT_TEXT, BORDER_SOFT, CARD, NAVY, SLATE, TONE } from "./theme";

const MONTH_FMT = new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" });
const WEEKDAY_FMT = new Intl.DateTimeFormat("en-IN", { weekday: "long", timeZone: "UTC" });
/** "26 January 2026" */
const FULL_FMT = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
const YEAR_FMT = new Intl.DateTimeFormat("en-IN", { year: "numeric", timeZone: "UTC" });

/** A calendar date has no clock; noon UTC keeps every formatter on the same day. */
const at = (ymd: string): Date => new Date(`${ymd}T12:00:00Z`);

/**
 * Upcoming holidays, from the organisation's own holiday list.
 *
 * One white surface; entries are separated by light rules rather than boxed.
 * A native <details> rather than client state: collapsing works without
 * hydration and the card costs no JavaScript. Open by default.
 */
export function UpcomingHolidays({
  holidays,
  today,
  error,
}: {
  holidays: HolidayRow[];
  today: string;
  error?: boolean;
}) {
  return (
    <details open className="group rounded-xl" style={CARD}>
      <summary className="flex items-center justify-between gap-3 cursor-pointer list-none p-6 max-md:p-4 rounded-xl transition-colors duration-150 hover:bg-[#F8FAFC] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D9488] motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-3 min-w-0">
          <CalendarHeart size={20} strokeWidth={2} aria-hidden style={{ color: ACCENT }} className="shrink-0" />
          <span className="min-w-0">
            <h2 className="text-[18px] font-bold tracking-[-0.01em] leading-tight" style={{ color: NAVY }}>
              Upcoming Holidays
            </h2>
            <span className="block text-[13px] mt-0.5" style={{ color: SLATE }}>
              {error
                ? "Unavailable right now"
                : holidays.length === 0
                  ? "Nothing scheduled"
                  : `${holidays.length} coming up`}
            </span>
          </span>
        </span>
        <ChevronDown
          size={18}
          strokeWidth={2.2}
          aria-hidden
          className="shrink-0 transition-transform duration-200 group-open:rotate-180 motion-reduce:transition-none"
          style={{ color: SLATE }}
        />
      </summary>

      <div className="att-fade px-6 pb-4 max-md:px-4 max-md:pb-3">
        {error ? (
          <p className="text-[15px] pb-2" style={{ color: SLATE }}>
            Couldn&apos;t load holidays right now.
          </p>
        ) : holidays.length === 0 ? (
          <p className="text-[15px] pb-2" style={{ color: SLATE }}>
            No upcoming holidays scheduled.
          </p>
        ) : (
          <ul style={{ borderTop: `1px solid ${BORDER_SOFT}` }}>
            {holidays.map((h) => {
              const soon = timeUntil(h.holidayDate, today);
              const imminent = soon === "Today" || soon === "Tomorrow";
              return (
                <li
                  key={h.id}
                  className="flex items-center gap-4 py-3 last:border-b-0"
                  style={{ borderBottom: `1px solid ${BORDER_SOFT}` }}
                >
                  <div className="shrink-0 w-11 text-center leading-none" title={YEAR_FMT.format(at(h.holidayDate))}>
                    <div className="text-[19px] font-bold tabular-nums" style={{ color: NAVY }}>
                      {Number(h.holidayDate.slice(8))}
                    </div>
                    <div
                      className="mt-1 text-[10.5px] font-semibold uppercase tracking-[0.1em]"
                      style={{ color: ACCENT_TEXT }}
                    >
                      {MONTH_FMT.format(at(h.holidayDate))}
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[14.5px] font-semibold truncate" style={{ color: NAVY }}>
                        {h.label}
                      </span>
                      {h.isOptional && (
                        <span
                          className="shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold"
                          style={{ background: TONE.amber.bg, color: TONE.amber.fg }}
                          title="Optional holiday — take any one optional holiday or a comp-off"
                        >
                          Optional
                        </span>
                      )}
                    </div>
                    <div className="text-[12.5px] mt-0.5" style={{ color: SLATE }}>
                      {WEEKDAY_FMT.format(at(h.holidayDate))}
                      <span aria-hidden> · </span>
                      {FULL_FMT.format(at(h.holidayDate))}
                    </div>
                  </div>
                  <span
                    className="shrink-0 text-[12.5px] font-semibold tabular-nums"
                    style={{ color: imminent ? ACCENT_TEXT : SLATE }}
                  >
                    {soon}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        {!error && holidays.some((h) => h.isOptional) && (
          // The list's own rule for its starred days, kept with the list.
          <p className="mt-3 flex items-start gap-2 text-[12.5px] leading-snug" style={{ color: SLATE }}>
            <Info size={14} strokeWidth={2.2} aria-hidden className="mt-px shrink-0" style={{ color: ACCENT }} />
            <span>
              Optional holidays: take any <strong>one</strong> optional holiday or a comp-off, and work
              a full day on the others. Tell management your choice and record it on your Leave Card.
            </span>
          </p>
        )}
      </div>
    </details>
  );
}
