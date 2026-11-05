"use client";

import * as React from "react";
import { PoweredByAltus } from "@/components/layout/powered-by";
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
  TrendingUp,
  Trash2,
  ArrowLeft,
  LayoutGrid,
  Building2,
  FileUp,
  ClipboardList,
  Receipt,
  ShoppingCart,
  FileMinus,
  FileDiff,
  Wallet,
  Banknote,
  Scale,
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
import { DOCUMENT_SECTIONS, FORMS_ROUTES, TALLY_DOCUMENT_TYPES } from "@/lib/tally/sections";

/**
 * The Forms module's left navigation.
 *
 * A deliberate mirror of components/masters/masters-sidebar.tsx — same navy
 * panel, same accent on the active row, same logo plate and "Back to Hub"
 * footer. Three groups: Client KYC (the original Forms), the masters
 * (Customer Master — moved here from Admin & Master Setup — and Vendor Master),
 * and Tally (the import screen, also moved here, plus one ledger per imported
 * category). The two admin-only rows are hidden from non-admins; the server
 * gates them regardless.
 */

interface NavItem {
  href: Route;
  label: string;
  hint: string;
  icon: LucideIcon;
  /** A small heading drawn above this item (the first of a group). */
  groupLabel?: string;
  /** Active only on this exact path (the overview, which every other route is under). */
  exact?: boolean;
  /** Shown to admins only; the page itself requires admin too. */
  adminOnly?: boolean;
}

const BASE = "/forms/client-kyc";

const DOC_ICONS: Record<string, LucideIcon> = { "sales-orders": ClipboardList, "sales-invoices": Receipt, "purchase-invoices": ShoppingCart, "credit-notes": FileMinus, "debit-notes": FileDiff, "customer-receipts": Wallet, "vendor-payments": Banknote };

const NAV: ReadonlyArray<NavItem> = [
  { href: FORMS_ROUTES.overview, label: "Overview", hint: "Every Forms section and what it holds", icon: LayoutGrid, exact: true },
  { href: `${BASE}/new` as Route, label: "Create New Client KYC", hint: "Onboard a client end to end", icon: FilePlus2, groupLabel: "Client KYC" },
  { href: `${BASE}/drafts` as Route, label: "Draft", hint: "Unfinished KYC records", icon: FileClock },
  { href: `${BASE}/clients` as Route, label: "Client Master", hint: "Every onboarded client", icon: FileText },
  { href: `${BASE}/credit-limit` as Route, label: "Credit Limit", hint: "Which limits went up or down", icon: TrendingUp },
  { href: `${BASE}/contacts` as Route, label: "Client Contact Master", hint: "Every contact person", icon: Contact },
  { href: `${BASE}/address-book` as Route, label: "Client Address Book", hint: "Billing, delivery & mailing addresses", icon: BookUser },
  { href: `${BASE}/banks` as Route, label: "Client Bank Master", hint: "Every bank account", icon: Landmark },
  { href: `${BASE}/cust-dropdown` as Route, label: "Client Master DD", hint: "Options behind the KYC pickers", icon: SlidersHorizontal },
  { href: `${BASE}/recycle-bin` as Route, label: "Recycle Bin", hint: "Deleted clients", icon: Trash2 },
  { href: FORMS_ROUTES.customerMaster, label: "Customer Master", hint: "Every customer, with Tally imports", icon: Contact, groupLabel: "Masters", adminOnly: true },
  { href: FORMS_ROUTES.vendorMaster, label: "Vendor Master", hint: "Vendors imported from Tally", icon: Building2 },
  { href: FORMS_ROUTES.tallyImport, label: "Tally Data Import", hint: "Excel / CSV from Tally", icon: FileUp, groupLabel: "Tally", adminOnly: true },
  ...TALLY_DOCUMENT_TYPES.map((t) => ({ href: DOCUMENT_SECTIONS[t].href, label: DOCUMENT_SECTIONS[t].label, hint: DOCUMENT_SECTIONS[t].hint, icon: DOC_ICONS[t]! })),
  { href: FORMS_ROUTES.outstanding, label: "Outstanding Balances", hint: "Receivables & payables, by snapshot", icon: Scale },
];

/** The rail for one person: admin-only rows drop out for everyone else, and a group's heading moves to its first visible row. */
export function navFor(isAdmin: boolean): ReadonlyArray<NavItem> {
  const items = NAV.filter((i) => isAdmin || !i.adminOnly);
  const out: NavItem[] = [];
  let pendingGroup: string | undefined;
  for (const i of NAV) {
    if (i.groupLabel) pendingGroup = i.groupLabel;
    if (!items.includes(i)) continue;
    out.push(pendingGroup ? { ...i, groupLabel: pendingGroup } : i);
    pendingGroup = undefined;
  }
  return out;
}

/** Active when the path is the item, or under it — except Outstanding, whose two views share one row. */
function isActive(item: NavItem, pathname: string): boolean {
  if (item.exact) return pathname === item.href;
  if (item.href === FORMS_ROUTES.outstanding) return pathname.startsWith("/forms/outstanding");
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

/* The Forms accent, taken from the module's own hub tile (see STYLES.forms
   in app/(app)/hub/page.tsx) rather than borrowed from Masters — the tile is
   rose and the rail was blue, so the two read as different products. */
const ACCENT_FROM = "#FB7185";
const ACCENT_TO = "#BE123C";
const ACCENT = `linear-gradient(135deg, ${ACCENT_FROM} 0%, ${ACCENT_TO} 100%)`;

export function FormsSidebar({ userName, isAdmin = false }: { userName: string; isAdmin?: boolean }) {
  const items = navFor(isAdmin);
  const pathname = usePathname();
  const collapsed = useRailCollapsed();

  return (
    <aside
      // `module-rail` is the hook globals.css uses to fold this away in
      // full screen — see the [data-app-fullscreen] rule there.
      className="module-rail header-dark rail-navy sticky top-0 self-start h-screen max-h-screen relative shrink-0 flex flex-col max-md:hidden transition-[width] duration-200"
      aria-label="Forms"
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
              <p className="module-chip text-[13px] mt-3 px-2.5 py-1.5 rounded-lg font-bold text-white leading-[1.25]">Forms</p>
              <p className="text-[12px] mt-1.5 text-white/50">Signed in as {userName}</p>
            </>
          )}
        </div>

        <nav className="px-3 flex flex-col gap-1 flex-1 overflow-y-auto min-h-0">
          {items.map((item) => {
            const Icon = item.icon;
            const active = isActive(item, pathname);
            return (
              <React.Fragment key={item.href}>
                {item.groupLabel && !collapsed && <p className="mt-3 mb-0.5 px-3 text-[10.5px] font-bold uppercase tracking-[0.12em] text-white/40">{item.groupLabel}</p>}
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  title={collapsed ? item.label : item.hint}
                  className={`group relative flex gap-2.5 py-2.5 rounded-lg transition-all ${collapsed ? "items-center justify-center px-0" : "items-center px-3"}`}
                  style={
                    active
                      ? {
                          background: ACCENT,
                          color: "#ffffff",
                          boxShadow: "0 8px 22px -10px rgba(190,18,60,0.55), inset 0 1px 0 rgba(255,255,255,0.14)",
                        }
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
          <PoweredByAltus collapsed={collapsed} />
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
export function FormsMobileNav({ isAdmin = false }: { isAdmin?: boolean }) {
  const items = navFor(isAdmin);
  const pathname = usePathname();
  return (
    <div className="rail-navy-top md:hidden sticky top-0 z-30 flex items-center gap-2 px-4 py-2.5 overflow-x-auto" aria-label="Forms">
      <PoweredByAltus collapsed className="shrink-0 !p-0" />
      <Link href={"/hub" as Route} aria-label="Back to Hub" className="shrink-0 inline-flex items-center justify-center rounded-pill size-9 text-white/80" style={{ border: "1px solid rgba(255,255,255,0.16)" }}>
        <ArrowLeft size={16} strokeWidth={2.4} />
      </Link>
      {items.map((item) => {
        const active = isActive(item, pathname);
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className="shrink-0 rounded-pill px-3.5 h-9 inline-flex items-center text-[13.5px] font-semibold whitespace-nowrap" style={active ? { background: ACCENT, color: "#fff" } : { color: "rgba(255,255,255,0.78)", border: "1px solid rgba(255,255,255,0.16)" }}>
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
