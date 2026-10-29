import { getNavCounts } from "@/lib/queries/nav-counts";
import { getCurrentEmployee } from "@/lib/auth/current";
import { getHeldCapabilities } from "@/lib/auth/capability";
import { NAV_REQUIRED_CAPABILITIES } from "@/lib/nav-modules";
import { AppSidebar } from "./app-sidebar";
import { UserMenuServer } from "@/components/header/user-menu-server";

/**
 * Feeds the left rail. Same two reads the pill row used — the task total comes
 * from a shared cache, so this is a cache hit rather than a second query.
 */
export async function AppSidebarServer() {
  const me = await getCurrentEmployee();
  const { activeTasks, archivedTasks } = await getNavCounts(
    me ? { userId: me.id, isAdmin: me.isAdmin, inboxSince: me.lastInboxVisitAt } : undefined,
  );
  const capabilities = me ? await getHeldCapabilities(NAV_REQUIRED_CAPABILITIES) : [];
  return (
    <AppSidebar
      activeTasks={activeTasks}
      archivedTasks={archivedTasks}
      isAdmin={Boolean(me?.isAdmin)}
      capabilities={capabilities}
      userMenu={<UserMenuServer variant="rail" />}
    />
  );
}
