"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import {
  ArrowLeft,
  CalendarDays,
  CalendarRange,
  ClipboardCheck,
  LayoutDashboard,
  Target,
  Trophy,
  type LucideIcon,
} from "lucide-react";
import {
  RAIL_WIDTH,
  RAIL_WIDTH_COLLAPSED,
  useRailCollapsed,
} from "@/components/layout/rail-collapse";
import { RailToggle } from "@/components/layout/rail-toggle";
import { TARGETS_GRADIENT } from "./theme";

/**
 * Targets & Forecasts navigation.
 *
 * A left rail rather than the top pill row: six entries is already past where
 * pills stay readable, and the four period levels want to read as a ladder
 * (year → quarter → month → week) which a vertical list shows and a horizontal
 * strip does not.
 */

interface NavItem {
  href: Route;
  label: string;
  hint: string;
  icon: LucideIcon;
}

const NAV: ReadonlyArray<NavItem> = [
  { href: "/targets/annual" as Route, label: "Annual", hint: "Set & allocate the year", icon: Trophy },
  { href: "/targets/quarterly" as Route, label: "Quarterly", hint: "Four buckets", icon: Target },
  { href: "/targets/monthly" as Route, label: "Monthly", hint: "Updated on the 27th", icon: CalendarRange },
  { href: "/targets/weekly" as Route, label: "Weekly", hint: "Updated every Friday", icon: CalendarDays },
  { href: "/targets/dashboard" as Route, label: "Dashboard", hint: "Forecast vs actual", icon: LayoutDashboard },
  { href: "/targets/hygiene" as Route, label: "Hygiene", hint: "Estimates without notes", icon: ClipboardCheck },
];

export function TargetsSidebar({ userName }: { userName: string }) {
  const pathname = usePathname();
  // Shared with every other rail, so collapsing here stays collapsed when you
  // move to Masters, Forms or the workspace.
  const collapsed = useRailCollapsed();

  return (
    <aside
      className="module-rail header-dark rail-navy sticky top-0 self-start h-screen max-h-screen relative shrink-0 flex flex-col max-md:hidden transition-[width] duration-200"
      style={{ width: collapsed ? RAIL_WIDTH_COLLAPSED : RAIL_WIDTH }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 0% 0%, rgba(124, 58, 237, 0.26), transparent 70%), radial-gradient(ellipse 70% 60% at 100% 100%, rgba(79, 70, 229, 0.20), transparent 70%)",
        }}
      />

      <div className="relative flex flex-col h-full overflow-hidden">
        <div className={`shrink-0 pt-3.5 pb-3 ${collapsed ? "px-2.5" : "px-3.5"}`}>
          <div className={`flex items-start gap-2 ${collapsed ? "flex-col items-center" : ""}`}>
            <div
              className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 min-w-0 flex-1"
              style={{ boxShadow: "0 4px 14px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.6)" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.png"
                alt="JMT Drive Solutions"
                className="shrink-0"
                style={{ height: collapsed ? 22 : 30, width: "auto", display: "block" }}
              />
              {!collapsed && (
                <span
                  className="inline-block min-w-0 break-words text-center text-[10px] font-bold uppercase leading-[1.25] text-white px-2 py-0.5 rounded-lg"
                  style={{
                    background: TARGETS_GRADIENT,
                    boxShadow: "0 2px 8px rgba(124, 58, 237, 0.35)",
                    letterSpacing: "0.08em",
                  }}
                >
                  Targets
                </span>
              )}
            </div>
            <RailToggle className={collapsed ? "mt-2" : "ml-auto shrink-0"} />
          </div>
          {!collapsed && (
            <>
              <p className="text-[12.5px] mt-2.5 font-bold text-white/90">Targets &amp; Forecasts</p>
              <p className="text-[11.5px] mt-0.5 text-white/50 leading-snug">Signed in as {userName}</p>
            </>
          )}
        </div>

        <nav className="px-2.5 flex flex-col gap-0.5 flex-1 overflow-y-auto min-h-0">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                title={collapsed ? item.label : undefined}
                className={`group relative flex gap-3 py-2 rounded-lg transition-all ${
                  collapsed ? "items-center justify-center px-0" : "items-start px-2.5"
                }`}
                style={
                  active
                    ? {
                        background: TARGETS_GRADIENT,
                        color: "#ffffff",
                        boxShadow:
                          "0 8px 22px -10px rgba(124,58,237,0.6), inset 0 1px 0 rgba(255,255,255,0.14)",
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
                  size={17}
                  strokeWidth={2.2}
                  className={`relative shrink-0 ${collapsed ? "" : "mt-0.5"}`}
                  style={{ color: active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.65)" }}
                />
                {!collapsed && (
                  <span className="relative min-w-0">
                    <span className="block text-[13.5px] font-medium">{item.label}</span>
                    <span
                      className="block text-[11px] mt-0.5"
                      style={{ color: active ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.45)" }}
                    >
                      {item.hint}
                    </span>
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="px-3 pb-6 pt-3 shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.10)" }}>
          <Link
            href={"/hub" as Route}
            title={collapsed ? "Back to Hub" : undefined}
            className={`group flex items-center gap-2.5 py-2 rounded-lg text-[13.5px] text-white/75 hover:text-white hover:bg-white/[0.06] transition-colors ${
              collapsed ? "px-0 justify-center" : "px-3"
            }`}
          >
            <ArrowLeft size={16} strokeWidth={2.2} className="shrink-0 transition-transform group-hover:-translate-x-0.5" />
            {!collapsed && "Back to Hub"}
          </Link>
        </div>
      </div>
    </aside>
  );
}

/** The same entries as a scrollable strip, for phones where the rail hides. */
export function TargetsMobileNav() {
  const pathname = usePathname();
  return (
    <div
      className="rail-navy-top md:hidden sticky top-0 z-30 flex items-center gap-2 px-4 py-2.5 overflow-x-auto"
    >
      <Link
        href={"/hub" as Route}
        aria-label="Back to Hub"
        className="shrink-0 inline-flex items-center justify-center rounded-pill size-9 text-white/80"
        style={{ border: "1px solid rgba(255,255,255,0.16)" }}
      >
        <ArrowLeft size={16} strokeWidth={2.4} />
      </Link>
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className="shrink-0 rounded-pill px-3.5 h-9 inline-flex items-center text-[13.5px] font-semibold"
            style={
              active
                ? { background: TARGETS_GRADIENT, color: "#fff" }
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
