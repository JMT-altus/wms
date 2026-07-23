import Link from "next/link";
import type { Route } from "next";
import { LayoutGrid, Users, TrendingUp, GraduationCap, ArrowRight } from "lucide-react";
import { getCurrentEmployee } from "@/lib/auth/current";
import { GlobalSearch } from "@/components/header/global-search";
import { HubSignOut } from "@/components/dashboard/hub-sign-out";
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

const STYLES: Record<ModuleId, Style> = {
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
};

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

export default async function HubPage() {
  const me = await getCurrentEmployee();
  const firstName = me ? (me.name.split(" ")[0] ?? me.name) : "there";

  const istHour = Number(
    new Intl.DateTimeFormat("en-US", { hour: "numeric", hour12: false, timeZone: "Asia/Kolkata" }).format(new Date()),
  );
  const { hello, line } = greetingForHour(istHour);

  return (
    <div
      className="relative min-h-screen overflow-hidden"
      style={{ background: "linear-gradient(168deg, #e8f0ff 0%, #f2f7ff 44%, #ebf8f4 100%)" }}
    >
      {/* ── Aurora backdrop — slow-drifting colour glows + a dot mesh, so the
             launcher reads as a living, premium canvas rather than flat white. */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="hub-blob-1 absolute rounded-full"
          style={{ width: "44vw", height: "44vw", minWidth: 460, minHeight: 460, left: "-12%", top: "-18%", background: "radial-gradient(circle, rgba(10,108,255,0.34), transparent 66%)", filter: "blur(64px)" }}
        />
        <div
          className="hub-blob-2 absolute rounded-full"
          style={{ width: "40vw", height: "40vw", minWidth: 440, minHeight: 440, right: "-10%", top: "-8%", background: "radial-gradient(circle, rgba(23,182,160,0.30), transparent 66%)", filter: "blur(66px)" }}
        />
        <div
          className="hub-blob-3 absolute rounded-full"
          style={{ width: "40vw", height: "40vw", minWidth: 420, minHeight: 420, left: "32%", bottom: "-26%", background: "radial-gradient(circle, rgba(124,58,237,0.18), transparent 66%)", filter: "blur(74px)" }}
        />
        {/* fine dot mesh, faded toward the edges */}
        <div
          className="absolute inset-0"
          style={{
            backgroundImage: "radial-gradient(rgba(10,108,255,0.07) 1px, transparent 1px)",
            backgroundSize: "26px 26px",
            maskImage: "radial-gradient(ellipse 85% 72% at 50% 26%, black 22%, transparent 82%)",
            WebkitMaskImage: "radial-gradient(ellipse 85% 72% at 50% 26%, black 22%, transparent 82%)",
          }}
        />
      </div>

      <div className="relative z-10">
        {/* Top bar */}
        <header className="mx-auto max-w-[1440px] px-8 max-md:px-4 pt-7 flex items-center justify-between gap-4">
          <Link href={"/hub" as Route} className="flex items-center gap-3.5 shrink-0" aria-label="JMT Drive Solutions">
            {/* No plate — the teal monogram sits directly on the light canvas,
                lifted by layered drop-shadows so it reads clearly on white. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="JMT Drive Solutions"
              className="h-14 w-auto shrink-0"
              style={{
                display: "block",
                filter:
                  "drop-shadow(0 6px 14px rgba(1,42,88,0.28)) drop-shadow(0 2px 4px rgba(15,23,42,0.18))",
              }}
            />
            <div className="leading-tight max-sm:hidden">
              <div className="brand-wordmark-deep" style={{ fontFamily: "var(--font-sans)", fontWeight: 900, fontSize: 22, letterSpacing: "-0.01em" }}>
                JMT Drive Solutions
              </div>
            </div>
          </Link>
          <div className="flex items-center gap-4">
            <div className="text-right max-sm:hidden">
              <div className="text-[15px] text-ink-muted">
                Hi, <span className="font-bold text-ink-strong">{firstName}</span>
              </div>
            </div>
            <GlobalSearch />
            <HubSignOut />
          </div>
        </header>

        {/* Hero greeting */}
        <div className="mx-auto max-w-[1440px] px-8 max-md:px-4 text-center mt-6 mb-8 max-md:mt-5 max-md:mb-6">
          <div
            style={{
              fontFamily: "var(--font-mono-display), ui-monospace, monospace",
              fontSize: 13,
              fontWeight: 800,
              letterSpacing: "0.26em",
              color: "#0A6CFF",
            }}
          >
            JMT DRIVE SOLUTIONS · WORKSPACES
          </div>
          <h1
            className="mt-3"
            style={{ fontFamily: "var(--font-sans)", fontWeight: 900, fontSize: "clamp(38px, 5vw, 58px)", lineHeight: 1.03, letterSpacing: "-0.03em" }}
          >
            <span className="text-ink-strong">{hello}, </span>
            <span className="brand-wordmark-deep">{firstName}</span>
          </h1>
          <p className="mt-4 font-medium text-ink-muted" style={{ fontSize: 17.5 }}>
            {line}
          </p>
        </div>

        {/* Module tiles */}
        <div className="mx-auto max-w-[1440px] px-8 max-md:px-4 pb-10 grid gap-6 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
          {MODULES.map((m) => {
            const s = STYLES[m.id];
            const Icon = s.Icon;
            return (
              <Link
                key={m.id}
                href={m.landing as Route}
                className="group relative flex flex-col overflow-hidden rounded-[24px] p-7 transition-transform duration-300 ease-out hover:-translate-y-1.5"
                style={{
                  background: s.bg,
                  border: "1px solid rgba(255,255,255,0.7)",
                  boxShadow: `0 26px 60px -30px ${s.glow}, 0 2px 8px rgba(15,23,42,0.06), inset 0 1px 0 rgba(255,255,255,0.9)`,
                  minHeight: 232,
                }}
              >
                {/* glass sheen across the top */}
                <span aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-1/2" style={{ background: "linear-gradient(180deg, rgba(255,255,255,0.55), rgba(255,255,255,0) 100%)" }} />
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
                  className="pointer-events-none absolute -right-7 -bottom-7 opacity-[0.10] transition-transform duration-500 group-hover:scale-110 group-hover:rotate-3"
                  style={{ color: s.ink }}
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
                    boxShadow: `0 8px 18px -8px ${s.glow}`,
                  }}
                >
                  <Icon size={27} strokeWidth={2.2} style={{ color: s.ink }} />
                </span>

                <h2
                  className="relative mt-6"
                  style={{ fontFamily: "var(--font-sans)", fontWeight: 800, fontSize: 29, letterSpacing: "-0.015em", color: s.title }}
                >
                  {m.label}
                </h2>
                <p className="relative mt-2 font-semibold" style={{ fontSize: 15, lineHeight: 1.45, color: s.ink, maxWidth: 260 }}>
                  {m.tagline}
                </p>

                <div className="relative mt-auto pt-7">
                  <span
                    className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-white transition-[filter,box-shadow] duration-300 group-hover:brightness-105"
                    style={{
                      background: s.btn,
                      fontSize: 14.5,
                      fontWeight: 700,
                      boxShadow: `0 12px 26px -10px ${s.glow}, inset 0 1px 0 rgba(255,255,255,0.28)`,
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
      </div>
    </div>
  );
}
