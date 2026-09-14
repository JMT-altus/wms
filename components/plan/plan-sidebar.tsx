"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import {
  ArrowLeft,
  FolderKanban,
  Flag,
  ListChecks,
  ListTree,
  SquareKanban,
  Target,
  Waypoints,
  type LucideIcon,
} from "lucide-react";
import { PLAN_GRADIENT } from "./theme";
import {
  RAIL_WIDTH,
  RAIL_WIDTH_COLLAPSED,
  useRailCollapsed,
} from "@/components/layout/rail-collapse";
import { RailToggle } from "@/components/layout/rail-toggle";

/**
 * The Project Plan module's left navigation.
 *
 * A rail rather than the top pill row: seven entries is already past the point
 * where pills stop being readable, and the tree grows a level more easily than
 * the pill row grows a slot.
 */

interface NavItem {
  href: Route;
  label: string;
  hint: string;
  icon: LucideIcon;
  /**
   * Light only on an exact match. Projects sits at the module root, so without
   * this every child route would light it up too.
   */
  exact?: boolean;
}

const NAV: ReadonlyArray<NavItem> = [
  // First, because it is the only item that answers "what is in this plan?"
  // without a click.
  {
    href: "/project-plan/views" as Route,
    label: "Project Views",
    hint: "The whole plan as one tree",
    icon: ListTree,
  },
  {
    href: "/project-plan" as Route,
    label: "Projects",
    hint: "Every project on one line",
    icon: FolderKanban,
    exact: true,
  },
  {
    href: "/project-plan/milestones" as Route,
    label: "Milestones",
    hint: "What each project delivers",
    icon: Flag,
  },
  {
    href: "/project-plan/results" as Route,
    label: "Results",
    hint: "What each milestone produces",
    icon: Target,
  },
  {
    href: "/project-plan/actions" as Route,
    label: "Actions",
    hint: "The work itself, as tasks",
    icon: ListChecks,
  },
  {
    href: "/project-plan/sub-actions" as Route,
    label: "Sub-Actions",
    hint: "An action broken down",
    icon: Waypoints,
  },
  {
    href: "/project-plan/kanban" as Route,
    label: "Kanban",
    hint: "The same rows as cards",
    icon: SquareKanban,
  },
];

function isActive(pathname: string, item: NavItem): boolean {
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function PlanSidebar({ userName }: { userName: string }) {
  const pathname = usePathname();
  const collapsed = useRailCollapsed();

  return (
    <aside
      // The same `module-rail` hook the Masters and Forms rails carry.
      className="module-rail header-dark rail-navy sticky top-0 self-start h-screen max-h-screen relative shrink-0 flex flex-col max-md:hidden transition-[width] duration-200"
      style={{ width: collapsed ? RAIL_WIDTH_COLLAPSED : RAIL_WIDTH }}
    >
      <div className="relative flex flex-col h-full overflow-hidden">
        <div className={`relative shrink-0 pb-4 ${collapsed ? "px-3 pt-4" : "px-5"}`}>
          <div
            className={`flex gap-2 ${collapsed ? "flex-col items-center" : "items-stretch"}`}
            style={collapsed ? undefined : { height: "var(--app-header-h)" }}
          >
            {/* The mark is the way back to the hub — the same destination as
                the footer link, on the thing people reach for first. */}
            <Link
              href={"/hub" as Route}
              title="Back to Hub"
              className="flex items-center justify-center brand-plate rounded-xl px-2.5 py-2 min-w-0 flex-1"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo-mark.png"
                alt="JMT Drive Solutions"
                style={{ height: collapsed ? 26 : 40, width: "auto", display: "block" }}
              />
            </Link>
            <RailToggle
              className={collapsed ? "mt-2" : "rail-toggle-in-band absolute right-4 z-10"}
            />
          </div>
          {!collapsed && (
            <>
              <p
                className="text-[14px] mt-3 px-2.5 py-1.5 rounded-lg font-bold text-white leading-[1.25]"
                style={{ background: PLAN_GRADIENT }}
              >
                Project Plan
              </p>
              <p className="text-[13px] mt-1.5 text-white/50">Signed in as {userName}</p>
            </>
          )}
        </div>

        <nav
          aria-label="Project Plan"
          className="px-3 flex flex-col gap-1 flex-1 overflow-y-auto min-h-0"
        >
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(pathname, item);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                className={`group relative flex gap-2.5 py-2.5 rounded-lg transition-all ${
                  collapsed ? "items-center justify-center px-0" : "items-start px-3"
                }`}
                style={
                  active
                    ? {
                        background: PLAN_GRADIENT,
                        color: "#ffffff",
                        boxShadow:
                          "0 8px 22px -10px rgba(225,6,0,0.55), inset 0 1px 0 rgba(255,255,255,0.14)",
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
                  size={18}
                  strokeWidth={2.2}
                  className={`relative shrink-0 ${collapsed ? "" : "mt-0.5"}`}
                  style={{ color: active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.65)" }}
                />
                {!collapsed && (
                  <span className="relative min-w-0">
                    <span className="block text-[14.5px] font-medium">{item.label}</span>
                    <span
                      className="block text-[12.5px] mt-0.5"
                      style={{
                        color: active ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.45)",
                      }}
                    >
                      {item.hint}
                    </span>
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div
          className="px-3 pb-4 pt-2.5 shrink-0"
          style={{ borderTop: "1px solid rgba(255,255,255,0.10)" }}
        >
          <Link
            href={"/hub" as Route}
            title={collapsed ? "Back to Hub" : undefined}
            className={`group flex items-center gap-2.5 py-2.5 rounded-lg text-[15px] text-white/75 hover:text-white hover:bg-white/[0.06] transition-colors ${
              collapsed ? "px-0 justify-center" : "px-3.5"
            }`}
          >
            <ArrowLeft
              size={16}
              strokeWidth={2.2}
              className="transition-transform group-hover:-translate-x-0.5"
            />
            {!collapsed && "Back to Hub"}
          </Link>
        </div>
      </div>
    </aside>
  );
}

/** The same seven links as a scrollable strip, for phones where the rail hides. */
export function PlanMobileNav() {
  const pathname = usePathname();
  return (
    <div className="rail-navy-top md:hidden sticky top-0 z-30 flex items-center gap-2 px-4 py-2.5 overflow-x-auto">
      <Link
        href={"/hub" as Route}
        aria-label="Back to Hub"
        className="shrink-0 inline-flex items-center justify-center rounded-pill size-9 text-white/80"
        style={{ border: "1px solid rgba(255,255,255,0.16)" }}
      >
        <ArrowLeft size={16} strokeWidth={2.4} />
      </Link>
      {NAV.map((item) => {
        const active = isActive(pathname, item);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className="shrink-0 rounded-pill px-3.5 h-9 inline-flex items-center text-[14.5px] font-semibold"
            style={
              active
                ? { background: PLAN_GRADIENT, color: "#fff" }
                : { color: "rgba(255,255,255,0.78)", border: "1px solid rgba(255,255,255,0.16)" }
            }
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
