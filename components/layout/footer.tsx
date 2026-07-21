export function DashboardFooter() {
  return (
    <footer
      className="mt-32"
      style={{
        background: "linear-gradient(180deg, #04203f 0%, #01152b 100%)",
        color: "#ffffff",
        borderTop: "1px solid rgba(255,255,255,0.06)",
      }}
    >
      <div className="mx-auto max-w-[1600px] px-12 max-md:px-4 py-7 flex items-center justify-between gap-6 max-md:flex-col max-md:gap-4">
        {/* LEFT — logo mark (no background) + wordmark */}
        <div className="flex items-center gap-3 shrink-0">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="JMT Drive Solutions"
            style={{ height: 44, width: "auto", display: "block" }}
          />
          <span
            className="font-bold"
            style={{ fontSize: 16, letterSpacing: "-0.01em", color: "#ffffff" }}
          >
            JMT Drive Solutions
          </span>
        </div>

        {/* CENTER — copyright */}
        <p
          className="text-center flex-1"
          style={{ fontSize: 13.5, color: "rgba(255, 255, 255, 0.55)" }}
        >
          © JMT Drive Solutions 2025–2035 · All rights reserved
        </p>

        {/* RIGHT — powered by Altus Corp */}
        <div className="flex items-center gap-2.5 shrink-0">
          <span
            style={{
              fontFamily: "var(--font-mono-display), ui-monospace, monospace",
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: "0.18em",
              color: "rgba(255, 255, 255, 0.5)",
            }}
          >
            POWERED BY
          </span>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/altus-corp-logo-white.png"
            alt="Altus Corp"
            style={{ height: 44, width: "auto", display: "block" }}
          />
        </div>
      </div>
    </footer>
  );
}
