"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/**
 * Brand header band across the very top of every app page — a full-bleed navy
 * surface with soft blue/teal glows. The gradient "JMT DRIVE SOLUTIONS"
 * wordmark is absolutely centred; the JMT mark sits at the far left (no
 * background plate) and the "Powered by Altus Corp" credit at the far right.
 * A live date / time / system-status cluster sits under the wordmark.
 *
 * Rendered from the (app) layout so it appears on every page. Hidden on the
 * hub (which has its own header) and on distraction-free focus mode.
 */
export function BrandHero({ companyName = "JMT DRIVE SOLUTIONS" }: { companyName?: string }) {
  const pathname = usePathname();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const dateLabel = now
    ? now.toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : "";
  const timeLabel = now
    ? now.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false })
    : "";

  // Hidden on the hub (its own header) and focus mode (distraction-free).
  if (pathname === "/hub" || pathname.includes("/focus")) return null;

  return (
    <section
      className="relative w-full overflow-hidden"
      style={{
        background:
          "radial-gradient(90% 120% at 18% 0%, rgba(10,108,255,0.38), transparent 55%)," +
          "radial-gradient(80% 140% at 86% 8%, rgba(56,229,198,0.20), transparent 55%)," +
          "linear-gradient(115deg, #001836 0%, #012a58 52%, #01345f 100%)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      {/* faint mesh dots */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage: "radial-gradient(rgba(255,255,255,0.06) 1px, transparent 1px)",
          backgroundSize: "26px 26px",
          maskImage: "radial-gradient(ellipse 70% 80% at 50% 40%, black 20%, transparent 78%)",
          WebkitMaskImage: "radial-gradient(ellipse 70% 80% at 50% 40%, black 20%, transparent 78%)",
        }}
      />

      <div className="relative flex items-center justify-center px-10 py-5 max-md:px-4 max-md:py-5" style={{ minHeight: 96 }}>
        {/* CENTER — gradient wordmark + live status chips */}
        <div className="text-center">
          <h1
            style={{
              fontFamily: "var(--font-sans)",
              fontWeight: 900,
              fontSize: 38,
              lineHeight: 1.0,
              letterSpacing: "-0.02em",
              background: "linear-gradient(100deg, #7BB8FF 0%, #4C9AFF 40%, #38E5C6 100%)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              display: "inline-block",
            }}
            className="max-md:!text-[24px]"
          >
            {companyName}
          </h1>
          <div className="mt-2.5 flex flex-wrap items-center justify-center gap-2">
            <Chip>{dateLabel || "—"}</Chip>
            <Chip mono>{timeLabel || "--:--"}</Chip>
            <Chip>
              <span className="inline-block size-2 rounded-full" style={{ background: "#22c55e", boxShadow: "0 0 8px #22c55e" }} />
              System Online
            </Chip>
          </div>
        </div>

        {/* LEFT — JMT mark (no plate), with a soft glow so the teal reads on navy */}
        <div className="absolute left-10 top-1/2 -translate-y-1/2 max-lg:hidden">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="JMT Drive Solutions"
            style={{
              height: 64,
              width: "auto",
              display: "block",
              filter: "drop-shadow(0 0 16px rgba(120,220,255,0.35)) drop-shadow(0 2px 6px rgba(0,0,0,0.5))",
            }}
          />
        </div>

        {/* RIGHT — powered by Altus Corp */}
        <div className="absolute right-10 top-1/2 -translate-y-1/2 flex flex-col items-center gap-1 max-lg:hidden">
          <span
            style={{
              fontFamily: "var(--font-mono-display), ui-monospace, monospace",
              fontSize: 10.5,
              fontWeight: 800,
              letterSpacing: "0.22em",
              color: "rgba(255,255,255,0.55)",
            }}
          >
            POWERED BY
          </span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/altus-corp-logo-white.png"
            alt="Altus Corp"
            style={{ height: 64, width: "auto", display: "block", filter: "drop-shadow(0 2px 6px rgba(0,0,0,0.4))" }}
          />
        </div>
      </div>
    </section>
  );
}

function Chip({ children, mono }: { children: React.ReactNode; mono?: boolean }) {
  return (
    <span
      className="inline-flex items-center gap-2 rounded-full px-3.5 py-1.5"
      style={{
        background: "rgba(255,255,255,0.09)",
        border: "1px solid rgba(255,255,255,0.16)",
        backdropFilter: "blur(4px)",
        fontSize: 12.5,
        fontWeight: 600,
        color: "rgba(255,255,255,0.9)",
        fontFamily: mono ? "var(--font-mono-display), ui-monospace, monospace" : "var(--font-sans)",
        fontVariantNumeric: mono ? "tabular-nums" : undefined,
      }}
    >
      {children}
    </span>
  );
}
