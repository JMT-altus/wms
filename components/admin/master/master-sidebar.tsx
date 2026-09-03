"use client";

import type { CSSProperties } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import {
  Boxes,
  Contact,
  Library,
  KeyRound,
  DatabaseZap,
  LayoutGrid,
  ShieldCheck,
  ArrowLeft,
  type LucideIcon,
} from "lucide-react";
import {
  RAIL_WIDTH,
  RAIL_WIDTH_COLLAPSED,
  useRailCollapsed,
} from "@/components/layout/rail-collapse";
import { RailToggle } from "@/components/layout/rail-toggle";

/**
 * Master Setup's own sidebar.
 *
 * Deliberately NOT the admin sidebar with extra rows: Admin Panel and Master
 * Setup are separate areas. Admin Panel is org administration (people,
 * departments, settings, activity); Master Setup is the reference data the
 * business runs on (catalogue, customers, libraries, ingestion). They are
 * reached separately from the Hub and each links across to the other.
 *
 * Amber accent so it is visually distinct from the Admin Panel's blue.
 */

interface NavItem {
  href: Route;
  label: string;
  hint: string;
  icon: LucideIcon;
  exact?: boolean;
}

const NAV: ReadonlyArray<NavItem> = [
  {
    href: "/master-setup" as Route,
    label: "Overview",
    hint: "What's set up so far",
    icon: LayoutGrid,
    exact: true,
  },
  {
    href: "/master-setup/products" as Route,
    label: "Product Masters",
    hint: "Category → Product → SKU",
    icon: Boxes,
  },
  {
    href: "/master-setup/customers" as Route,
    label: "Customer Masters",
    hint: "Profiles & classification",
    icon: Contact,
  },
  {
    href: "/master-setup/libraries" as Route,
    label: "System Libraries",
    hint: "Dropdowns & incentive slabs",
    icon: Library,
  },
  {
    href: "/master-setup/access-control" as Route,
    label: "Field Permissions",
    hint: "Quantities & average rates",
    icon: KeyRound,
  },
  {
    href: "/master-setup/data-import" as Route,
    label: "Data Ingestion",
    hint: "Sheets / Tally mapping",
    icon: DatabaseZap,
  },
];

const ACCENT = "linear-gradient(135deg, #f59e0b 0%, #f59e0b 42%, #b45309 100%)";

export function MasterSidebar({ adminName }: { adminName: string }) {
  // Shared across every rail so the choice follows you between modules.
  const collapsed = useRailCollapsed();
  const pathname = usePathname();

  function isActive(item: NavItem): boolean {
    if (item.exact) return pathname === item.href;
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }

  return (
    <aside
      className="module-rail header-dark rail-navy sticky top-0 self-start h-screen max-h-screen relative shrink-0 flex flex-col max-md:hidden transition-[width] duration-200"
      style={
        {
          width: collapsed ? RAIL_WIDTH_COLLAPSED : RAIL_WIDTH,
          "--module-accent-from": "#f59e0b",
          "--module-accent-to": "#b45309",
        } as CSSProperties
      }
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 0% 0%, rgba(245, 158, 11, 0.22), transparent 70%), radial-gradient(ellipse 70% 60% at 100% 100%, rgba(180, 83, 9, 0.18), transparent 70%)",
        }}
      />

      <div className="relative flex flex-col h-full overflow-hidden">
        <div className={`relative shrink-0 pb-3 ${collapsed ? "px-2.5 pt-3.5" : "px-3.5"}`}>
          <div
            className={`flex gap-2 ${collapsed ? "flex-col items-center" : "items-stretch"}`}
            // Expanded, the block is exactly the header's height, so the line
            // under the mark sits on the header's own bottom edge and the two
            // read as one line turning the corner.
            style={collapsed ? undefined : { height: "var(--app-header-h)" }}
          >
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
                Admin &amp; Master Setup
              </p>
              <p className="text-[11.5px] mt-1.5 text-white/50 leading-snug">Signed in as {adminName}</p>
            </>
          )}
        </div>

        <nav className="px-2.5 flex flex-col gap-0.5 flex-1 overflow-y-auto min-h-0">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = isActive(item);
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
                        background: ACCENT,
                        color: "#ffffff",
                        boxShadow:
                          "0 8px 22px -10px rgba(245,158,11,0.55), inset 0 1px 0 rgba(255,255,255,0.14)",
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

        <div className="px-3 pb-6 pt-3 shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.10)" }}>
          {/* Explicit crossing point — the two areas are siblings, not nested. */}
          <Link
            href={"/admin" as Route}
            title={collapsed ? "Admin Panel" : undefined}
            className={`group flex items-center gap-2.5 py-2 rounded-lg text-[13.5px] text-white/75 hover:text-white hover:bg-white/[0.06] transition-colors ${
              collapsed ? "px-0 justify-center" : "px-3"
            }`}
          >
            <ShieldCheck size={16} strokeWidth={2.2} className="shrink-0" />
            {!collapsed && "Admin Panel"}
          </Link>
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
