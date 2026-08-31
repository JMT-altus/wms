"use client";

import * as React from "react";
import Link from "next/link";
import type { Route } from "next";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { formatInrCompactPaise } from "@/lib/format";
import { MEASURE_COLORS, TARGETS_GRADIENT } from "./theme";

/** Page heading, matching the Masters table's inline-title treatment. */
export function TargetsHead({
  title,
  lede,
  right,
}: {
  title: string;
  lede?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-3 mb-4 flex-wrap">
      <div className="min-w-0">
        <h1
          className="font-bold text-ink-strong"
          style={{
            fontFamily: "var(--font-display), system-ui, sans-serif",
            fontSize: "clamp(19px, 1.9vw, 26px)",
            letterSpacing: "-0.02em",
            lineHeight: 1.1,
          }}
        >
          {title}
        </h1>
        {lede && (
          <p className="text-ink-muted mt-1 tabular-nums" style={{ fontSize: 13.5 }}>
            {lede}
          </p>
        )}
      </div>
      {right && <div className="shrink-0 flex items-center gap-2">{right}</div>}
    </header>
  );
}

/**
 * Financial-year stepper. A link rather than client state so the year lives in
 * the URL — the page is a server component and the year is a query, not UI.
 */
export function YearSwitcher({
  fyStartYear,
  label,
  basePath,
  extraQuery = "",
}: {
  fyStartYear: number;
  label: string;
  basePath: string;
  extraQuery?: string;
}) {
  const href = (y: number) =>
    `${basePath}?fy=${y}${extraQuery ? `&${extraQuery}` : ""}` as Route;
  return (
    <div className="inline-flex items-center rounded-chip border border-hairline bg-surface-card overflow-hidden shrink-0">
      <Link
        href={href(fyStartYear - 1)}
        aria-label="Previous financial year"
        className="inline-flex items-center justify-center h-9 w-9 text-ink-muted hover:bg-surface-soft transition-colors"
      >
        <ChevronLeft size={16} strokeWidth={2.4} />
      </Link>
      <span
        className="px-3 font-bold text-ink-strong tabular-nums whitespace-nowrap"
        style={{ fontSize: 13.5 }}
      >
        {label}
      </span>
      <Link
        href={href(fyStartYear + 1)}
        aria-label="Next financial year"
        className="inline-flex items-center justify-center h-9 w-9 text-ink-muted hover:bg-surface-soft transition-colors"
      >
        <ChevronRight size={16} strokeWidth={2.4} />
      </Link>
    </div>
  );
}

/** The period picker for quarterly / monthly / weekly screens. */
export function PeriodSwitcher({
  periods,
  activeKey,
  basePath,
  fyStartYear,
}: {
  periods: { key: string; label: string }[];
  activeKey: string;
  basePath: string;
  fyStartYear: number;
}) {
  return (
    <div className="flex items-center gap-1.5 overflow-x-auto pb-1 mb-4">
      {periods.map((p) => {
        const active = p.key === activeKey;
        return (
          <Link
            key={p.key}
            href={`${basePath}?fy=${fyStartYear}&period=${p.key}` as Route}
            aria-current={active ? "page" : undefined}
            className="shrink-0 rounded-chip px-3 h-9 inline-flex items-center font-semibold whitespace-nowrap transition-colors"
            style={
              active
                ? { background: TARGETS_GRADIENT, color: "#fff", fontSize: 13 }
                : {
                    background: "var(--color-surface-card)",
                    border: "1px solid var(--color-hairline)",
                    color: "var(--color-ink-soft)",
                    fontSize: 13,
                  }
            }
          >
            {p.label}
          </Link>
        );
      })}
    </div>
  );
}

/** A headline number with its measure colour. */
export function StatTile({
  label,
  paise,
  tone,
  sub,
}: {
  label: string;
  paise: number;
  tone: keyof typeof MEASURE_COLORS;
  sub?: string;
}) {
  return (
    <div
      className="rounded-section border border-hairline bg-surface-card px-4 py-3.5 min-w-0"
      style={{ borderLeft: `3px solid ${MEASURE_COLORS[tone]}` }}
    >
      <p
        className="uppercase font-bold tracking-[0.08em] text-ink-subtle"
        style={{ fontSize: 10.5 }}
      >
        {label}
      </p>
      <p
        className="font-bold text-ink-strong tabular-nums mt-1"
        style={{ fontSize: 21, letterSpacing: "-0.01em" }}
      >
        {formatInrCompactPaise(paise)}
      </p>
      {sub && (
        <p className="text-ink-muted tabular-nums mt-0.5" style={{ fontSize: 12 }}>
          {sub}
        </p>
      )}
    </div>
  );
}

/** Achievement badge — green at or above plan, amber close, red short. */
export function AchievementPill({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-ink-subtle">—</span>;
  const tone = pct >= 100 ? "green" : pct >= 80 ? "amber" : "red";
  return (
    <span
      className="inline-flex items-center rounded-pill px-2 py-0.5 font-bold tabular-nums whitespace-nowrap"
      style={{
        fontSize: 11.5,
        background: `color-mix(in srgb, var(--color-${tone}) 14%, transparent)`,
        color: `var(--color-${tone}-deep)`,
        border: `1px solid color-mix(in srgb, var(--color-${tone}) 30%, transparent)`,
      }}
    >
      {pct}%
    </span>
  );
}

/** Signed money, coloured by direction. */
export function Variance({ paise }: { paise: number }) {
  if (paise === 0) return <span className="text-ink-subtle tabular-nums">—</span>;
  const up = paise > 0;
  return (
    <span
      className="font-semibold tabular-nums whitespace-nowrap"
      style={{ color: up ? "var(--color-green-deep)" : "var(--color-red-deep)", fontSize: 13 }}
    >
      {up ? "+" : "−"}
      {formatInrCompactPaise(Math.abs(paise)).replace("₹", "₹")}
    </span>
  );
}

/** Money cell — compact, tabular, muted when zero. */
export function Money({ paise, bold }: { paise: number | null; bold?: boolean }) {
  if (paise === null) return <span className="text-ink-subtle">—</span>;
  return (
    <span
      className={`tabular-nums whitespace-nowrap ${bold ? "font-bold text-ink-strong" : "text-ink-soft"}`}
      style={{ fontSize: 13.5, opacity: paise === 0 ? 0.55 : 1 }}
    >
      {formatInrCompactPaise(paise)}
    </span>
  );
}

/** Empty state that says what to do next rather than just what's missing. */
export function EmptyPanel({
  title,
  children,
}: {
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-section border border-hairline bg-surface-card px-6 py-12 text-center">
      <p className="font-bold text-ink-strong" style={{ fontSize: 16 }}>
        {title}
      </p>
      {children && (
        <div className="mt-2 text-ink-muted mx-auto max-w-xl" style={{ fontSize: 14 }}>
          {children}
        </div>
      )}
    </div>
  );
}

export function PrimaryButton({
  children,
  onClick,
  disabled,
  type = "button",
  form,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  type?: "button" | "submit";
  form?: string;
}) {
  return (
    <button
      type={type}
      form={form}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-chip px-4 h-9 text-[13px] font-bold text-white whitespace-nowrap disabled:opacity-60"
      style={{ background: TARGETS_GRADIENT }}
    >
      {children}
    </button>
  );
}

export function GhostButton({
  children,
  onClick,
  disabled,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="inline-flex items-center gap-1.5 rounded-chip px-3 h-9 text-[13px] font-semibold text-ink-soft bg-surface-card border border-hairline whitespace-nowrap disabled:opacity-45"
    >
      {children}
    </button>
  );
}

/** Rupee input that shows what was typed and reports a plain number. */
export function RupeeInput({
  value,
  onChange,
  placeholder,
  disabled,
  width = 120,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  disabled?: boolean;
  width?: number;
}) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="text-ink-subtle" style={{ fontSize: 13 }}>
        ₹
      </span>
      <input
        value={value}
        inputMode="decimal"
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-chip px-2 h-9 bg-surface-soft border border-hairline outline-none text-[13.5px] text-ink-strong tabular-nums disabled:opacity-50"
        style={{ width }}
      />
    </span>
  );
}
