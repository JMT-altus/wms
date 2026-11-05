/**
 * "Powered by Altus Corp" — the existing Altus Corp logo asset, shown in every
 * left rail directly above Back to Hub (it used to sit in the page footer).
 * The white logo on the navy rails, the coloured one on the white WMS shell;
 * collapsed rails show the mark alone. Presentation only.
 */
export function PoweredByAltus({ light = false, collapsed = false, className = "" }: { light?: boolean; collapsed?: boolean; className?: string }) {
  return (
    <div className={`flex items-center pb-2 pt-1 ${collapsed ? "justify-center" : "gap-2.5 px-3.5"} ${className}`} data-testid="powered-by-altus" title="Powered by Altus Corp">
      {!collapsed && (
        <span
          className="whitespace-nowrap"
          style={{
            fontFamily: "var(--font-mono-display), ui-monospace, monospace",
            fontSize: 10,
            fontWeight: 800,
            letterSpacing: "0.18em",
            color: light ? "#64748B" : "rgba(255, 255, 255, 0.5)",
          }}
        >
          POWERED BY
        </span>
      )}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={light ? "/altus-corp-logo.png" : "/altus-corp-logo-white.png"}
        alt="Altus Corp"
        style={{ height: collapsed ? 28 : 36, width: "auto", display: "block" }}
      />
    </div>
  );
}
