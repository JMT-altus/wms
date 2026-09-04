"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Back / Forward navigation pills, sitting immediately before the JMT mark at
 * the top of the left rail. Browser history doesn't expose a reliable
 * "can go back/forward" signal across browsers, so we don't try to gray-out —
 * buttons always feel clickable; if there's nothing to navigate to,
 * router.back/forward simply no-ops.
 *
 * `compact` is the rail skin: 24px circles and no trailing divider, because
 * the rail is only 216px wide and the logo plate beside it needs the room. The
 * default 30px skin is kept for any full-width bar that wants them back.
 */
export function NavHistoryButtons({ compact = false }: { compact?: boolean } = {}) {
  const router = useRouter();

  const dim = compact ? 24 : 30;
  const baseStyle: React.CSSProperties = {
    width: dim,
    height: dim,
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 9999,
    background: "rgba(255, 255, 255, 0.08)",
    border: "1.5px solid rgba(255, 255, 255, 0.16)",
    color: "rgba(255, 255, 255, 0.88)",
    cursor: "pointer",
    transition:
      "background-color 180ms ease, border-color 180ms ease, transform 180ms ease, box-shadow 220ms ease",
    outline: "none",
  };

  const onEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget;
    el.style.background = "rgba(255, 255, 255, 0.18)";
    el.style.borderColor = "rgba(255, 255, 255, 0.32)";
    el.style.transform = "translateY(-1px)";
    el.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.25)";
  };

  const onLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
    const el = e.currentTarget;
    el.style.background = "rgba(255, 255, 255, 0.08)";
    el.style.borderColor = "rgba(255, 255, 255, 0.16)";
    el.style.transform = "";
    el.style.boxShadow = "";
  };

  return (
    // The rail has a fixed width at every size it is visible, so the compact
    // skin has no breakpoint to hide at — unlike the header, where these
    // competed with the search box below xl.
    <div className={`flex items-center gap-1 shrink-0 ${compact ? "" : "max-xl:hidden"}`}>
      <button
        type="button"
        aria-label="Back"
        onClick={() => router.back()}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        style={baseStyle}
      >
        <ChevronLeft size={compact ? 14 : 16} strokeWidth={2.4} />
      </button>
      <button
        type="button"
        aria-label="Forward"
        onClick={() => router.forward()}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        style={baseStyle}
      >
        <ChevronRight size={compact ? 14 : 16} strokeWidth={2.4} />
      </button>
      {!compact && (
        <span
          aria-hidden
          className="ml-2 mr-1 inline-block"
          style={{
            width: 1,
            height: 20,
            background: "rgba(255, 255, 255, 0.15)",
          }}
        />
      )}
    </div>
  );
}
