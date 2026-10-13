import Link from "next/link";
import type { Route } from "next";
import { CalendarRange, ChevronLeft, ChevronRight } from "lucide-react";
import {
  STATUS_GROUP_LABEL,
  buildCalendar,
  formatMinutes,
  type CalendarCell,
  type StatusGroup,
} from "@/lib/attendance/overview";
import type { DayRow } from "@/lib/queries/attendance-status";
import {
  ACCENT,
  ACCENT_SOFT,
  ACCENT_TEXT,
  BORDER,
  BORDER_SOFT,
  CARD,
  NAVY,
  SLATE,
  TONE,
  WEEKLY_OFF_BAND,
  type Tone,
} from "./theme";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const COLUMNS = "repeat(7, minmax(0, 1fr)) 60px";

/**
 * Weeks run Monday → Sunday (see `buildCalendar`), so Sunday is always the
 * seventh column — by construction, not by a date. The band is drawn once
 * behind the whole grid, header through last row, rather than tinting cells, so
 * it is one unbroken strip (no seams in the row gaps) and it also fills the
 * lead/trail days of the neighbouring months.
 */
const SUNDAY_COLUMN = 7;

/** One restrained colour per status group, from the page's own palette. */
const GROUP_TONE: Record<StatusGroup, Tone> = {
  present: "teal",
  half: "amber",
  absent: "coral",
  holiday: "blue",
  weekoff: "slate",
  offwork: "violet",
  leave: "orange",
  compoff: "rose",
  open: "amber",
};

/** Only the days that are an exception to "present" carry a background tint. */
const TINTED: ReadonlySet<StatusGroup> = new Set(["half", "absent", "leave", "open", "offwork", "compoff"]);

const MONTH_NAME = new Intl.DateTimeFormat("en-IN", {
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

const CODE_SHORT: Record<string, string> = {
  P: "P",
  "H/D": "½",
  A: "A",
  H: "H",
  "W/O": "WO",
  HP: "HP",
  "H-H/D": "H½",
  PL: "PL",
  LWP: "LWP",
  CO: "CO",
  incomplete: "…",
};

/**
 * The month as a Monday-first grid, with each week's hours in a column of its
 * own at the end of its row. Status and hours come straight from the graded
 * days; nothing is re-derived here. The lead and trail days of the neighbouring
 * months are drawn faded and carry no status, and a day that hasn't happened
 * shows none either unless it's already a known holiday, weekly off or
 * approved leave.
 *
 * Quiet on purpose: no box around any date. Whitespace separates the days, a
 * status is a small dot and a short code, and only the exceptions (absent, half
 * day, leave) get a pale tint — so the eye lands on what needs reading.
 */
export function MonthCalendar({
  days,
  year,
  month,
  today,
  prevHref,
  nextHref,
  todayHref,
  error,
}: {
  days: readonly DayRow[];
  year: number;
  month: number;
  today: string;
  /** null disables the arrow: there is no earlier / later month to show. */
  prevHref: string | null;
  nextHref: string | null;
  todayHref: string;
  error?: boolean;
}) {
  const weeks = error ? [] : buildCalendar(days, year, month, today);
  const title = MONTH_NAME.format(new Date(Date.UTC(year, month - 1, 1)));
  const navBtn =
    "grid place-items-center rounded-lg size-9 transition-colors duration-150 hover:bg-[#F3F6FA] hover:text-[#172B4D] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D9488] active:bg-[#E9EEF5] motion-reduce:transition-none";
  const navOff = "grid place-items-center rounded-lg size-9 opacity-35 cursor-not-allowed";

  return (
    <section
      className="rounded-xl p-6 max-md:p-4"
      style={CARD}
      aria-label="Monthly attendance calendar"
    >
      <div className="flex items-center justify-between gap-x-3 gap-y-3 flex-wrap mb-5">
        <div className="flex items-center gap-3 min-w-0">
          <CalendarRange size={20} strokeWidth={2} aria-hidden style={{ color: ACCENT }} className="shrink-0" />
          <div className="min-w-0">
            <h2 className="text-[18px] font-bold tracking-[-0.01em] leading-tight" style={{ color: NAVY }}>
              Monthly Attendance
            </h2>
            <p className="text-[13px] mt-0.5" style={{ color: SLATE }}>
              Your daily status and weekly hours
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1" style={{ color: SLATE }}>
          {prevHref ? (
            <Link href={prevHref as Route} scroll={false} aria-label="Previous month" className={navBtn}>
              <ChevronLeft size={16} strokeWidth={2.2} />
            </Link>
          ) : (
            <span aria-label="Previous month (no earlier attendance)" aria-disabled="true" className={navOff}>
              <ChevronLeft size={16} strokeWidth={2.2} />
            </span>
          )}
          <span
            className="px-2 min-w-[124px] text-center text-[14.5px] font-semibold tabular-nums"
            style={{ color: NAVY }}
            aria-live="polite"
          >
            {title}
          </span>
          {nextHref ? (
            <Link href={nextHref as Route} scroll={false} aria-label="Next month" className={navBtn}>
              <ChevronRight size={16} strokeWidth={2.2} />
            </Link>
          ) : (
            <span aria-label="Next month (not available)" aria-disabled="true" className={navOff}>
              <ChevronRight size={16} strokeWidth={2.2} />
            </span>
          )}
          <Link
            href={todayHref as Route}
            scroll={false}
            className="ml-1 rounded-lg px-3 h-9 inline-flex items-center text-[13px] font-semibold transition-colors duration-150 hover:bg-[#F3F6FA] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0D9488] active:bg-[#E9EEF5] motion-reduce:transition-none"
            style={{ color: ACCENT_TEXT, border: `1px solid ${BORDER}` }}
          >
            Today
          </Link>
        </div>
      </div>

      {error ? (
        <p className="text-[15px] py-8 text-center" style={{ color: SLATE }}>
          Couldn&apos;t load this month. Please refresh in a moment.
        </p>
      ) : (
        <div className="overflow-x-auto -mx-1 px-1 pb-1">
          <div className="relative min-w-[500px]">
            {/* The Sunday band. Same grid as the rows, so it lines up exactly;
                behind the content (z-0 under z-10) and out of the pointer's way. */}
            <div
              aria-hidden
              data-testid="sunday-band"
              className="pointer-events-none absolute inset-0 z-0 grid gap-1"
              style={{ gridTemplateColumns: COLUMNS }}
            >
              <div className="rounded-lg" style={{ gridColumn: SUNDAY_COLUMN, background: WEEKLY_OFF_BAND }} />
            </div>

            <div
              className="relative z-10 grid gap-1 pb-2 text-[12px] font-semibold uppercase tracking-[0.06em]"
              style={{ gridTemplateColumns: COLUMNS, color: SLATE, borderBottom: `1px solid ${BORDER_SOFT}` }}
            >
              {WEEKDAYS.map((d) => (
                <div key={d} className="text-center">
                  {d}
                </div>
              ))}
              <div className="text-center" style={{ color: ACCENT_TEXT }}>
                Hrs
              </div>
            </div>

            <div className="relative z-10 grid gap-y-0.5 pt-1.5">
              {weeks.map((w, i) => (
                <div key={i} className="grid gap-1 items-stretch" style={{ gridTemplateColumns: COLUMNS }}>
                  {w.cells.map((c) => (
                    <DayCell key={c.date} cell={c} />
                  ))}
                  {/* The weekly total, set off from its days by a single rule. */}
                  <div
                    className="grid place-items-center text-[13.5px] font-semibold tabular-nums"
                    style={{
                      color: w.workedMinutes > 0 ? NAVY : "#B3BDCB",
                      borderLeft: `1px solid ${BORDER_SOFT}`,
                    }}
                  >
                    {w.workedMinutes > 0 ? formatMinutes(w.workedMinutes) : "—"}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <Legend />
    </section>
  );
}

function DayCell({ cell }: { cell: CalendarCell }) {
  // A date from the neighbouring month: faded and flat, without a status.
  if (!cell.inMonth) {
    return (
      <div
        aria-hidden
        className="rounded-md px-2 py-1.5 min-h-[56px] max-md:min-h-[46px] text-[13px] tabular-nums"
        style={{ color: "#BAC4D1" }}
      >
        {cell.day}
      </div>
    );
  }

  const c = cell.group ? TONE[GROUP_TONE[cell.group]] : null;
  const label = cell.group ? STATUS_GROUP_LABEL[cell.group] : "No record";
  const worked = cell.workedMinutes > 0 ? ` · ${formatMinutes(cell.workedMinutes)} worked` : "";
  const tinted = cell.group != null && TINTED.has(cell.group);
  return (
    <div
      title={`${cell.date} · ${label}${worked}`}
      aria-current={cell.isToday ? "date" : undefined}
      className="rounded-md px-2 py-1.5 min-h-[56px] max-md:min-h-[46px] flex flex-col justify-between transition-colors duration-150 hover:bg-[#F1F5F9] motion-reduce:transition-none"
      style={{
        // A status tint wins; otherwise today alone gets a pale accent wash.
        background: tinted && c ? c.bg : cell.isToday ? ACCENT_SOFT : undefined,
        // Today: a hairline accent ring, not a thick border …
        boxShadow: cell.isToday ? `inset 0 0 0 1px ${ACCENT}` : undefined,
      }}
    >
      {/* … and its number sits in a small filled disc, so today reads at a
          glance without depending on the cell's colour. */}
      <span
        className="tabular-nums leading-none"
        style={
          cell.isToday
            ? {
                display: "grid",
                placeItems: "center",
                width: 22,
                height: 22,
                marginLeft: -4,
                marginTop: -3,
                borderRadius: 999,
                background: ACCENT_TEXT,
                color: "#FFFFFF",
                fontSize: 13,
                fontWeight: 700,
              }
            : { color: NAVY, fontSize: 14, fontWeight: 600 }
        }
      >
        {cell.day}
      </span>
      {cell.code && c && (
        <span className="flex items-center justify-end gap-1 leading-none">
          <span aria-hidden className="rounded-full" style={{ width: 7, height: 7, background: c.solid }} />
          <span className="text-[12px] font-bold" style={{ color: c.fg }}>
            {CODE_SHORT[cell.code] ?? cell.code}
          </span>
        </span>
      )}
    </div>
  );
}

function Legend() {
  return (
    <ul
      className="mt-5 pt-4 flex flex-wrap gap-x-5 gap-y-2"
      style={{ borderTop: `1px solid ${BORDER_SOFT}` }}
      aria-label="Legend"
    >
      {(Object.keys(STATUS_GROUP_LABEL) as StatusGroup[]).map((g) => {
        const c = TONE[GROUP_TONE[g]];
        return (
          <li key={g} className="inline-flex items-center gap-2 text-[13px]" style={{ color: SLATE }}>
            <span
              aria-hidden
              className="inline-block rounded-full"
              style={{
                width: 9,
                height: 9,
                background: g === "open" ? "transparent" : c.solid,
                border: g === "open" ? `1.5px dashed ${c.solid}` : "none",
              }}
            />
            {STATUS_GROUP_LABEL[g]}
          </li>
        );
      })}
    </ul>
  );
}
