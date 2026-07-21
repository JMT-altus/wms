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
};

const STYLES: Record<ModuleId, Style> = {
  wms: {
    Icon: LayoutGrid,
    bg: "linear-gradient(140deg, #eaf1ff 0%, #dde9ff 100%)",
    ink: "#1e4fa8",
    title: "#0A47B3",
    btn: "linear-gradient(135deg, #0A6CFF, #0047B3)",
  },
  employees: {
    Icon: Users,
    bg: "linear-gradient(140deg, #e9f9f0 0%, #d7f3e2 100%)",
    ink: "#1f7a4d",
    title: "#15803d",
    btn: "linear-gradient(135deg, #22b563, #15803d)",
  },
  sales: {
    Icon: TrendingUp,
    bg: "linear-gradient(140deg, #eef0ff 0%, #e4e4ff 100%)",
    ink: "#4a45b8",
    title: "#4338CA",
    btn: "linear-gradient(135deg, #6366F1, #4338CA)",
  },
  training: {
    Icon: GraduationCap,
    bg: "linear-gradient(140deg, #e6f6f9 0%, #d9eefb 100%)",
    ink: "#0b7c8a",
    title: "#0B7C8A",
    btn: "linear-gradient(135deg, #10b7c9, #0b7c8a)",
  },
};

export default async function HubPage() {
  const me = await getCurrentEmployee();
  const firstName = me ? (me.name.split(" ")[0] ?? me.name) : "there";

  return (
    <div
      className="min-h-screen"
      style={{ background: "radial-gradient(120% 80% at 50% -10%, #eaf1fc 0%, #f5f7fb 55%, #eef1f6 100%)" }}
    >
      {/* Top bar */}
      <header className="mx-auto max-w-[1440px] px-8 max-md:px-4 pt-7 flex items-center justify-between gap-4">
        <Link href={"/hub" as Route} className="flex items-center gap-3 shrink-0" aria-label="JMT Drive Solutions">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.png" alt="JMT Drive Solutions" className="h-14 w-auto" style={{ display: "block" }} />
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
      <div className="mx-auto max-w-[1440px] px-8 max-md:px-4 text-center mt-8 mb-12">
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
          className="mt-2 text-ink-strong"
          style={{ fontFamily: "var(--font-sans)", fontWeight: 900, fontSize: 54, lineHeight: 1.04, letterSpacing: "-0.025em" }}
        >
          Welcome back, {firstName}
        </h1>
        <p className="mt-3 text-ink-muted" style={{ fontSize: 17 }}>
          Choose your workspace to get started
        </p>
      </div>

      {/* Module tiles */}
      <div className="mx-auto max-w-[1440px] px-8 max-md:px-4 pb-20 grid gap-6 grid-cols-1 sm:grid-cols-2 xl:grid-cols-4">
        {MODULES.map((m) => {
          const s = STYLES[m.id];
          const Icon = s.Icon;
          return (
            <Link
              key={m.id}
              href={m.landing as Route}
              className="group relative flex flex-col overflow-hidden rounded-[22px] p-7 transition-transform hover:-translate-y-1"
              style={{ background: s.bg, boxShadow: "0 14px 40px -26px rgba(15,23,42,0.5)", minHeight: 260 }}
            >
              {/* faded decorative glyph */}
              <Icon
                aria-hidden
                size={150}
                strokeWidth={1.5}
                className="pointer-events-none absolute -right-6 -bottom-6 opacity-[0.10]"
                style={{ color: s.ink }}
              />
              {/* icon chip */}
              <span
                className="grid place-items-center rounded-2xl bg-white/80"
                style={{ width: 52, height: 52, boxShadow: "0 4px 12px -6px rgba(15,23,42,0.25)" }}
              >
                <Icon size={26} strokeWidth={2.2} style={{ color: s.ink }} />
              </span>

              <h2
                className="relative mt-6"
                style={{ fontFamily: "var(--font-sans)", fontWeight: 800, fontSize: 29, letterSpacing: "-0.01em", color: s.title }}
              >
                {m.label}
              </h2>
              <p className="relative mt-2 font-semibold" style={{ fontSize: 15, lineHeight: 1.45, color: s.ink, maxWidth: 260 }}>
                {m.tagline}
              </p>

              <div className="relative mt-auto pt-7">
                <span
                  className="inline-flex items-center gap-2 rounded-xl px-5 py-3 text-white"
                  style={{
                    background: s.btn,
                    fontSize: 14.5,
                    fontWeight: 700,
                    boxShadow: `0 10px 22px -10px ${s.title}`,
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
  );
}
