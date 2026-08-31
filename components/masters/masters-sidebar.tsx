"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { Boxes, Contact, ArrowLeft, type LucideIcon } from "lucide-react";
import { MASTERS_GRADIENT } from "./theme";
import {
  RAIL_WIDTH,
  RAIL_WIDTH_COLLAPSED,
  useRailCollapsed,
} from "@/components/layout/rail-collapse";
import { RailToggle } from "@/components/layout/rail-toggle";

/**
 * The Masters module's left navigation.
 *
 * A sidebar rather than the top pill row every other module uses: the list of
 * masters is going to grow (grade, tolerance, condition, size, department…),
 * and a pill row stops being readable somewhere around six items. Adding the
 * seventh master here costs one line and nothing else moves.
 *
 * Navy panel with a blue→teal accent on the active row, matching the dashboard's
 * brand band — Masters is reference data for the same work, so it should not
 * introduce a new colour family.
 */

interface NavItem {
  href: Route;
  label: string;
  hint: string;
  icon: LucideIcon;
}

const NAV: ReadonlyArray<NavItem> = [
  {
    href: "/masters/products" as Route,
    label: "Product Master",
    hint: "Name, code & specification",
    icon: Boxes,
  },
  {
    href: "/masters/customers" as Route,
    label: "Customer Master",
    hint: "Classification & salesperson",
    icon: Contact,
  },
];

const ACCENT = MASTERS_GRADIENT;

export function MastersSidebar({ userName }: { userName: string }) {
  const pathname = usePathname();
  const collapsed = useRailCollapsed();

  return (
    <aside
      // Same `module-rail` hook the Forms rail carries — see globals.css.
      className="module-rail header-dark rail-navy sticky top-0 self-start h-screen max-h-screen relative shrink-0 flex flex-col max-md:hidden transition-[width] duration-200"
      style={{ width: collapsed ? RAIL_WIDTH_COLLAPSED : RAIL_WIDTH }}
    >

      <div className="relative flex flex-col h-full overflow-hidden">
        <div className={`shrink-0 pt-4 pb-4 ${collapsed ? "px-3" : "px-5"}`}>
          <div className={`flex items-start gap-2 ${collapsed ? "flex-col items-center" : ""}`}>
            <div
              className="inline-flex items-center gap-2.5 rounded-xl bg-white px-2.5 py-2 min-w-0"
              style={{ boxShadow: "0 4px 14px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.6)" }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo.png"
                alt="JMT Drive Solutions"
                style={{ height: collapsed ? 26 : 40, width: "auto", display: "block" }}
              />
              {!collapsed && (
                <span
                  className="inline-flex items-center text-[10px] font-bold uppercase text-white px-2 py-0.5 rounded-full"
                  style={{
                    background: ACCENT,
                    boxShadow: "0 2px 8px rgba(10, 108, 255, 0.35)",
                    letterSpacing: "0.08em",
                  }}
                >
                  Masters
                </span>
              )}
            </div>
            <RailToggle className={collapsed ? "mt-2" : "ml-auto"} />
          </div>
          {!collapsed && (
            <>
              <p className="text-[13px] mt-3 font-bold text-white/90">Masters</p>
              <p className="text-[12px] mt-0.5 text-white/50">Signed in as {userName}</p>
            </>
          )}
        </div>

        <nav className="px-3 flex flex-col gap-1 flex-1 overflow-y-auto min-h-0">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
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
                        background: ACCENT,
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
                  size={18}
                  strokeWidth={2.2}
                  className={`relative shrink-0 ${collapsed ? "" : "mt-0.5"}`}
                  style={{ color: active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.65)" }}
                />
                {!collapsed && (
                <span className="relative min-w-0">
                  <span className="block text-[13.5px] font-medium">{item.label}</span>
                  <span
                    className="block text-[11.5px] mt-0.5"
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

/** The same two links as a scrollable strip, for phones where the rail hides. */
export function MastersMobileNav() {
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
                ? { background: ACCENT, color: "#fff" }
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
