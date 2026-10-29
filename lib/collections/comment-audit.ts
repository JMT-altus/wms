/**
 * How a Collection comment (a Tracker follow-up's note) shows who wrote it and
 * when. Pure — safe to import from client components.
 *
 * Every value shown here was recorded by the server, never by the browser: the
 * author is the signed-in employee resolved from the session when the
 * follow-up was saved (`created_by_id`), the name comes from that employee's
 * record, and the time is the database's own clock (`created_at`). When the
 * author is not on record — for example the employee record was later removed,
 * which clears `created_by_id` — the comment says so honestly; it is never
 * attributed to whoever is looking at it.
 */

/** The application's business timezone (the same one every Collection screen uses). */
export const COMMENT_TIME_ZONE = "Asia/Kolkata";
export const HISTORICAL_AUTHOR = "Historical author unavailable";
export const UNAVAILABLE_USER_ID = "Unavailable";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

const partsFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: COMMENT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function istParts(d: Date): { year: string; month: number; day: string; hour: number; minute: string } {
  const get = (type: Intl.DateTimeFormatPartTypes) => partsFmt.formatToParts(d).find((p) => p.type === type)?.value ?? "";
  return { year: get("year"), month: Number(get("month")), day: get("day"), hour: Number(get("hour")), minute: get("minute") };
}

/** "27-Oct-2026" — the calendar day in IST. Month names are fixed so they never vary with the runtime's locale data. */
export function commentDate(d: Date): string {
  const p = istParts(d);
  return `${p.day}-${MONTHS[p.month - 1]}-${p.year}`;
}

/** "01:35 PM IST" — the clock time in IST. */
export function commentTime(d: Date): string {
  const p = istParts(d);
  const h12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${String(h12).padStart(2, "0")}:${p.minute} ${p.hour < 12 ? "AM" : "PM"} IST`;
}

export interface CommentAuthorSource {
  createdById: string | null;
  createdByName: string | null;
}

/**
 * The author as shown. `known` is false when either part is missing; the missing
 * part is shown as unavailable — never filled in from anything else.
 */
export function commentAuthor(e: CommentAuthorSource): { name: string; userId: string; known: boolean } {
  const name = e.createdById && e.createdByName ? e.createdByName : HISTORICAL_AUTHOR;
  const userId = e.createdById ?? UNAVAILABLE_USER_ID;
  return { name, userId, known: !!e.createdById && !!e.createdByName };
}
