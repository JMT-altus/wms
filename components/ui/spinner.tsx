/**
 * Circular buffering spinner — a clean SVG ring with a spinning arc, the kind
 * larger products use while content resolves. Inherits `currentColor`, so set
 * the colour with a text utility (defaults to the brand red). Sizes via the
 * `size` prop. Pair with a label via <BufferingState/> for full-page waits.
 */
export function Spinner({
  size = 22,
  strokeWidth = 2.5,
  className = "",
}: {
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={className}
      style={{ display: "inline-flex", lineHeight: 0 }}
    >
      {/* Comet-tail gradient ring — a blue→teal arc fading to transparent,
          spun by `animate-spin`. A radial mask cuts the centre to a ring so
          it reads as a premium branded loader, not a plain grey spinner. */}
      <span
        className="animate-spin"
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          background:
            "conic-gradient(from 90deg, rgba(76,154,255,0) 0deg, #4C9AFF 210deg, #38E5C6 320deg, rgba(56,229,198,0) 360deg)",
          WebkitMask: `radial-gradient(farthest-side, #0000 calc(100% - ${strokeWidth + 1}px), #000 calc(100% - ${strokeWidth}px))`,
          mask: `radial-gradient(farthest-side, #0000 calc(100% - ${strokeWidth + 1}px), #000 calc(100% - ${strokeWidth}px))`,
          display: "block",
          filter: "drop-shadow(0 0 6px rgba(10, 108, 255, 0.35))",
        }}
      />
    </span>
  );
}

/**
 * Centered spinner + label for full-page / section loading states. Drop into
 * a `loading.tsx` so the wait reads as an intentional "buffering" moment.
 */
export function BufferingState({
  label = "Loading…",
  className = "",
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 ${className}`}
      role="status"
      aria-live="polite"
    >
      <Spinner size={34} strokeWidth={2.75} className="text-altus-red" />
      <span className="text-[14px] font-semibold text-ink-soft">{label}</span>
    </div>
  );
}

/**
 * Viewport-centered buffering overlay for `loading.tsx` files — a single,
 * consistent "circle + label" shown over the route's skeleton on EVERY slow
 * page, so the loading experience is uniform app-wide (not tasks-only).
 * Pointer-events-none so it never blocks the skeleton beneath it.
 */
export function PageBuffering({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-0 z-30 flex items-center justify-center"
    >
      <div className="flex flex-col items-center gap-3 rounded-2xl bg-white/65 px-7 py-6 backdrop-blur-[2px] shadow-sm">
        <Spinner size={34} strokeWidth={2.75} className="text-altus-red" />
        <span className="text-[14px] font-semibold text-ink-soft">{label}</span>
      </div>
    </div>
  );
}
