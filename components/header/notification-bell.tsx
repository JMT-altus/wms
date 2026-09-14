import Link from "next/link";
import type { Route } from "next";
import { Bell } from "lucide-react";
import { getCurrentEmployee } from "@/lib/auth/current";
import { canAccessModule } from "@/lib/auth/module-access";
import { getUnreadCount } from "@/lib/queries/notifications";

/**
 * Unread-notifications bell — a link to /inbox carrying the live count.
 *
 * Everywhere else the count is a 10px dot on the avatar, which is easy to
 * miss. `getUnreadCount` is memoised per request, so sharing this number with
 * the avatar menu costs nothing.
 *
 * Two skins, one implementation — the same reasoning as FullscreenToggle:
 *   "hub"    — 40px dark-glass circle for the hub's top bar.
 *   "header" — 30px circle for the navy app header, matching the fullscreen
 *              toggle it sits beside.
 *
 * Renders nothing without access to WMS — /inbox lives in that module, so the
 * layout guard would only bounce the user straight back where they came from.
 */
export async function NotificationBell({
  variant = "hub",
}: { variant?: "hub" | "header" } = {}) {
  const me = await getCurrentEmployee();
  if (!me) return null;
  if (!(await canAccessModule("wms"))) return null;

  const unread = await getUnreadCount(me.id);
  const display = unread > 99 ? "99+" : String(unread);
  const isHeader = variant === "header";

  const box = isHeader ? 30 : 40;
  const badge = isHeader ? 16 : 19;

  return (
    <Link
      href={"/inbox" as Route}
      aria-label={unread > 0 ? `Inbox — ${unread} unread` : "Inbox"}
      className={
        isHeader
          ? "relative shrink-0 inline-flex items-center justify-center"
          : "relative inline-flex items-center justify-center rounded-full transition-transform hover:-translate-y-0.5"
      }
      style={{
        width: box,
        height: box,
        borderRadius: 9999,
        ...(isHeader
          ? {
              // Matches the fullscreen toggle's header circle exactly, so the
              // header's icon-only controls stay one family.
              background: "rgba(255, 255, 255, 0.08)",
              border: "1.5px solid rgba(255, 255, 255, 0.16)",
              transition: "background-color 180ms ease, border-color 180ms ease",
            }
          : {
              // Dark glass, matching the hub's other top-bar pills — the canvas
              // is navy, so a white chip here read as a bright hole in it.
              background: "rgba(255,255,255,0.07)",
              border: "1px solid rgba(255,255,255,0.16)",
              boxShadow:
                "0 10px 24px -12px rgba(10,108,255,0.5), inset 0 1px 0 rgba(255,255,255,0.18)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
            }),
      }}
    >
      <Bell
        size={isHeader ? 15 : 18}
        strokeWidth={isHeader ? 2.4 : 2.2}
        style={{ color: "rgba(255,255,255,0.88)" }}
      />
      {unread > 0 && (
        <span
          className="absolute -top-1 -right-1 inline-flex items-center justify-center rounded-full text-white tabular-nums"
          style={{
            minWidth: badge,
            height: badge,
            padding: isHeader ? "0 4px" : "0 5px",
            fontSize: isHeader ? 10 : 11,
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
