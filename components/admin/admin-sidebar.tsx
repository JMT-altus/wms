"use client";

import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { signOut } from "firebase/auth";
import {
  LayoutGrid,
  Activity as ActivityIcon,
  Bell,
  Users,
  Building2,
  Briefcase,
  Tag,
  Package,
  Landmark,
  CreditCard,
  UserCog,
  CalendarDays,
  BadgeIndianRupee,
  IdCard,
  Settings as SettingsIcon,
  ShieldCheck,
  ArrowLeft,
  LogOut,
  type LucideIcon,
} from "lucide-react";
import {
  RAIL_WIDTH,
  RAIL_WIDTH_COLLAPSED,
  useRailCollapsed,
} from "@/components/layout/rail-collapse";
import { RailToggle } from "@/components/layout/rail-toggle";
import { getFirebaseAuth } from "@/lib/firebase/client";

interface Props {
  adminName: string;
  adminEmail: string;
  avatarUrl: string | null;
}

interface NavItem {
  href: Route;
  label: string;
  icon: LucideIcon;
  /** Exact match required (used for /admin itself, so it doesn't stay active
   *  on every nested page). */
  exact?: boolean;
}

const NAV: ReadonlyArray<NavItem> = [
  { href: "/admin" as Route,             label: "Overview",    icon: LayoutGrid,    exact: true },
  { href: "/admin/activity" as Route,    label: "Activity",    icon: ActivityIcon },
  { href: "/admin/notifications" as Route, label: "Notifications", icon: Bell },
  { href: "/admin/employees" as Route,   label: "Employees",   icon: Users },
  { href: "/admin/access" as Route,      label: "Access",      icon: ShieldCheck },
  { href: "/admin/departments" as Route, label: "Departments", icon: Building2 },
  { href: "/admin/clients" as Route,     label: "Clients",     icon: Briefcase },
  { href: "/admin/subjects" as Route,    label: "Subjects",    icon: Tag },
  { href: "/admin/outstanding-products" as Route,      label: "Outstanding Products", icon: Package },
  { href: "/admin/outstanding-entities" as Route,      label: "Outstanding Entities", icon: Landmark },
  { href: "/admin/outstanding-payment-modes" as Route, label: "Outstanding Modes",    icon: CreditCard },
  { href: "/admin/outstanding-responsibles" as Route,  label: "Outstanding Responsibles", icon: UserCog },
  { href: "/admin/holidays" as Route,    label: "Holidays",    icon: CalendarDays },
  { href: "/admin/salary-profiles" as Route, label: "Salary Profiles", icon: BadgeIndianRupee },
  { href: "/admin/designations" as Route,    label: "Designations",    icon: IdCard },
  { href: "/admin/paying-entities" as Route, label: "Paying Entities", icon: Building2 },
  { href: "/admin/settings" as Route,    label: "Settings",    icon: SettingsIcon },
];

export function AdminSidebar({ adminName, adminEmail, avatarUrl }: Props) {
  // Shared across every rail so the choice follows you between modules.
  const collapsed = useRailCollapsed();
  const pathname = usePathname();
  const router = useRouter();

  function isActive(item: NavItem): boolean {
    if (item.exact) return pathname === item.href;
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }

  async function handleSignOut() {
    try {
      await signOut(getFirebaseAuth());
    } catch {
      // Continue regardless — the server-side revoke is what matters.
    }
    await fetch("/api/auth/signout", { method: "POST" });
    router.replace("/login" as Route);
  }

  const initials = adminName
    .split(" ")
    .map((p) => p[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <aside
      // sticky + h-screen pins the entire sidebar to the viewport so the
      // Back / Sign out footer is always one click away on long pages
      // (employees, activity, notifications). Without this the aside grew
      // with the page and the footer ended up below the fold.
      className="module-rail header-dark rail-navy sticky top-0 self-start h-screen max-h-screen relative shrink-0 flex flex-col max-md:hidden transition-[width] duration-200"
      style={{ width: collapsed ? RAIL_WIDTH_COLLAPSED : RAIL_WIDTH }}
    >
      {/* Brighter radial accent washes — mirror the public-app header treatment */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 0% 0%, rgba(10, 108, 255, 0.22), transparent 70%), radial-gradient(ellipse 70% 60% at 100% 100%, rgba(168, 85, 247, 0.16), transparent 70%)",
        }}
      />

      {/* Inner column uses h-full (from the sticky parent's h-screen) so the
          footer is pinned via flex; the nav area scrolls if it ever grows
          beyond the available height. */}
      <div className="relative flex flex-col h-full overflow-hidden">
        {/* Brand block — logo on a white panel so the indigo block in the
            logo stays visible against the dark sidebar surface. */}
        <div className={`shrink-0 pt-3.5 pb-3 ${collapsed ? "px-2.5" : "px-3.5"}`}>
          <div className={`flex items-start gap-2 ${collapsed ? "flex-col items-center" : ""}`}>
            <div
              className="flex items-center gap-2 rounded-lg bg-white px-2 py-1.5 min-w-0 flex-1"
              style={{
                boxShadow:
                  "0 4px 14px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.6)",
              }}
            >
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
                    background:
                      "linear-gradient(135deg, #0A6CFF 0%, #0A6CFF 42%, #17B6A0 100%)",
                    boxShadow: "0 2px 8px rgba(10, 108, 255, 0.35)",
                    letterSpacing: "0.08em",
                  }}
                >
                  Admin
                </span>
              )}
            </div>
            <RailToggle className={collapsed ? "mt-2" : "ml-auto shrink-0"} />
          </div>
          {!collapsed && (
            <p className="text-[11.5px] mt-2.5 text-white/60">jmtdrives.com</p>
          )}
        </div>

        {/* Avatar + identity chip. Dropped when collapsed: it is name and
            email, neither of which survives a 64px rail. */}
        {!collapsed && (
        <div className="px-3.5 pb-4 shrink-0">
          <div
            className="flex items-center gap-3 rounded-xl p-3"
            style={{
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.07)",
            }}
          >
            <span
              className="inline-flex rounded-full shrink-0"
              style={{
                background:
                  "linear-gradient(135deg, var(--color-altus-red), var(--color-rose))",
                padding: 1.5,
              }}
            >
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt={adminName}
                  className="h-10 w-10 rounded-full object-cover block"
                />
              ) : (
                <span
                  className="h-10 w-10 rounded-full flex items-center justify-center text-[13px] font-semibold text-white"
                  style={{
                    background:
                      "linear-gradient(135deg, #475569, #1f2937)",
                  }}
                >
                  {initials}
                </span>
              )}
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14.5px] font-semibold text-white truncate">
                {adminName}
              </div>
              <div className="text-[12.5px] text-white/60 truncate">
                {adminEmail}
              </div>
            </div>
          </div>
        </div>
        )}

        {/* Nav items — scrollable if they ever exceed the available height */}
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
                className={`group relative flex items-center gap-3 py-2 rounded-lg text-[13.5px] font-medium transition-all ${
                  collapsed ? "justify-center px-0" : "px-2.5"
                }`}
                style={
                  active
                    ? {
                        background:
                          "linear-gradient(135deg, #0A6CFF 0%, #0A6CFF 42%, #17B6A0 100%)",
                        color: "#ffffff",
                        boxShadow:
                          "0 8px 22px -10px rgba(10, 108, 255, 0.55), inset 0 1px 0 rgba(255,255,255,0.14)",
                      }
                    : {
                        color: "rgba(255, 255, 255, 0.80)",
                      }
                }
              >
                {!active && (
                  <span
                    aria-hidden
                    className="absolute inset-0 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{
                      background: "rgba(255, 255, 255, 0.06)",
                    }}
                  />
                )}
                <Icon
                  size={18}
                  strokeWidth={2.2}
                  className="relative shrink-0"
                  style={{
                    color: active
                      ? "rgba(255, 255, 255, 0.95)"
                      : "rgba(255, 255, 255, 0.65)",
                  }}
                />
                <span className="relative">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        {/* Footer — pinned to the bottom of the sticky h-screen aside */}
        <div
          className="px-3 pb-6 pt-3 shrink-0"
          style={{ borderTop: "1px solid rgba(255, 255, 255, 0.10)" }}
        >
          {/* Lands on the hub, not the WMS dashboard — the hub is the app's
              real entry point, and a module the admin can't open shouldn't be
              where "back" drops them. */}
          <Link
            href={"/hub" as Route}
            title={collapsed ? "Back to app" : undefined}
            className={`group flex items-center gap-2.5 py-2 rounded-lg text-[13.5px] text-white/75 hover:text-white hover:bg-white/[0.06] transition-colors ${
              collapsed ? "px-0 justify-center" : "px-3"
            }`}
          >
            <ArrowLeft
              size={16}
              strokeWidth={2.2}
              className="shrink-0 transition-transform group-hover:-translate-x-0.5"
            />
            {!collapsed && "Back to app"}
          </Link>
          <button
            type="button"
            onClick={handleSignOut}
            title={collapsed ? "Sign out" : undefined}
            className={`w-full flex items-center gap-2.5 py-2 rounded-lg text-[13.5px] text-white/75 hover:text-white hover:bg-white/[0.06] transition-colors text-left ${
              collapsed ? "px-0 justify-center" : "px-3"
            }`}
          >
            <LogOut size={16} strokeWidth={2.2} className="shrink-0" />
            {!collapsed && "Sign out"}
          </button>
        </div>
      </div>
    </aside>
  );
}
