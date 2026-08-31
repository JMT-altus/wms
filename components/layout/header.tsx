import { headers } from "next/headers";
import { LiveIndicator } from "./live-indicator";
import { NavHistoryButtons } from "./nav-history-buttons";
import { FullscreenToggle } from "@/components/masters/fullscreen-toggle";
import { MobileMenuServer } from "./mobile-menu-server";
import { UserMenuServer } from "@/components/header/user-menu-server";
import { NewTaskTrigger } from "@/components/header/new-task-trigger";
import { AdminPill } from "@/components/header/admin-pill";
import { GlobalSearch } from "@/components/header/global-search";
import { getCurrentEmployee } from "@/lib/auth/current";
import { moduleIdForPath } from "@/lib/nav-modules";

/**
 * Deep-navy glassy application header — single row, `--app-header-h` tall
 * (see globals.css; sticky filter bars and loading skeletons key off it).
 *
 * JMT logo mark on the left, primary nav centered with airy spacing, right
 * cluster carries live indicator + actions + avatar. Frosted navy surface
 * (drawn from the jmtdrives.com brand navy) with a blue→teal hairline accent
 * along the bottom edge. Nav-pills read as white chips; the active pill is a
 * blue gradient. The `.header-navy` scope styles the chrome for a dark bar.
 *
 * `generatedAt` is accepted to keep the prop contract stable for callers
 * but no longer rendered.
 */
export async function DashboardHeader({
  generatedAt: _generatedAt,
}: { generatedAt: Date }) {
  const me = await getCurrentEmployee();
  const isAdmin = me?.isAdmin ?? false;

  // "New Task" belongs to WMS. Employees, Incentive Tracker and Training have
  // nothing to do with tasks, so the button (and the `N` hotkey, which lives
  // inside the dialog it mounts) is scoped to that module.
  //
  // Not rendering it also skips the five roster queries NewTaskTrigger fires —
  // employees, clients, subjects, project nodes, departments — on every page of
  // the other three modules.
  //
  // Fails OPEN: `x-pathname` is stamped by middleware, but if it is ever
  // missing we cannot tell which module we're in, and a stray button is a far
  // smaller problem than losing task creation on the dashboard.
  const pathname = (await headers()).get("x-pathname");
  const moduleId = pathname ? moduleIdForPath(pathname) : null;
  // Admin Panel and Master Setup belong to no module, so moduleIdForPath
  // returns null for them and the fail-open below would light up New Task —
  // and fire its five roster queries — on every admin page. Excluded by path
  // rather than by widening moduleIdForPath, which the access guard also uses.
  const isAdminArea =
    pathname?.startsWith("/admin") === true ||
    pathname?.startsWith("/master-setup") === true;
  const showNewTask = !isAdminArea && (moduleId === null || moduleId === "wms");

  return (
    <header className="sticky top-0 z-50 header-navy">
      <div
        className="relative"
        style={{
          backgroundImage:
            "linear-gradient(100deg, #001b3d 0%, #012a58 48%, #013a6b 100%)",
          backdropFilter: "blur(20px) saturate(160%)",
          WebkitBackdropFilter: "blur(20px) saturate(160%)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        {/* Blue → teal accent hairline along the very bottom edge — draws the
            logo's teal into the navy bar so the palette reads as intentional. */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-[2px]"
          style={{
            background:
              "linear-gradient(90deg, transparent 0%, #0A6CFF 30%, #17B6A0 70%, transparent 100%)",
            opacity: 0.85,
          }}
        />
        <div className="relative w-full h-[var(--app-header-h)] px-6 max-md:px-4 flex items-center gap-4 2xl:gap-6 max-md:gap-3">
          {/* LEFT-MOST: Back / Forward history pills (md+ only).
              On mobile, replaced by the hamburger menu (same slot). */}
          <NavHistoryButtons />
          <MobileMenuServer isAdmin={isAdmin} />

          {/* CENTER: intentionally empty. The primary nav moved out of this bar
              and into the left rail (components/layout/app-sidebar.tsx), which
              is where the Masters module already kept its own. The spacer
              keeps search and the avatar hard right, where they have always
              been. The phone drawer (MobileMenuServer, above) still carries the
              same items below md, where the rail is hidden. */}
          <div className="flex-1 min-w-0" />

          {/* RIGHT: search + live indicator + actions + avatar. Every item is
              shrink-0; secondary chrome (Live / Admin pill) hides below 2xl and
              the search collapses to an icon there too, so the nav always has
              room and nothing ever overlaps. */}
          <div className="flex items-center gap-2.5 2xl:gap-3 shrink-0 max-xl:ml-auto max-md:gap-1.5">
            <GlobalSearch />
            <span className="max-2xl:hidden">
              <LiveIndicator />
            </span>
            {showNewTask && <NewTaskTrigger />}
            {isAdmin && (
              <span className="max-2xl:hidden">
                <AdminPill />
              </span>
            )}
            {/* Full screen — folds away the browser chrome AND the app's own
                left rail (globals.css keys off data-app-fullscreen). Hidden on
                phones, where the rail is already gone and the API is flaky. */}
            <FullscreenToggle variant="header" />
            <UserMenuServer />
          </div>
        </div>
      </div>
    </header>
  );
}
