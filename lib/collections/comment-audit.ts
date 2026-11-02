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

import { fmtDate, fmtTime } from "@/lib/dates";

/** The application's business timezone (the same one every Collection screen uses). */
export const COMMENT_TIME_ZONE = "Asia/Kolkata";
export const HISTORICAL_AUTHOR = "Historical author unavailable";
export const UNAVAILABLE_USER_ID = "Unavailable";

/** "27/10/26" — the calendar day in IST, in the app's DD/MM/YY standard. */
export function commentDate(d: Date): string {
  return fmtDate(d, { tz: COMMENT_TIME_ZONE });
}

/** "01:35 PM IST" — the clock time in IST. */
export function commentTime(d: Date): string {
  return `${fmtTime(d, { tz: COMMENT_TIME_ZONE })} IST`;
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
