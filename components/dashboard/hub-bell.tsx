import Link from "next/link";
import type { Route } from "next";
import { Bell } from "lucide-react";
import { getCurrentEmployee } from "@/lib/auth/current";
import { canAccessModule } from "@/lib/auth/module-access";
import { getUnreadCount } from "@/lib/queries/notifications";

/**
 * Unread-notifications bell for the hub's top bar.
 *
 * On every other page the unread count is a 10px dot on the avatar, which is
 * easy to miss. The hub is where you'd actually triage, so it gets a real
 * count. `getUnreadCount` is memoised per request, so sharing this number with
 * the avatar menu costs nothing.
 *
 * Renders nothing without access to WMS — /inbox lives in that module, so the
 * layout guard would only bounce the user straight back here.
 */
export async function HubBell() {
  const me = await getCurrentEmployee();
  if (!me) return null;
  if (!(await canAccessModule("wms"))) return null;

  const unread = await getUnreadCount(me.id);
  const display = unread > 99 ? "99+" : String(unread);

  return (
    <Link
      href={"/inbox" as Route}
      aria-label={unread > 0 ? `Inbox — ${unread} unread` : "Inbox"}
      className="relative inline-flex items-center justify-center rounded-full transition-transform hover:-translate-y-0.5"
      style={{
        width: 40,
        height: 40,
        background: "rgba(255,255,255,0.72)",
        border: "1px solid rgba(10,108,255,0.16)",
        boxShadow:
          "0 10px 24px -12px rgba(10,108,255,0.4), 0 1px 2px rgba(15,23,42,0.05), inset 0 1px 0 rgba(255,255,255,0.9)",
        backdropFilter: "blur(8px)",
        WebkitBackdropFilter: "blur(8px)",
      }}
    >
      <Bell size={18} strokeWidth={2.2} style={{ color: "#334155" }} />
      {unread > 0 && (
        <span
          className="absolute -top-1 -right-1 inline-flex items-center justify-center rounded-full text-white tabular-nums"
          style={{
            minWidth: 19,
            height: 19,
            padding: "0 5px",
            fontSize: 11,
            fontWeight: 800,
            background: "var(--color-altus-red)",
            boxShadow: "0 2px 6px -1px rgba(220,38,38,0.55)",
            border: "1.5px solid rgba(255,255,255,0.95)",
          }}
        >
          {display}
        </span>
      )}
    </Link>
  );
}
