"use client";

import * as React from "react";

export interface DashboardTab {
  /** The section's anchor id. */
  id: string;
  label: string;
}

/**
 * The dashboard's section rail — one pill per analytics section, pinned under
 * the filter bar.
 *
 * The dashboard is long enough that scrolling to a section is a chore, and
 * long enough that you lose track of where you are inside it. The rail fixes
 * both: click to jump, and the highlighted pill tells you what you're looking
 * at. Sections are observed rather than tracked by scroll position, so the
 * highlight stays right even when a section is collapsed.
 */
export function DashboardTabs({ tabs }: { tabs: DashboardTab[] }) {
  const [active, setActive] = React.useState(tabs[0]?.id ?? "");

  React.useEffect(() => {
    const targets = tabs
      .map((t) => document.getElementById(t.id))
      .filter((el): el is HTMLElement => el != null);
    if (targets.length === 0) return;

    // The band that counts as "where you are": just under the sticky chrome,
    // down to the middle of the viewport. Whichever section is topmost inside
    // it wins, so a tall section doesn't hand the highlight to the next one
    // the moment its heading scrolls past.
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-190px 0px -50% 0px", threshold: 0 },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [tabs]);

  return (
    <nav
      aria-label="Dashboard sections"
      className="sticky z-30 border-b border-hairline max-sm:hidden"
      style={{
        // Sits directly under the filter bar, which itself sits under the app
        // header — no gap, or the page shows through as content scrolls past.
        top: "calc(var(--app-header-h) + var(--filter-bar-h, 44px))",
        backgroundColor: "rgba(250, 251, 252, 0.9)",
        backdropFilter: "blur(20px) saturate(150%)",
        WebkitBackdropFilter: "blur(20px) saturate(150%)",
      }}
    >
      <div className="nav-scroll mx-auto flex max-w-[1600px] items-center gap-1 overflow-x-auto px-12 py-2 max-md:px-4">
        {tabs.map((tab) => {
          const isActive = tab.id === active;
          return (
            <a
              key={tab.id}
              href={`#${tab.id}`}
              onClick={(e) => {
                e.preventDefault();
                const el = document.getElementById(tab.id);
                if (!el) return;
                setActive(tab.id);
                el.scrollIntoView({ behavior: "smooth", block: "start" });
                // Keep the URL clean: the hash would survive a reload and
                // fight the observer on the way back in.
              }}
              aria-current={isActive ? "true" : undefined}
              className="shrink-0 rounded-[8px] px-3 py-1.5 text-[13.5px] font-semibold whitespace-nowrap transition-colors"
              style={
                isActive
                  ? { background: "var(--color-altus-red)", color: "#ffffff" }
                  : { color: "var(--color-ink-soft)" }
              }
            >
              {tab.label}
            </a>
          );
        })}
      </div>
    </nav>
  );
}
