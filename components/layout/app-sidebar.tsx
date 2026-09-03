"use client";

import type { CSSProperties } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import {
  LayoutDashboard, ListTodo, CalendarDays, FolderKanban, SquareKanban, Target,
  CalendarCheck, CalendarRange, Award, IndianRupee, Receipt, CalendarOff,
  Contact, Sparkles, GraduationCap, LayoutGrid, Users,
  BookOpen, Share2, Gauge, ListChecks, MessageSquare, Settings, ArrowLeft, Archive,
} from "lucide-react";
import { moduleForPath, type ModuleNavItem } from "@/lib/nav-modules";
import { RAIL_WIDTH, RAIL_WIDTH_COLLAPSED, useRailCollapsed } from "./rail-collapse";
import { RailToggle } from "./rail-toggle";

/**
 * The workspace's left rail — the module nav that used to be a pill row in the
 * header.
 *
 * Built to match components/masters/masters-sidebar.tsx: same navy panel, same
 * width, same active-row treatment, same "Back to Hub" footer. The difference
 * is that this one is module-aware — it renders whichever module the current
 * path belongs to, so the items change as you move between WMS, Employees,
 * Incentive Tracker and Training, exactly as the pill row did.
 *
 * The accent comes from each module's own `accent` in lib/nav-modules.ts, so
 * WMS stays blue, Employees teal, Incentive indigo and Training cyan — the same
 * colours their hub tiles already use.
 */

const ICONS: Record<string, typeof LayoutDashboard> = {
  LayoutDashboard, ListTodo, CalendarDays, FolderKanban, SquareKanban, Target,
  CalendarCheck, CalendarRange, Award, IndianRupee, Receipt, CalendarOff,
  Contact, Sparkles, GraduationCap, LayoutGrid, Users,
  BookOpen, Share2, Gauge, ListChecks, MessageSquare, Settings, Archive,
};

/** Hidden where the pill row was also absent — the hub has its own launcher. */
export function shouldHideRail(pathname: string): boolean {
  return pathname === "/hub" || pathname.includes("/focus");
}

export function AppSidebar({
  activeTasks,
  archivedTasks,
  isAdmin,
}: {
  activeTasks: number;
  archivedTasks: number;
  isAdmin: boolean;
}) {
  const pathname = usePathname();
  const collapsed = useRailCollapsed();
  if (shouldHideRail(pathname)) return null;

  const mod = moduleForPath(pathname);
  const accent = `linear-gradient(135deg, ${mod.accent.from} 0%, ${mod.accent.to} 100%)`;
  const items = mod.items.filter((i) => !i.adminOnly || isAdmin);

  function isActive(item: ModuleNavItem): boolean {
    if (item.href === "/") return pathname === "/";
    if (!pathname.startsWith(item.href)) return false;
    if (item.notMatch?.some((n) => pathname.startsWith(n))) return false;
    return true;
  }

  return (
    <aside
      // `rail-navy` is the shared navy surface (globals.css) — the same
      // gradient, blur and accent hairline the header uses, rotated to run
      // down the rail so the two read as one continuous plane.
      className="module-rail header-dark rail-navy fixed left-0 top-0 z-40 h-screen flex flex-col max-md:hidden transition-[width] duration-200"
      // The accent hairline down the rail's right edge and the module chip
      // below both read these, so the whole rail shifts colour with the
      // module rather than each piece re-deriving the gradient.
      style={
        {
          width: collapsed ? RAIL_WIDTH_COLLAPSED : RAIL_WIDTH,
          "--module-accent-from": mod.accent.from,
          "--module-accent-to": mod.accent.to,
        } as CSSProperties
      }
    >

      <div className="relative flex flex-col h-full overflow-hidden">
        <div className={`relative shrink-0 pb-3 ${collapsed ? "px-2.5 pt-3.5" : "px-3.5"}`}>
          <div
            className={`flex gap-2 ${collapsed ? "flex-col items-center" : "items-stretch"}`}
            // Expanded, the block is exactly the header's height, so the line
            // under the mark sits on the header's own bottom edge and the two
            // read as one line turning the corner.
            style={collapsed ? undefined : { height: "var(--app-header-h)" }}
          >
            {/* Logo only. The module name used to sit beside it as a small
                uppercase pill AND again as the line below — the same word
                twice, and the long names ("Targets & Forecasts") had to wrap
                inside the plate to fit. Now the plate carries the mark and
                the name gets its own accent block underneath. */}
            {/* The mark is the way back to the hub — the same destination as the
                "Back to Hub" footer, on the thing people reach for first. */}
            <Link
              href={"/hub" as Route}
              title="Back to Hub"
              className="flex items-center justify-center brand-plate rounded-lg px-2 py-1.5 min-w-0 flex-1"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo-mark.png"
                alt="JMT Drive Solutions"
                className="shrink-0"
                style={{ height: collapsed ? 22 : 30, width: "auto", display: "block" }}
              />
            </Link>
            <RailToggle className={collapsed ? "mt-2" : "rail-toggle-in-band absolute right-3.5 z-10"} />
          </div>
          {!collapsed && (
            <>
              <p className="module-chip text-[12.5px] mt-2.5 px-2.5 py-1.5 rounded-lg font-bold text-white leading-[1.25]">
                {mod.label}
              </p>
              <p className="text-[11.5px] mt-1.5 text-white/50 leading-snug">{mod.tagline}</p>
            </>
          )}
        </div>

        <nav aria-label="Primary" className="px-2.5 flex flex-col gap-0.5 flex-1 overflow-y-auto min-h-0">
          {items.map((item) => {
            const Icon = ICONS[item.icon] ?? LayoutDashboard;
            const active = isActive(item);
            const count = item.taskCount
              ? activeTasks
              : item.archivedCount
                ? archivedTasks
                : undefined;
            return (
              <Link
                key={item.href}
                href={item.href as Route}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                className={`group relative flex items-center gap-2.5 py-2 rounded-lg transition-all ${
                  collapsed ? "px-0 justify-center" : "px-2.5"
                }`}
                style={
                  active
                    ? {
                        background: accent,
                        color: "#ffffff",
                        boxShadow:
                          "0 8px 22px -10px rgba(14,165,183,0.55), inset 0 1px 0 rgba(255,255,255,0.14)",
                      }
                    : { color: "rgba(255,255,255,0.80)" }
                }
              >
                {!active && (
                  <span
                    aria-hidden
                    className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{ background: "rgba(255,255,255,0.06)" }}
                  />
                )}
                <Icon
                  size={16}
                  strokeWidth={2.2}
                  className="relative shrink-0"
                  style={{ color: active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.65)" }}
                />
                {!collapsed && (
                  <span className="relative flex-1 min-w-0 text-[13.5px] font-medium truncate">
                    {item.label}
                  </span>
                )}
                {count !== undefined && count > 0 && (
                  // Collapsed, the badge rides the icon's top-right corner —
                  // the count is the one thing on this row worth keeping when
                  // the label goes.
                  <span
                    className={`shrink-0 rounded-full text-[10px] font-bold tabular-nums ${
                      collapsed
                        ? "absolute top-1 right-1.5 px-1 leading-[14px]"
                        : "relative px-1.5 py-0.5 text-[11px]"
                    }`}
                    style={{
                      background: active ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.16)",
                      color: active ? "#fff" : "rgba(255,255,255,0.80)",
                    }}
                  >
                    {count}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 pb-4 pt-2.5 shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.10)" }}>
          <Link
            href={"/hub" as Route}
            title={collapsed ? "Back to Hub" : undefined}
            className={`group flex items-center gap-2.5 py-2.5 rounded-lg text-[14px] text-white/75 hover:text-white hover:bg-white/[0.06] transition-colors ${
              collapsed ? "px-0 justify-center" : "px-3.5"
            }`}
          >
            <ArrowLeft size={16} strokeWidth={2.2} className="transition-transform group-hover:-translate-x-0.5" />
            {!collapsed && "Back to Hub"}
          </Link>
        </div>
      </div>
    </aside>
  );
}

/**
 * Shifts the page over to clear the fixed rail. A client component because the
 * rail hides itself on /hub and focus mode, and the offset has to disappear
 * with it — the layout that renders this is a server component and can't read
 * the pathname.
 */
export function AppSidebarOffset({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const collapsed = useRailCollapsed();
  if (shouldHideRail(pathname)) return <>{children}</>;
  return (
    <div
      className="app-rail-offset transition-[padding] duration-200"
      style={
        {
          // Consumed by the md-and-up rule in globals.css — below md the rail
          // is hidden and the page must not be indented at all.
          "--app-rail-w": `${collapsed ? RAIL_WIDTH_COLLAPSED : RAIL_WIDTH}px`,
        } as CSSProperties
      }
    >
      {children}
    </div>
  );
}
