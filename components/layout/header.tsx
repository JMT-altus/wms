import { headers } from "next/headers";
import { LiveIndicator } from "./live-indicator";
import { FullscreenToggle } from "@/components/masters/fullscreen-toggle";
import { MobileMenuServer } from "./mobile-menu-server";
import { UserMenuServer } from "@/components/header/user-menu-server";
import { NewTaskTrigger } from "@/components/header/new-task-trigger";
import { GlobalSearch } from "@/components/header/global-search";
import { MODULES, moduleIdForPath } from "@/lib/nav-modules";

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

  // The hairline under the bar carries the ACTIVE MODULE's accent, so the
  // header, the rail's right edge and the module chip in the rail all read as
  // one colour: violet on Targets, teal on Employees, blue on WMS. Routes
  // that belong to no module (the hub, admin, master setup) keep the original
  // blue → teal, which is the app's own accent rather than any module's.
  //
  // Two areas own a rail accent without owning a module: Forms (rose, from
  // its hub tile) sits inside WMS's routes, and Master Setup (amber) sits
  // outside every module. Both render this header directly under their rail,
  // so without the override the corner where the two lines meet would change
  // colour mid-turn.
  const mod = moduleId ? (MODULES.find((m) => m.id === moduleId) ?? null) : null;
  const areaAccent =
    pathname?.startsWith("/forms") === true ? { from: "#FB7185", to: "#BE123C" }
    : pathname?.startsWith("/master-setup") === true ? { from: "#F59E0B", to: "#B45309" }
    : null;
  const lineFrom = areaAccent?.from ?? mod?.accent.from ?? "#0A6CFF";
  const lineTo = areaAccent?.to ?? mod?.accent.to ?? "#17B6A0";

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
        {/* Accent hairline along the very bottom edge, in the current
            module's colours — see `lineFrom` / `lineTo` above. The glint
            travelling along it comes from .header-shine-line (globals.css),
            in step with the line under the rail's mark. */}
        <div
          aria-hidden
          className="header-shine-line pointer-events-none absolute inset-x-0 bottom-0 h-[2px]"
          style={{
            background: `linear-gradient(90deg, transparent 0%, ${lineFrom} 30%, ${lineTo} 70%, transparent 100%)`,
            opacity: 0.85,
          }}
        />
        <div className="relative w-full h-[var(--app-header-h)] px-6 max-md:px-4 flex items-center gap-4 2xl:gap-6 max-md:gap-3">
          {/* LEFT: the phone hamburger, then the global search field. Search
              reads as the header's primary job now that nav lives in the rail,
              so it sits where the eye starts rather than tucked against the
              avatar on the right. */}
          <MobileMenuServer />
          <GlobalSearch />

          {/* CENTER: intentionally empty. The primary nav moved out of this bar
              and into the left rail (components/layout/app-sidebar.tsx), which
              is where the Masters module already kept its own. The spacer
              keeps search and the avatar hard right, where they have always
              been. The phone drawer (MobileMenuServer, above) still carries the
              same items below md, where the rail is hidden. */}
          <div className="flex-1 min-w-0" />

          {/* RIGHT: live indicator + actions + avatar. Every item is shrink-0;
              secondary chrome (Live) hides below 2xl and the search collapses
              to an icon there too, so the nav always has room and nothing ever
              overlaps. The admin shortcut lives in the avatar menu — a standing
              ADMIN badge restated a fact the user already knows about
              themselves on every screen. */}
          <div className="flex items-center gap-2.5 2xl:gap-3 shrink-0 max-xl:ml-auto max-md:gap-1.5">
            <span className="max-2xl:hidden">
              <LiveIndicator />
            </span>
            {showNewTask && <NewTaskTrigger />}
            {/* Full screen — folds away the browser chrome AND the app's own
                left rail (globals.css keys off data-app-fullscreen). Hidden on
                phones, where the rail is already gone and the API is flaky. */}
            <FullscreenToggle variant="header" />
          </div>
        </div>
      </div>
    </header>
  );
}
