import { Suspense } from "react";
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
  Waypoints,
  BriefcaseBusiness,
  FileText,
  ArrowRight,
  Lock,
} from "lucide-react";
import { getCurrentEmployee } from "@/lib/auth/current";
import { getMyModuleAccess } from "@/lib/auth/module-access";
import { UserMenuServer } from "@/components/header/user-menu-server";
import { PendingLeavePromptServer } from "@/components/attendance/leave/pending-leave-prompt-server";
import { MODULES, type ModuleId } from "@/lib/nav-modules";

export const dynamic = "force-dynamic";

/**
 * How one tile looks: a pastel card, a tinted icon chip, and the module's
 * accent for the icon and the Enter button text. Soft, low-saturation tints
 * so the nine cards read as one calm set rather than nine colours.
 */
type Style = {
  Icon: typeof LayoutGrid;
  /** Card background — a very light pastel. */
  card: string;
  /** Icon chip background — the same hue, a little stronger. */
  chip: string;
  /** Icon colour and the Enter button's text colour. */
  accent: string;
  /** Card border, tinted toward the accent. */
  border: string;
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
  // Soft blue.
  wms: { Icon: LayoutGrid, card: "#F2F7FE", chip: "#DCE9FC", accent: "#1D5FD1", border: "rgba(29,95,209,0.14)" },
  // Soft mint green.
  employees: { Icon: Users, card: "#F1FBF5", chip: "#D7F3E3", accent: "#1F8A55", border: "rgba(31,138,85,0.14)" },
  // Soft lavender.
  sales: { Icon: TrendingUp, card: "#F5F3FE", chip: "#E4DEFB", accent: "#6143CE", border: "rgba(97,67,206,0.14)" },
  // Soft cyan.
  training: { Icon: GraduationCap, card: "#F0FAFB", chip: "#D6F0F4", accent: "#0E7C8C", border: "rgba(14,124,140,0.14)" },
  // Soft blue-grey, the reference-data half of the WMS family.
  masters: { Icon: Boxes, card: "#F3F6FA", chip: "#DFE7F1", accent: "#2F5A8C", border: "rgba(47,90,140,0.14)" },
  // Soft blue-grey.
  targets: { Icon: Target, card: "#F2F6FB", chip: "#DCE6F3", accent: "#2C5E9E", border: "rgba(44,94,158,0.14)" },
  // Soft blue.
  project: { Icon: Waypoints, card: "#F1F6FD", chip: "#DAE7F9", accent: "#2457A6", border: "rgba(36,87,166,0.14)" },
  // Soft lavender-blue.
  hr: { Icon: BriefcaseBusiness, card: "#F3F5FD", chip: "#E0E5FA", accent: "#4A56B8", border: "rgba(74,86,184,0.14)" },
  // Soft beige.
  admin: { Icon: DatabaseZap, card: "#FBF7EE", chip: "#F3E8CF", accent: "#9A6A12", border: "rgba(154,106,18,0.16)" },
  // Soft pink.
  forms: { Icon: FileText, card: "#FDF2F6", chip: "#F8DCE7", accent: "#B8325F", border: "rgba(184,50,95,0.14)" },
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

const NAVY = "#12284A";
const BLUE = "#1A6BE0";
const MUTED = "#5B6B82";

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
  // HR is held back and appended after the admin-only tiles below, so it is the
  // ninth tile on a full hub rather than slotting in before Admin and Forms.
  const visibleModules = MODULES.filter(
    (m) => access[m.id]?.allowed && !m.hiddenFromHub && m.id !== "hr",
  );
  const hrModule = MODULES.find((m) => m.id === "hr");
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
    // Last. Gated by module access like every other module tile (admins pass
    // through the admin bypass; everyone else needs an HR grant).
    ...(hrModule && access.hr?.allowed
      ? [{ key: hrModule.id, label: hrModule.label, tagline: hrModule.tagline, href: hrModule.landing }]
      : []),
  ];

  const istHour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()),
  );
  const { hello, line } = greetingForHour(istHour);

  // Columns: one on phones, two on tablets, four on laptops, five on wide
  // desktops; fewer tiles never stretch across more columns than they fill.
  const gridCols =
    tiles.length >= 5
      ? "sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5"
      : tiles.length === 4
        ? "sm:grid-cols-2 lg:grid-cols-4"
        : tiles.length === 3
          ? "sm:grid-cols-2 lg:grid-cols-3"
          : tiles.length === 2
            ? "sm:grid-cols-2"
            : "";
  const gridMaxWidth = tiles.length >= 5 ? 1320 : tiles.length === 4 ? 1080 : tiles.length === 3 ? 820 : tiles.length === 2 ? 560 : 300;

  return (
    <div
      className="relative min-h-[100svh] overflow-hidden"
      style={{ background: "linear-gradient(180deg, #EEF5FD 0%, #E3EEFA 55%, #DCE9F7 100%)" }}
    >
      {/* Approvers: a reminder of leave requests waiting on them. Streams in on
          its own so it never holds up the hub, and renders nothing for anyone
          with nothing to decide. */}
      <Suspense fallback={null}>
        <PendingLeavePromptServer />
      </Suspense>

      {/* Soft light — two faint washes so the canvas isn't flat, nothing that competes with the cards. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute rounded-full"
          style={{ width: "60vw", height: "60vw", minWidth: 520, minHeight: 520, left: "-18%", top: "-32%", background: "radial-gradient(circle, rgba(255,255,255,0.75), transparent 68%)" }}
        />
        <div
          className="absolute rounded-full"
          style={{ width: "56vw", height: "56vw", minWidth: 480, minHeight: 480, right: "-20%", bottom: "-34%", background: "radial-gradient(circle, rgba(176,206,240,0.55), transparent 68%)" }}
        />
      </div>

      <div className="relative z-10 flex min-h-[100svh] flex-col">
        {/* Top bar — the mark and the brand label on the left, the avatar menu on the right. */}
        <header className="mx-auto w-full max-w-[1320px] px-8 max-md:px-4 pt-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo-mark.png" alt="" className="block h-auto shrink-0" style={{ width: 40 }} />
            <span
              className="whitespace-nowrap"
              style={{ fontFamily: "var(--font-mono-display), ui-monospace, monospace", fontSize: 10.5, fontWeight: 700, letterSpacing: "0.16em", color: MUTED }}
            >
              JMT DRIVE SOLUTIONS | WORKHUB
            </span>
          </div>
          <div className="flex items-center gap-3">
            {/* The same avatar menu as the app header — Admin panel, Profile &
                preferences, Index/Documents and Sign out, all reachable without
                first entering a module. The unread dot rides the avatar. */}
            <UserMenuServer tone="light" />
          </div>
        </header>

        {/* Welcome */}
        <div className="mx-auto w-full max-w-[1320px] px-8 max-md:px-4 text-center mt-8 mb-8 max-md:mt-6 max-md:mb-6">
          <h1 style={{ fontFamily: "var(--font-display), var(--font-sans), sans-serif", color: NAVY }}>
            {hello},{" "}
            <span style={{ color: BLUE }}>{firstName}</span>
          </h1>
          <p className="mt-3 mx-auto" style={{ fontSize: 15.5, lineHeight: 1.5, color: MUTED, maxWidth: 560 }}>
            {line}
          </p>
        </div>

        {/* Access notice — set when the layout guard bounced a direct URL hit. */}
        {deniedModule && (
          <div className="mx-auto w-full max-w-[1320px] px-8 max-md:px-4 mb-6">
            <div
              className="mx-auto flex items-center gap-3 rounded-xl px-5 py-3.5"
              style={{ maxWidth: 620, background: "#FFFFFF", border: "1px solid rgba(220,38,38,0.22)", boxShadow: "0 10px 24px -16px rgba(220,38,38,0.35)" }}
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
        <div className={`mx-auto w-full px-8 max-md:px-4 pb-4 grid gap-5 max-md:gap-4 grid-cols-1 ${gridCols}`} style={{ maxWidth: gridMaxWidth }}>
          {tiles.map((m) => {
            const s = STYLES[m.key as ModuleId | "admin" | "forms"];
            const Icon = s.Icon;
            return (
              <Link
                key={m.key}
                href={m.href as Route}
                className="group relative flex flex-col rounded-2xl p-5 transition-[transform,box-shadow,border-color] duration-200 ease-out hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#1A6BE0]/50"
                style={{
                  background: s.card,
                  border: `1px solid ${s.border}`,
                  boxShadow: "0 1px 2px rgba(18,40,74,0.04), 0 8px 20px -14px rgba(18,40,74,0.18)",
                  // Tall enough for the longest title + three-line tagline, so every card in the grid is the same height.
                  minHeight: 224,
                }}
              >
                {/* hover: a slightly deeper shadow, no glow */}
                <span aria-hidden className="pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-200 group-hover:opacity-100" style={{ boxShadow: "0 14px 30px -16px rgba(18,40,74,0.28), 0 0 0 1px rgba(26,107,224,0.18)" }} />

                {/* icon chip */}
                <span className="relative grid place-items-center rounded-xl" style={{ width: 42, height: 42, background: s.chip }}>
                  <Icon size={21} strokeWidth={2.1} style={{ color: s.accent }} />
                </span>

                <h2 className="relative mt-3.5" style={{ fontFamily: "var(--font-sans), system-ui, sans-serif", fontWeight: 700, fontSize: 16.5, lineHeight: 1.25, letterSpacing: "-0.01em", color: NAVY }}>
                  {m.label}
                </h2>
                <p className="relative mt-1.5" style={{ fontSize: 12.5, lineHeight: 1.5, color: MUTED }}>
                  {m.tagline}
                </p>

                <div className="relative mt-auto pt-4">
                  <span
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 transition-[box-shadow,background-color] duration-200 group-hover:shadow-md"
                    style={{ background: "#FFFFFF", color: NAVY, fontSize: 12.5, fontWeight: 600, border: "1px solid rgba(18,40,74,0.10)", boxShadow: "0 1px 2px rgba(18,40,74,0.06)", lineHeight: 1 }}
                  >
                    Enter
                    <ArrowRight size={13} strokeWidth={2.4} className="transition-transform duration-200 group-hover:translate-x-0.5" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>

        {tiles.length === 0 && (
          <div className="mx-auto w-full max-w-[1320px] px-8 max-md:px-4 lg:flex-1 lg:flex lg:items-center lg:justify-center">
            <div
              className="mx-auto rounded-2xl px-8 py-12 text-center"
              style={{ maxWidth: 520, background: "#FFFFFF", border: "1px solid rgba(18,40,74,0.10)", boxShadow: "0 12px 30px -20px rgba(18,40,74,0.25)" }}
            >
              <Lock size={30} strokeWidth={2.2} style={{ color: "#64748b" }} className="mx-auto" />
              <p className="mt-4" style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 24, letterSpacing: "-0.015em", color: NAVY }}>
                No workspaces yet
              </p>
              <p className="mt-2 text-[14.5px]" style={{ lineHeight: 1.55, color: MUTED }}>
                Your account doesn&rsquo;t have access to any module right now. An admin can
                grant it from the Access page.
              </p>
            </div>
          </div>
        )}

        {/* Subtle platform credit. */}
        <footer className="mt-auto shrink-0 pb-6 pt-6 max-md:pb-5">
          <div className="flex items-center justify-center gap-3 opacity-70">
            <span style={{ fontFamily: "var(--font-mono-display), ui-monospace, monospace", fontSize: 11, fontWeight: 700, letterSpacing: "0.22em", color: MUTED }}>
              POWERED BY
            </span>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/altus-corp-logo.png" alt="Altus Corp" className="w-auto" style={{ height: 36, display: "block" }} />
          </div>
        </footer>
      </div>
    </div>
  );
}
