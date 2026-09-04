import { getCurrentEmployee } from "@/lib/auth/current";
import { canAccessModule } from "@/lib/auth/module-access";
import { getNavCounts } from "@/lib/queries/nav-counts";
import { UserMenu } from "./user-menu";

export async function UserMenuServer({
  tone = "dark",
  showUnreadDot = true,
  variant = "avatar",
}: {
  /** "light" on the hub, whose header sits on a pale gradient. */
  tone?: "dark" | "light";
  /** False on the hub, which shows a dedicated bell with the count. */
  showUnreadDot?: boolean;
  /** "rail" renders the named row at the foot of the left rail. */
  variant?: "avatar" | "rail";
} = {}) {
  const me = await getCurrentEmployee();
  if (!me) return null;
  // Inbox + Archived now live inside this menu, so it carries their counts —
  // the unread badge that used to sit on the nav pill moves here (plus a dot
  // on the avatar). Task totals are a shared cache hit; only the per-user
  // unread count actually queries.
  const [counts, canAccessWms] = await Promise.all([
    getNavCounts({
      userId: me.id,
      isAdmin: me.isAdmin,
      inboxSince: me.lastInboxVisitAt,
    }),
    canAccessModule("wms"),
  ]);
  return (
    <UserMenu
      name={me.name}
      email={me.email}
      isAdmin={me.isAdmin}
      avatarUrl={me.avatarUrl}
      inboxUnread={counts.inboxUnread}
      archivedTasks={counts.archivedTasks}
      canAccessWms={canAccessWms}
      tone={tone}
      showUnreadDot={showUnreadDot}
      variant={variant}
    />
  );
}
