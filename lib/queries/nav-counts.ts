import { and, count, eq, inArray, type SQL } from "drizzle-orm";
import { unstable_cache } from "next/cache";
import { db, tasks } from "@/lib/db";
import { PENDING_STATUSES } from "@/db/enums";
import { getUnreadCount } from "@/lib/queries/notifications";
import { getViewer, visibleTaskCondition } from "@/lib/auth/task-visibility";
import { CACHE_TAGS } from "@/lib/cache-tags";

/**
 * Nav-badge task counters.
 *
 * `activeTasks` is the count of OPEN work — unarchived tasks still in a
 * pending status (Not Read, Not Started, Initiated, Follow-ups, Need
 * Help/Info). Terminal states (done / approved / not_approved / cancelled /
 * transferred) are deliberately excluded so the badge reflects "work to do"
 * and drops as tasks are completed, rather than ballooning with every
 * approved-but-never-archived row. `archivedTasks` is the soft-deleted total.
 *
 * Both invalidate via `revalidateTag(CACHE_TAGS.tasks)` — fired by every
 * create / status-change / archive / restore path — so the badge stays live;
 * the 60s `revalidate` is just a safety net.
 */
function fetchTaskTotals(viewerKey: string, visible: SQL | undefined) {
  return unstable_cache(
    async (): Promise<{ activeTasks: number; archivedTasks: number }> => {
      const [openRows, archivedRows] = await Promise.all([
        db
          .select({ n: count() })
          .from(tasks)
          .where(
            and(
              eq(tasks.archived, false),
              inArray(tasks.status, [...PENDING_STATUSES]),
              visible,
            ),
          ),
        db
          .select({ n: count() })
          .from(tasks)
          .where(and(eq(tasks.archived, true), visible)),
      ]);
      return {
        activeTasks: Number(openRows[0]?.n ?? 0),
        archivedTasks: Number(archivedRows[0]?.n ?? 0),
      };
    },
    // The viewer is part of the key. These badges were a SHARED cache entry,
    // which since row-level visibility landed would have shown everyone a
    // count that includes tasks they can't open — a number that never
    // reconciles with the list it links to. Super-admins collapse to one entry.
    ["nav-task-totals:v2", viewerKey],
    { tags: [CACHE_TAGS.tasks], revalidate: 60 },
  )();
}

export async function getNavCounts(args?: {
  userId?: string;
  isAdmin?: boolean;
  inboxSince?: Date | undefined;
}): Promise<{
  activeTasks: number;
  archivedTasks: number;
  inboxUnread: number;
}> {
  // Unread count is per-user — kept out of the shared cache. The task totals
  // are cached per viewer-visibility-key, so they still hit Postgres at most
  // once a minute per distinct audience rather than once per request.
  const viewer = await getViewer();
  const viewerKey = !viewer
    ? "anon"
    : viewer.isSuperAdmin
      ? "super"
      : `${viewer.id}:${viewer.isManagement ? "m" : "-"}:${[...viewer.departmentIds].sort().join("+")}`;

  const [totals, inboxUnread] = await Promise.all([
    fetchTaskTotals(viewerKey, await visibleTaskCondition(viewer)),
    args?.userId ? getUnreadCount(args.userId) : Promise.resolve(0),
  ]);
  return { ...totals, inboxUnread };
}
