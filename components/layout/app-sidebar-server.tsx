import { getNavCounts } from "@/lib/queries/nav-counts";
import { getCurrentEmployee } from "@/lib/auth/current";
import { AppSidebar } from "./app-sidebar";

/**
 * Feeds the left rail. Same two reads the pill row used — the task total comes
 * from a shared cache, so this is a cache hit rather than a second query.
 */
export async function AppSidebarServer() {
  const me = await getCurrentEmployee();
  const { activeTasks, archivedTasks } = await getNavCounts(
    me ? { userId: me.id, isAdmin: me.isAdmin, inboxSince: me.lastInboxVisitAt } : undefined,
  );
  return (
    <AppSidebar
      activeTasks={activeTasks}
      archivedTasks={archivedTasks}
      isAdmin={Boolean(me?.isAdmin)}
    />
  );
}
