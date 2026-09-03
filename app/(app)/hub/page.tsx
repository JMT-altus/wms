import Link from "next/link";
import type { Route } from "next";
import {
  LayoutGrid,
  Users,
  TrendingUp,
  GraduationCap,
  DatabaseZap,
  Boxes,
  Target,
  FileText,
  ArrowRight,
  Lock,
} from "lucide-react";
import { getCurrentEmployee } from "@/lib/auth/current";
import { getMyModuleAccess } from "@/lib/auth/module-access";
import { GlobalSearch } from "@/components/header/global-search";
import { UserMenuServer } from "@/components/header/user-menu-server";
import { HubStatus } from "@/components/dashboard/hub-status";
import { HubBell } from "@/components/dashboard/hub-bell";
import { MODULES, type ModuleId } from "@/lib/nav-modules";

export const dynamic = "force-dynamic";

type Style = {
  Icon: typeof LayoutGrid;
  bg: string;
  ink: string;
  title: string;
  btn: string;
  /** Coloured drop-shadow + hover ring, tuned to the module accent. */
  glow: string;
  ring: string;
};

/**
 * Keyed by ModuleId, plus the synthetic "masters" and "forms" tiles.
 *
 * Admin & Master Setup is deliberately NOT a nav module: it lives in the
 * `(admin)` route group with its own sidebar, so it has no top-nav pills, and
 * adding it to MODULES would put a grantable column in /admin/access — letting
 * someone hand a non-admin a tile that leads straight to a Forbidden page.
 * It is gated on `isAdmin`, which is exactly what every /admin page enforces.
 *
 * Forms (reimbursement/leave/reference/breakthrough requests) is the same
 * story — those four pages have no entry point anywhere in the app yet, so
 * the tile is admin-gated for now rather than opened to everyone sight unseen.
 */
const STYLES: Record<ModuleId | "admin" | "forms", Style> = {
  wms: {
    Icon: LayoutGrid,
    bg: "linear-gradient(150deg, #f4f8ff 0%, #dfeaff 55%, #cfe0ff 100%)",
    ink: "#1e4fa8",
    title: "#0A47B3",
    btn: "linear-gradient(135deg, #0A6CFF, #0047B3)",
    glow: "rgba(10, 108, 255, 0.45)",
    ring: "rgba(10, 108, 255, 0.55)",
  },
  employees: {
    Icon: Users,
    bg: "linear-gradient(150deg, #f0fdf6 0%, #dcf6e6 55%, #c7efd6 100%)",
    ink: "#1f7a4d",
    title: "#15803d",
    btn: "linear-gradient(135deg, #22b563, #15803d)",
    glow: "rgba(34, 181, 99, 0.42)",
    ring: "rgba(34, 181, 99, 0.55)",
  },
  sales: {
    Icon: TrendingUp,
    bg: "linear-gradient(150deg, #f3f4ff 0%, #e6e6ff 55%, #d8d8ff 100%)",
    ink: "#4a45b8",
    title: "#4338CA",
    btn: "linear-gradient(135deg, #6366F1, #4338CA)",
    glow: "rgba(99, 102, 241, 0.42)",
    ring: "rgba(99, 102, 241, 0.55)",
  },
  training: {
    Icon: GraduationCap,
    bg: "linear-gradient(150deg, #effbfd 0%, #d9f0f7 55%, #c8e9f6 100%)",
    ink: "#0b7c8a",
    title: "#0B7C8A",
    btn: "linear-gradient(135deg, #10b7c9, #0b7c8a)",
    glow: "rgba(16, 183, 201, 0.42)",
    ring: "rgba(16, 183, 201, 0.55)",
  },
  // The Masters module — WMS blue on a cooler, deeper card so it reads as the
  // reference-data half of the same family rather than a fifth colour.
  masters: {
    Icon: Boxes,
    bg: "linear-gradient(150deg, #eef4ff 0%, #dce8ff 55%, #c8dcff 100%)",
    ink: "#1c3f7d",
    title: "#0A3B8C",
    btn: "linear-gradient(135deg, #0A6CFF 0%, #0EA5B7 58%, #12B3A0 100%)",
    glow: "rgba(14, 165, 183, 0.42)",
    ring: "rgba(14, 165, 183, 0.55)",
  },
  // Violet → indigo, the one accent not already spoken for by another module.
  targets: {
    Icon: Target,
    bg: "linear-gradient(150deg, #f6f3ff 0%, #ebe4ff 55%, #ded2ff 100%)",
    ink: "#5b3fa8",
    title: "#5B21B6",
    btn: "linear-gradient(135deg, #7C3AED, #4F46E5)",
    glow: "rgba(124, 58, 237, 0.42)",
    ring: "rgba(124, 58, 237, 0.55)",
  },
  admin: {
    Icon: DatabaseZap,
    bg: "linear-gradient(150deg, #fff8f0 0%, #ffeede 55%, #ffe2c9 100%)",
    ink: "#9a4b12",
    title: "#B45309",
    btn: "linear-gradient(135deg, #f59e0b, #b45309)",
    glow: "rgba(245, 158, 11, 0.42)",
    ring: "rgba(245, 158, 11, 0.55)",
  },
  // Rose — the one accent family not already spoken for by another tile.
  forms: {
    Icon: FileText,
    bg: "linear-gradient(150deg, #fff1f3 0%, #ffe1e6 55%, #ffd0d9 100%)",
    ink: "#a8264a",
    title: "#BE123C",
    btn: "linear-gradient(135deg, #FB7185, #BE123C)",
    glow: "rgba(244, 63, 94, 0.42)",
    ring: "rgba(244, 63, 94, 0.55)",
  },
};

/** One tile on the hub grid — a module, or the admin-only masters entry. */
interface HubTile {
  key: string;
  label: string;
  tagline: string;
  href: string;
}

/** Time-of-day greeting + a warm line, computed in IST so it matches the team. */
function greetingForHour(hour: number): { hello: string; line: string } {
  if (hour >= 5 && hour < 12)
    return { hello: "Good Morning", line: "A fresh start. Let's make today count." };
  if (hour >= 12 && hour < 17)
    return { hello: "Good Afternoon", line: "You're doing great. Keep the momentum going." };
  if (hour >= 17 && hour < 21)
    return { hello: "Good Evening", line: "Strong finish to the day. You've got this." };
  return { hello: "Good Evening", line: "Wrapping up late? Thank you for your dedication." };
}

export default async function HubPage({
  searchParams,
}: {
  searchParams: Promise<{ denied?: string }>;
}) {
  const [me, access, params] = await Promise.all([
    getCurrentEmployee(),
    getMyModuleAccess(),
    searchParams,
  ]);
  const firstName = me ? (me.name.split(" ")[0] ?? me.name) : "there";

  // Only the modules this person is allowed into get a tile. The guard in
  // app/(app)/layout.tsx enforces the same list on direct URL hits and sends
  // them back here with ?denied=<module>.
  const visibleModules = MODULES.filter((m) => access[m.id]?.allowed);
  const deniedModule = params.denied
    ? MODULES.find((m) => m.id === params.denied)
    : undefined;

  const tiles: HubTile[] = [
    ...visibleModules.map((m) => ({
      key: m.id,
      label: m.label,
      tagline: m.tagline,
      href: m.landing,
    })),
    // Admins only — every /master-setup page calls requireAdmin(), so showing
    // this to anyone else would be a link to a 403.
    //
    // Master Setup is its OWN area (/master-setup), a sibling of the Admin
    // Panel (/admin) rather than a section inside it: one holds the reference
    // data the business runs on, the other administers people and org settings.
    // The Admin Panel keeps its own entry point via the header pill.
    ...(me?.isAdmin
      ? [
          {
            key: "admin",
            label: "Admin & Master Setup",
            tagline: "Products, customers, libraries, permissions & data import.",
            href: "/master-setup",
          },
          // Admin-gated alongside Admin & Master Setup; see the STYLES comment.
          // Opens Client KYC rather than Reimbursements: KYC is the only form
          // here without a second way in, while Reimbursements and Leave
          // Approval both keep their pills in the Employees module.
          {
            key: "forms",
            label: "Forms",
            tagline: "Onboard a client end to end.",
            href: "/forms/client-kyc/new",
          },
        ]
      : []),
  ];

  const istHour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()),
  );
  const { hello, line } = greetingForHour(istHour);

  return (
    // `header-dark` flips the ink tokens to white for everything below, so the
    // greeting and body copy follow the canvas instead of being restyled one
    // by one; `header-navy` is the same scope the app header uses, which
    // styles the search chip and its kbd hint for a navy surface.
    <div
      className="header-dark header-navy relative min-h-[100svh] overflow-hidden"
      style={{ background: "linear-gradient(168deg, #02203f 0%, #04305e 46%, #063f70 100%)" }}
    >
      {/* ── Aurora backdrop — slow-drifting colour glows + a dot mesh, so the
             launcher reads as a living, premium canvas rather than flat white. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="hub-blob-1 absolute rounded-full"
          style={{ width: "44vw", height: "44vw", minWidth: 460, minHeight: 460, left: "-12%", top: "-18%", background: "radial-gradient(circle, rgba(10,108,255,0.46), transparent 66%)", filter: "blur(64px)" }}
        />
        <div
          className="hub-blob-2 absolute rounded-full"
          style={{ width: "40vw", height: "40vw", minWidth: 440, minHeight: 440, right: "-10%", top: "-8%", background: "radial-gradient(circle, rgba(23,182,160,0.40), transparent 66%)", filter: "blur(66px)" }}
        />
        <div
          className="hub-blob-3 absolute rounded-full"
          style={{ width: "40vw", height: "40vw", minWidth: 420, minHeight: 420, left: "32%", bottom: "-26%", background: "radial-gradient(circle, rgba(124,58,237,0.32), transparent 66%)", filter: "blur(74px)" }}
        />
        {/* the canvas sweep — see .hub-canvas-shine in globals.css */}
        <div className="hub-canvas-shine" />

        {/* fine dot mesh, faded toward the edges */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: "radial-gradient(rgba(255,255,255,0.09) 1px, transparent 1px)",
            backgroundSize: "26px 26px",
            maskImage: "radial-gradient(ellipse 85% 72% at 50% 26%, black 22%, transparent 82%)",
            WebkitMaskImage: "radial-gradient(ellipse 85% 72% at 50% 26%, black 22%, transparent 82%)",
          }}
        />
      </div>

      <div className="relative z-10 flex min-h-[100svh] flex-col">
        {/* Top bar — context on the left, actions + identity on the right.
            The old "Hi, {name}" is gone: the hero greets by name two lines
            below and the avatar carries the initials, so it was the third
            printing of the same word. Its slot now holds the clock and
            connection status, which the hub genuinely lacked (the navy brand
            band that carries them elsewhere hides itself here). */}
        <header className="mx-auto w-full max-w-[1440px] px-8 max-md:px-4 pt-5 flex items-center justify-between gap-4">
          <HubStatus />
          <div className="flex items-center gap-3">
            <GlobalSearch />
            <HubBell />
            {/* The same avatar menu as the app header — Admin panel, Profile &
                preferences, Index/Documents and Sign out, all reachable without
                first entering a module. It carries Sign out, so the standalone
                HubSignOut button it replaced would have been a second,
                redundant affordance. The unread dot is suppressed here because
                the bell beside it already shows the count. */}
            <UserMenuServer tone="dark" showUnreadDot={false} />
          </div>
        </header>

        {/* Hero greeting */}
        <div className="mx-auto w-full max-w-[1440px] px-8 max-md:px-4 text-center mt-5 mb-5 max-md:mt-5 max-md:mb-6">
          {/* Eyebrow — glassy pill with a glowing brand dot */}
          <div className="flex justify-center">
            <div
              className="inline-flex items-center gap-2.5 rounded-full px-4 py-1.5"
              style={{
                background: "rgba(255,255,255,0.07)",
                border: "1px solid rgba(255,255,255,0.16)",
                boxShadow:
                  "0 10px 24px -12px rgba(10,108,255,0.5), inset 0 1px 0 rgba(255,255,255,0.18)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
              }}
            >
              {/* The mark itself, in the slot the brand dot used to hold —
                  it says the same thing the dot only gestured at, and the
                  hub is the one screen with no rail to carry it. Decorative
                  beside the wordmark it sits against, so no alt text. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src="/logo-mark.png"
                alt=""
                className="block h-auto shrink-0"
                style={{
                  width: 22,
                  filter:
                    "drop-shadow(0 0 8px rgba(255,255,255,0.5)) drop-shadow(0 3px 8px rgba(10,108,255,0.5))",
                }}
              />
              <span
                style={{
                  fontFamily: "var(--font-mono-display), ui-monospace, monospace",
                  fontSize: 11.5,
                  fontWeight: 800,
                  letterSpacing: "0.24em",
                  color: "#8FC2FF",
                }}
              >
                JMT DRIVE SOLUTIONS · WORKSPACES
              </span>
            </div>
          </div>

          <h1
            className="mt-4"
            style={{ fontFamily: "var(--font-display), var(--font-sans), sans-serif", fontWeight: 800, fontSize: "clamp(38px, 4.6vw, 56px)", lineHeight: 1.0, letterSpacing: "-0.035em" }}
          >
            <span
              style={{ color: "#ffffff", textShadow: "0 1px 0 rgba(0,0,0,0.25), 0 10px 30px rgba(0,0,0,0.35)" }}
            >
              {hello},{" "}
            </span>
            <span className="brand-wordmark-deep">{firstName}</span>
          </h1>

          {/* Elegant gradient divider */}
          <div
            aria-hidden
            className="mx-auto mt-4 rounded-full"
            style={{
              width: 72,
              height: 4,
              background: "linear-gradient(90deg, #0a6cff, #1f9fe0, #12b6a0)",
              boxShadow: "0 6px 16px -4px rgba(10,108,255,0.5)",
            }}
          />

          <p
            className="mt-4 mx-auto font-semibold"
            style={{ fontSize: 17, lineHeight: 1.5, letterSpacing: "-0.005em", color: "rgba(255,255,255,0.72)", maxWidth: 560 }}
          >
            {line}
          </p>
        </div>

        {/* Access notice — set when the layout guard bounced a direct URL hit. */}
        {deniedModule && (
          <div className="mx-auto w-full max-w-[1440px] px-8 max-md:px-4 mb-5">
            <div
              className="mx-auto flex items-center gap-3 rounded-2xl px-5 py-3.5"
              style={{
                maxWidth: 620,
                background: "rgba(255,255,255,0.72)",
                border: "1px solid rgba(220,38,38,0.22)",
                boxShadow: "0 14px 30px -18px rgba(220,38,38,0.45), inset 0 1px 0 rgba(255,255,255,0.9)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
              }}
            >
              <Lock size={18} strokeWidth={2.4} style={{ color: "#b91c1c", flexShrink: 0 }} />
              <p className="text-[14.5px] font-semibold" style={{ color: "#7f1d1d", lineHeight: 1.45 }}>
                You don&rsquo;t have access to <strong>{deniedModule.label}</strong>. Ask an
                admin to enable it for you.
              </p>
            </div>
          </div>
        )}

        {/* Module tiles — only the ones this person may open. */}
        <div
          className={`mx-auto w-full px-8 max-md:px-4 pb-2 grid gap-6 max-md:gap-5 grid-cols-1 lg:flex-1 lg:content-center ${
            tiles.length >= 5
              ? "sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
              : tiles.length === 4
                ? "sm:grid-cols-2 xl:grid-cols-4"
                : tiles.length === 3
                  ? "sm:grid-cols-2 xl:grid-cols-3"
                  : tiles.length === 2
                    ? "sm:grid-cols-2"
                    : ""
          }`}
          style={{
            maxWidth:
              tiles.length >= 5
                ? 1680
                : tiles.length === 4
                  ? 1440
                  : tiles.length === 3
                    ? 1140
                    : tiles.length === 2
                      ? 800
                      : 420,
          }}
        >
          {tiles.map((m, i) => {
            const s = STYLES[m.key as ModuleId | "admin" | "forms"];
            const Icon = s.Icon;
            return (
              <Link
                key={m.key}
                href={m.href as Route}
                className="hub-tile-shine metal-edge group relative flex flex-col overflow-hidden rounded-[24px] p-6 transition-transform duration-300 ease-out hover:-translate-y-2"
                style={{
                  // The tile IS the module's colour now — the pale wash (s.bg)
                  // read as nine near-white cards, so the palette only showed
                  // up in the Enter buttons. Everything on top flips to white
                  // ink; the Enter button inverts to a white chip so it still
                  // separates from the card it sits on.
                  background: s.btn,
                  // Staggered so the row catches the light in sequence rather
                  // than every tile flashing at once — see .hub-tile-shine.
                  ["--tile-shine-delay" as string]: `${i * 0.35}s`,
                  border: "1px solid transparent",
                  boxShadow: `0 40px 70px -26px ${s.glow}, 0 22px 40px -22px rgba(15,23,42,0.22), 0 8px 16px -10px rgba(15,23,42,0.14), 0 1px 2px rgba(15,23,42,0.06), inset 0 2px 0 rgba(255,255,255,0.95), inset 0 -10px 24px -12px rgba(15,23,42,0.10)`,
                  minHeight: 178,
                }}
              >
                {/* glass sheen across the top */}
                <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1/2" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.22), rgba(255,255,255,0) 100%)" }} />
                {/* hover glow ring — fades in on hover (kept off the base card so
                    the resting state stays clean). */}
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-0 rounded-[24px] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  style={{ boxShadow: `0 0 0 1.5px ${s.ring}, 0 34px 74px -30px ${s.glow}` }}
                />
                {/* faded decorative glyph */}
                <Icon
                  aria-hidden
                  size={158}
                  strokeWidth={1.5}
                  className="pointer-events-none absolute -right-7 -bottom-7 opacity-[0.16] transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3"
                  style={{ color: "#ffffff" }}
                />
                {/* icon chip — frosted glass */}
                <span
                  className="relative grid place-items-center rounded-2xl transition-transform duration-300 group-hover:scale-105"
                  style={{
                    width: 54,
                    height: 54,
                    background: "rgba(255,255,255,0.72)",
                    backdropFilter: "blur(6px)",
                    WebkitBackdropFilter: "blur(6px)",
                    border: "1px solid rgba(255,255,255,0.9)",
                    boxShadow: `0 14px 26px -10px ${s.glow}, 0 6px 12px -6px rgba(15,23,42,0.18), inset 0 1px 0 rgba(255,255,255,1), inset 0 -3px 8px -3px rgba(15,23,42,0.08)`,
                  }}
                >
                  <Icon size={27} strokeWidth={2.2} style={{ color: s.ink }} />
                </span>

                <h2
                  className="relative mt-4"
                  style={{ fontFamily: "var(--font-display), var(--font-sans), sans-serif", fontWeight: 800, fontSize: 28, letterSpacing: "-0.02em", color: "#ffffff", textShadow: "0 1px 2px rgba(6,20,44,0.28)" }}
                >
                  {m.label}
                </h2>
                <p className="relative mt-2 font-semibold" style={{ fontSize: 15, lineHeight: 1.5, letterSpacing: "-0.003em", color: "rgba(255,255,255,0.88)", maxWidth: 260 }}>
                  {m.tagline}
                </p>

                <div className="relative mt-auto pt-4">
                  <span
                    className="inline-flex items-center gap-2 rounded-xl px-5 py-3 transition-[filter,box-shadow,transform] duration-300 group-hover:brightness-105 group-hover:-translate-y-0.5"
                    style={{
                      background: "#ffffff",
                      color: s.title,
                      fontSize: 14.5,
                      fontWeight: 700,
                      boxShadow: `0 3px 0 rgba(6,20,44,0.22), 0 14px 24px -8px rgba(6,20,44,0.35), inset 0 -2px 6px -2px rgba(6,20,44,0.10)`,
                      lineHeight: 1,
                    }}
                  >
                    Enter
                    <ArrowRight size={16} strokeWidth={2.6} className="transition-transform group-hover:translate-x-1" />
                  </span>
                </div>
              </Link>
            );
          })}

        </div>

        {tiles.length === 0 && (
          <div className="mx-auto w-full max-w-[1440px] px-8 max-md:px-4 lg:flex-1 lg:flex lg:items-center lg:justify-center">
            <div
              className="mx-auto rounded-[24px] px-8 py-12 text-center"
              style={{
                maxWidth: 520,
                background: "rgba(255,255,255,0.7)",
                border: "1px solid rgba(255,255,255,0.8)",
                boxShadow: "0 30px 60px -30px rgba(15,23,42,0.28), inset 0 1px 0 rgba(255,255,255,0.95)",
                backdropFilter: "blur(8px)",
                WebkitBackdropFilter: "blur(8px)",
              }}
            >
              <Lock size={30} strokeWidth={2.2} style={{ color: "#64748b" }} className="mx-auto" />
              <p
                className="mt-4 text-ink-strong"
                style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 24, letterSpacing: "-0.015em" }}
              >
                No workspaces yet
              </p>
              <p className="mt-2 text-[14.5px] text-ink-subtle" style={{ lineHeight: 1.55 }}>
                Your account doesn&rsquo;t have access to any module right now. An admin can
                grant it from the Access page.
              </p>
            </div>
          </div>
        )}

        {/* Subtle platform credit — the tasteful home for a "powered by" line. */}
        <footer className="shrink-0 pb-6 pt-2 max-md:pb-5">
          <div className="flex items-center justify-center gap-3.5 opacity-80">
            <span
              style={{
                fontFamily: "var(--font-mono-display), ui-monospace, monospace",
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: "0.22em",
                color: "rgba(15,23,42,0.42)",
              }}
            >
              POWERED BY
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/altus-corp-logo.png"
              alt="Altus Corp"
              className="w-auto"
              style={{ height: 44, display: "block", filter: "drop-shadow(0 3px 7px rgba(15,23,42,0.16))" }}
            />
          </div>
        </footer>
      </div>
    </div>
  );
}
