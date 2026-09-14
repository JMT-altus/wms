"use client";

import * as React from "react";
import { ChevronUp } from "lucide-react";

/**
 * The dashboard's section header: a tinted icon bubble, the section name and
 * one line saying what it measures, whatever controls that section owns, and
 * a collapse chevron on the right.
 *
 * Every analytics section on the dashboard wears this, so the sections read as
 * one page rather than a stack of separately-designed panels — and collapsing
 * behaves identically wherever you meet it.
 */
export function SectionHeader({
  id,
  icon,
  title,
  subtitle,
  tone = "red",
  actions,
  collapsed,
  onToggle,
  children,
}: {
  /** Anchor id — the tab strip scrolls to this. */
  id: string;
  /** Optional icon bubble. Omitted on sections that read as page furniture
   *  (Task Summary) rather than as one of the analytics panels. */
  icon?: React.ReactNode;
  title: string;
  subtitle?: React.ReactNode;
  /** Colour token for the icon bubble (red | amber | blue | green | slate). */
  tone?: string;
  /** Section-specific controls (search, transpose, window picker…). */
  actions?: React.ReactNode;
  collapsed: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const bodyId = `${id}-body`;
  return (
    <section
      id={id}
      aria-label={title}
      // scroll-mt clears the sticky header + filter bar + tab strip, so a tab
      // click doesn't park the heading underneath them.
      className="mx-auto max-w-[1600px] px-12 max-md:px-4 mt-10 scroll-mt-[190px]"
    >
      <header className="flex items-start gap-3 border-b border-hairline pb-3.5">
        {icon && (
          <span
            className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-full"
            style={{
              color: `var(--color-${tone}-deep)`,
              background: `color-mix(in srgb, var(--color-${tone}) 12%, #ffffff)`,
            }}
            aria-hidden
          >
            {icon}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2
            className="text-ink-strong"
            style={{
              fontFamily: "var(--font-display), system-ui, sans-serif",
              fontWeight: 800,
              fontSize: 22,
              letterSpacing: "-0.02em",
              lineHeight: 1.15,
            }}
          >
            {title}
          </h2>
          {subtitle && (
            <p className="mt-0.5 text-[13px] font-medium text-ink-soft">{subtitle}</p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={!collapsed}
            aria-controls={bodyId}
            aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
            className="inline-flex size-8 items-center justify-center rounded-[10px] border border-hairline-strong bg-white text-ink-soft transition-colors hover:border-altus-red hover:text-ink-strong"
          >
            <ChevronUp
              size={16}
              strokeWidth={2.4}
              className="transition-transform duration-200"
              style={{ transform: collapsed ? "rotate(180deg)" : "none" }}
            />
          </button>
        </div>
      </header>

      {/* 0fr → 1fr keeps the collapse animated without measuring heights. */}
      <div
        id={bodyId}
        className="grid transition-[grid-template-rows] duration-300 ease-out"
        style={{ gridTemplateRows: collapsed ? "0fr" : "1fr" }}
      >
        <div className="overflow-hidden">
          <div className="pt-5">{children}</div>
        </div>
      </div>
    </section>
  );
}
