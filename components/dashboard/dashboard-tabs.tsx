"use client";

import * as React from "react";

export interface DashboardTab {
  /** The section's anchor id. */
  id: string;
  label: string;
}

/**
 * The dashboard's section rail — one pill per analytics section, pinned under
 * the filter bar. All sections live on one continuous page: clicking a pill
 * scrolls to its section, and the highlighted pill follows what you are
 * looking at. Sections are observed rather than tracked by scroll position, so
 * the highlight stays right even when a section is collapsed.
 */
export function DashboardTabs({ tabs }: { tabs: DashboardTab[] }) {
  const [active, setActive] = React.useState(tabs[0]?.id ?? "");
  const navRef = React.useRef<HTMLElement>(null);
  // While a click-initiated smooth scroll is running, the observer would hand
  // the highlight to every section it passes. It is paused until the scroll ends.
  const lockUntil = React.useRef(0);

  // The rail wraps to a second row on a narrower window; publish its height so
  // a tab click leaves the section heading clear of it (see .dash-anchor).
  React.useEffect(() => {
    const el = navRef.current;
    if (!el) return;
    const root = document.documentElement;
    const publish = () => root.style.setProperty("--dash-tabs-h", `${el.offsetHeight}px`);
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => {
      ro.disconnect();
      root.style.removeProperty("--dash-tabs-h");
    };
  }, []);

  React.useEffect(() => {
    const targets = tabs
      .map((t) => document.getElementById(t.id))
      .filter((el): el is HTMLElement => el != null);
    if (targets.length === 0) return;

    // The band that counts as "where you are": from the bottom of the sticky
    // chrome (header + filters + this rail) down to the middle of the
    // viewport. Whichever section is topmost inside it wins.
    const top = Math.round(navRef.current?.getBoundingClientRect().bottom ?? 190);
    const observer = new IntersectionObserver(
      (entries) => {
        if (Date.now() < lockUntil.current) return;
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: `-${top}px 0px -50% 0px`, threshold: 0 },
    );
    targets.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [tabs]);

  return (
    <nav
      ref={navRef}
      aria-label="Dashboard sections"
      className="sticky z-30 border-b border-hairline max-sm:hidden"
      style={{
        // Sits directly under the filter bar, which itself sits under the app
        // header — no gap, or the page shows through as content scrolls past.
        top: "calc(var(--app-header-h) + var(--filter-bar-h, 44px))",
        backgroundColor: "rgba(255, 255, 255, 0.96)",
        backdropFilter: "blur(20px) saturate(150%)",
        WebkitBackdropFilter: "blur(20px) saturate(150%)",
      }}
    >
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-x-0 gap-y-0.5 px-8 py-1.5 max-md:px-4 sm:min-h-[var(--dash-row-h)]">
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
                lockUntil.current = Date.now() + 900;
                // The section's scroll-margin-top (.dash-anchor) keeps its
                // heading clear of the sticky header, filters and this rail.
                el.scrollIntoView({ behavior: "smooth", block: "start" });
                // Keep the URL clean: the hash would survive a reload and
                // fight the observer on the way back in.
              }}
              aria-current={isActive ? "true" : undefined}
              className="shrink-0 rounded-lg px-1.5 py-1 text-[12px] font-semibold tracking-[-0.01em] whitespace-nowrap transition-colors hover:bg-[#EEF2F8] hover:text-[#0B2250] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#14336B] motion-reduce:transition-none"
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
