"use client";

import type { CSSProperties } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import {
  FilePlus2,
  FileClock,
  FileText,
  BookUser,
  Contact,
  Landmark,
  SlidersHorizontal,
  Trash2,
  ArrowLeft,
  type LucideIcon,
} from "lucide-react";
// The same brand ramp the Masters rail uses. Imported rather than re-declared
// on purpose — a second hand-copied gradient string is exactly what drifts the
// moment one of the two gets tweaked.
import {
  RAIL_WIDTH,
  RAIL_WIDTH_COLLAPSED,
  useRailCollapsed,
} from "@/components/layout/rail-collapse";
import { RailToggle } from "@/components/layout/rail-toggle";

/**
 * The Forms module's left navigation.
 *
 * A deliberate mirror of components/masters/masters-sidebar.tsx — same navy
 * panel, same blue→teal accent on the active row, same logo plate and
 * "Back to Hub" footer. Client KYC moved out of Masters but kept its shape, so
 * the two modules should not look like they were built by different people.
 */

interface NavItem {
  href: Route;
  label: string;
  hint: string;
  icon: LucideIcon;
}

const BASE = "/forms/client-kyc";

const NAV: ReadonlyArray<NavItem> = [
  {
    href: `${BASE}/new` as Route,
    label: "Create New Client KYC",
    hint: "Onboard a client end to end",
    icon: FilePlus2,
  },
  {
    href: `${BASE}/drafts` as Route,
    label: "Draft",
    hint: "Unfinished KYC records",
    icon: FileClock,
  },
  {
    href: `${BASE}/clients` as Route,
    label: "Client Master",
    hint: "Every onboarded client",
    icon: FileText,
  },
  {
    href: `${BASE}/contacts` as Route,
    label: "Client Contact Master",
    hint: "Every contact person",
    icon: Contact,
  },
  {
    href: `${BASE}/address-book` as Route,
    label: "Client Address Book",
    hint: "Billing, delivery & mailing addresses",
    icon: BookUser,
  },
  {
    href: `${BASE}/banks` as Route,
    label: "Client Bank Master",
    hint: "Every bank account",
    icon: Landmark,
  },
  {
    href: `${BASE}/cust-dropdown` as Route,
    label: "Client Master DD",
    hint: "Options behind the KYC pickers",
    icon: SlidersHorizontal,
  },
  {
    href: `${BASE}/recycle-bin` as Route,
    label: "Recycle Bin",
    hint: "Deleted clients",
    icon: Trash2,
  },
];

/* The Forms accent, taken from the module's own hub tile (see STYLES.forms
   in app/(app)/hub/page.tsx) rather than borrowed from Masters — the tile is
   rose and the rail was blue, so the two read as different products. */
const ACCENT_FROM = "#FB7185";
const ACCENT_TO = "#BE123C";
const ACCENT = `linear-gradient(135deg, ${ACCENT_FROM} 0%, ${ACCENT_TO} 100%)`;

export function FormsSidebar({ userName }: { userName: string }) {
  const pathname = usePathname();
  const collapsed = useRailCollapsed();

  return (
    <aside
      // `module-rail` is the hook globals.css uses to fold this away in
      // full screen — see the [data-app-fullscreen] rule there.
      className="module-rail header-dark rail-navy sticky top-0 self-start h-screen max-h-screen relative shrink-0 flex flex-col max-md:hidden transition-[width] duration-200"
      style={
        {
          width: collapsed ? RAIL_WIDTH_COLLAPSED : RAIL_WIDTH,
          "--module-accent-from": ACCENT_FROM,
          "--module-accent-to": ACCENT_TO,
        } as CSSProperties
      }
    >

      <div className="relative flex flex-col h-full overflow-hidden">
        <div className={`relative shrink-0 pb-4 ${collapsed ? "px-3 pt-4" : "px-5"}`}>
          <div
            className={`flex gap-2 ${collapsed ? "flex-col items-center" : "items-stretch"}`}
            // Expanded, the block is exactly the header's height, so the line
            // under the mark sits on the header's own bottom edge and the two
            // read as one line turning the corner.
            style={collapsed ? undefined : { height: "var(--app-header-h)" }}
          >
            {/* Logo only — the module name now carries its own accent block
                below, the same treatment the WMS rail uses. */}
            {/* The mark is the way back to the hub — the same destination as the
                "Back to Hub" footer, on the thing people reach for first. */}
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
            <RailToggle className={collapsed ? "mt-2" : "rail-toggle-in-band absolute right-4 z-10"} />
          </div>
          {!collapsed && (
            <>
              <p className="module-chip text-[13px] mt-3 px-2.5 py-1.5 rounded-lg font-bold text-white leading-[1.25]">
                Client KYC
              </p>
              <p className="text-[12px] mt-1.5 text-white/50">Signed in as {userName}</p>
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
                title={collapsed ? item.label : item.hint}
                className={`group relative flex gap-2.5 py-2.5 rounded-lg transition-all ${
                  collapsed ? "items-center justify-center px-0" : "items-center px-3"
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
                  className="relative shrink-0"
                  style={{ color: active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.65)" }}
                />
                {!collapsed && (
                  <span className="relative min-w-0 block text-[13.5px] font-medium">
                    {item.label}
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

/** The same links as a scrollable strip, for phones where the rail hides. */
export function FormsMobileNav() {
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
            className="shrink-0 rounded-pill px-3.5 h-9 inline-flex items-center text-[13.5px] font-semibold whitespace-nowrap"
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
