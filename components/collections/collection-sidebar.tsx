"use client";

import * as React from "react";
import type { CSSProperties } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import {
  LayoutDashboard,
  ClipboardList,
  Building2,
  HandCoins,
  Archive,
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
 * The Collection module's left navigation — the same navy rail the Forms and
 * Masters modules use, so the move out of Forms changes where Collection
 * lives, not how it looks. The links are exactly the Collection entries the
 * Forms rail used to carry, under the same "Collection" heading.
 */

interface NavItem {
  href: Route;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** A small heading drawn above this item (the first of a group). */
  groupLabel?: string;
}

export const COLLECTION_BASE = "/collection";

const NAV: ReadonlyArray<NavItem> = [
  {
    href: `${COLLECTION_BASE}/dashboard` as Route,
    label: "Collection Dashboard",
    hint: "Outstanding and follow-ups at a glance",
    icon: LayoutDashboard,
    groupLabel: "Collection",
  },
  {
    href: `${COLLECTION_BASE}/tracker` as Route,
    label: "Collection Tracker",
    hint: "Party-wise follow-ups",
    icon: ClipboardList,
  },
  {
    href: `${COLLECTION_BASE}/master` as Route,
    label: "Collection Master",
    hint: "Companies, coordinators & payment terms",
    icon: Building2,
  },
];

/**
 * Shown only with collection.commitments.view or collection.escalation.review
 * (decided on the server); the page and its data check again regardless.
 */
const COMMITMENTS_ITEM: NavItem = {
  href: `${COLLECTION_BASE}/commitments` as Route,
  label: "Commitments & Escalations",
  hint: "Restricted: commitments and reviews",
  icon: HandCoins,
};

/** Shown only with collection.logs.view (decided on the server); the page checks again regardless. */
const LOGS_ITEM: NavItem = {
  href: `${COLLECTION_BASE}/logs` as Route,
  label: "Collection Logs",
  hint: "Closed collections and their history",
  icon: Archive,
};

/**
 * The rail for this person: the Collection screens only with collection.view,
 * and the restricted pages only with their capabilities. Hiding is a courtesy —
 * every Collection page and action checks on the server. Same signature as the
 * Forms rail's navFor used to have, so the callers and tests carry over.
 */
export function navFor(showCommitments: boolean, showCollection: boolean, showLogs = false): ReadonlyArray<NavItem> {
  const base = showCollection ? NAV : [];
  const extra = [showCommitments && COMMITMENTS_ITEM, showLogs && LOGS_ITEM].filter((i): i is NavItem => Boolean(i));
  if (extra.length === 0) return base;
  // The restricted pages keep the group heading when they are the only entries.
  const items = [...base, ...extra];
  return items[0]!.groupLabel ? items : [{ ...items[0]!, groupLabel: "Collection" }, ...items.slice(1)];
}

/* The module's own teal — the Collection tile's accent on the hub and in
   nav-modules.ts, so the rail and the front door agree. */
const ACCENT_FROM = "#0EA5B7";
const ACCENT_TO = "#0B6B8A";
const ACCENT = `linear-gradient(135deg, ${ACCENT_FROM} 0%, ${ACCENT_TO} 100%)`;

export function CollectionSidebar({
  userName,
  showCommitments = false,
  showCollection = true,
  showLogs = false,
}: {
  userName: string;
  showCommitments?: boolean;
  showCollection?: boolean;
  showLogs?: boolean;
}) {
  const items = navFor(showCommitments, showCollection, showLogs);
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
          <div className={`flex gap-2 ${collapsed ? "flex-col items-center" : "items-stretch"}`} style={collapsed ? undefined : { height: "var(--app-header-h)" }}>
            {/* The mark is the way back to the hub — the same destination as the
                "Back to Hub" footer, on the thing people reach for first. */}
            <Link href={"/hub" as Route} title="Back to Hub" className="flex items-center justify-center brand-plate rounded-xl px-2.5 py-2 min-w-0 flex-1">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/logo-mark.png" alt="JMT Drive Solutions" style={{ height: collapsed ? 26 : 40, width: "auto", display: "block" }} />
            </Link>
            <RailToggle className={collapsed ? "mt-2" : "rail-toggle-in-band absolute right-4 z-10"} />
          </div>
          {!collapsed && (
            <>
              <p className="module-chip text-[13px] mt-3 px-2.5 py-1.5 rounded-lg font-bold text-white leading-[1.25]">Collection</p>
              <p className="text-[12px] mt-1.5 text-white/50">Signed in as {userName}</p>
            </>
          )}
        </div>

        <nav className="px-3 flex flex-col gap-1 flex-1 overflow-y-auto min-h-0">
          {items.length === 0 && !collapsed && (
            <p className="px-3 py-2 text-[12.5px] leading-snug text-white/55">
              No Collection sections are open to you yet. A super-admin grants them in Field Permissions.
            </p>
          )}
          {items.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <React.Fragment key={item.href}>
                {item.groupLabel && !collapsed && (
                  <p className="mt-3 mb-0.5 px-3 text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/40">{item.groupLabel}</p>
                )}
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  title={collapsed ? item.label : item.hint}
                  className={`group relative flex gap-2.5 py-2.5 rounded-lg transition-all ${collapsed ? "items-center justify-center px-0" : "items-center px-3"}`}
                  style={
                    active
                      ? { background: ACCENT, color: "#ffffff", boxShadow: "0 8px 22px -10px rgba(14,165,183,0.55), inset 0 1px 0 rgba(255,255,255,0.14)" }
                      : { color: "rgba(255,255,255,0.80)" }
                  }
                >
                  {!active && <span aria-hidden className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity" style={{ background: "rgba(255,255,255,0.06)" }} />}
                  <Icon size={18} strokeWidth={2.2} className="relative shrink-0" style={{ color: active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.65)" }} />
                  {!collapsed && <span className="relative min-w-0 block text-[13.5px] font-medium">{item.label}</span>}
                </Link>
              </React.Fragment>
            );
          })}
        </nav>

        <div className="px-3 pb-4 pt-2.5 shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.10)" }}>
          <Link
            href={"/hub" as Route}
            title={collapsed ? "Back to Hub" : undefined}
            className={`group flex items-center gap-2.5 py-2.5 rounded-lg text-[14px] text-white/75 hover:text-white hover:bg-white/[0.06] transition-colors ${collapsed ? "px-0 justify-center" : "px-3.5"}`}
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
export function CollectionMobileNav({
  showCommitments = false,
  showCollection = true,
  showLogs = false,
}: {
  showCommitments?: boolean;
  showCollection?: boolean;
  showLogs?: boolean;
}) {
  const items = navFor(showCommitments, showCollection, showLogs);
  const pathname = usePathname();
  return (
    <div className="rail-navy-top md:hidden sticky top-0 z-30 flex items-center gap-2 px-4 py-2.5 overflow-x-auto">
      <Link href={"/hub" as Route} aria-label="Back to Hub" className="shrink-0 inline-flex items-center justify-center rounded-pill size-9 text-white/80" style={{ border: "1px solid rgba(255,255,255,0.16)" }}>
        <ArrowLeft size={16} strokeWidth={2.4} />
      </Link>
      {items.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className="shrink-0 rounded-pill px-3.5 h-9 inline-flex items-center text-[13.5px] font-semibold whitespace-nowrap"
            style={active ? { background: ACCENT, color: "#fff" } : { color: "rgba(255,255,255,0.78)", border: "1px solid rgba(255,255,255,0.16)" }}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
