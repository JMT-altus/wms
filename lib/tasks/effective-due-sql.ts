import { sql } from "drizzle-orm";
import { tasks } from "@/db/schema";

/**
 * `COALESCE(tasks.revised_target_date, tasks.due_at)` as a Drizzle fragment —
 * the query-side half of lib/tasks/effective-due.ts.
 *
 * Use it for every WHERE, ORDER BY and derived column that involves a
 * deadline. Comparing against the raw `tasks.due_at` leaves a rescheduled task
 * permanently overdue in whatever screen forgot.
 *
 * Split from the pure module so client components can import
 * `pickEffectiveDue` without pulling db/schema into the browser bundle.
 */
export function effectiveDueAtSql() {
  return sql<Date>`COALESCE(${tasks.revisedTargetDate}, ${tasks.dueAt})`;
}
