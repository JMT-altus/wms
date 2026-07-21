"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Back / Forward navigation pills mounted at the leftmost end of the
 * header, just before the brand cluster. Browser history doesn't expose
 * a reliable "can go back/forward" signal across browsers, so we don't
 * try to gray-out — buttons always feel clickable; if there's nothing
 * to navigate to, router.back/forward simply no-ops.
 */
export function NavHistoryButtons() {
  const router = useRouter();

  const baseStyle: React.CSSProperties = {
    width: 36,
    height: 36,
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
    <div className="flex items-center gap-1 max-xl:hidden shrink-0">
      <button
        type="button"
        aria-label="Back"
        onClick={() => router.back()}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        style={baseStyle}
      >
        <ChevronLeft size={18} strokeWidth={2.4} />
      </button>
      <button
        type="button"
        aria-label="Forward"
        onClick={() => router.forward()}
        onMouseEnter={onEnter}
        onMouseLeave={onLeave}
        style={baseStyle}
      >
        <ChevronRight size={18} strokeWidth={2.4} />
      </button>
      <span
        aria-hidden
        className="ml-2 mr-1 inline-block"
        style={{
          width: 1,
          height: 24,
          background: "rgba(255, 255, 255, 0.15)",
        }}
      />
    </div>
  );
}
