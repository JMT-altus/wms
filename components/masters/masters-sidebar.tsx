"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import type { Route } from "next";
import { Boxes, Contact, ArrowLeft, type LucideIcon } from "lucide-react";
import { MASTERS_GRADIENT } from "./theme";

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

  return (
    <aside
      className="header-dark sticky top-0 self-start h-screen max-h-screen relative w-[284px] shrink-0 flex flex-col max-md:hidden"
      style={{
        backgroundColor: "rgba(15, 23, 42, 0.96)",
        borderRight: "1px solid rgba(255, 255, 255, 0.08)",
      }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 0% 0%, rgba(10, 108, 255, 0.24), transparent 70%), radial-gradient(ellipse 70% 60% at 100% 100%, rgba(0, 71, 179, 0.20), transparent 70%)",
        }}
      />

      <div className="relative flex flex-col h-full overflow-hidden">
        <div className="px-6 pt-8 pb-5 shrink-0">
          <div
            className="inline-flex items-center gap-2.5 rounded-xl bg-white px-3 py-2"
            style={{ boxShadow: "0 4px 14px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.6)" }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="JMT Drive Solutions" style={{ height: 44, width: "auto", display: "block" }} />
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
          </div>
          <p className="text-[13px] mt-3 font-bold text-white/90">Masters</p>
          <p className="text-[12px] mt-0.5 text-white/50">Signed in as {userName}</p>
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
                className="group relative flex items-start gap-3 px-3.5 py-3 rounded-lg transition-all"
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
                  className="relative shrink-0 mt-0.5"
                  style={{ color: active ? "rgba(255,255,255,0.95)" : "rgba(255,255,255,0.65)" }}
                />
                <span className="relative min-w-0">
                  <span className="block text-[15px] font-medium">{item.label}</span>
                  <span
                    className="block text-[11.5px] mt-0.5"
                    style={{ color: active ? "rgba(255,255,255,0.75)" : "rgba(255,255,255,0.45)" }}
                  >
                    {item.hint}
                  </span>
                </span>
              </Link>
            );
          })}
        </nav>

        <div className="px-3 pb-6 pt-3 shrink-0" style={{ borderTop: "1px solid rgba(255,255,255,0.10)" }}>
          <Link
            href={"/hub" as Route}
            className="group flex items-center gap-2.5 px-3.5 py-2.5 rounded-lg text-[14px] text-white/75 hover:text-white hover:bg-white/[0.06] transition-colors"
          >
            <ArrowLeft size={16} strokeWidth={2.2} className="transition-transform group-hover:-translate-x-0.5" />
            Back to Hub
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
      className="md:hidden sticky top-0 z-30 flex items-center gap-2 px-4 py-2.5 overflow-x-auto"
      style={{
        backgroundColor: "rgba(15, 23, 42, 0.96)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}
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
