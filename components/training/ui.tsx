import type { ReactNode } from "react";

/**
 * Shared chrome for the Training Centre. Server components — no state, no
 * client bundle. The module accent (teal) comes from lib/nav-modules.ts so the
 * hub tile, the nav pill and these headers all read as one module.
 */

export const TRAINING_ACCENT = "#0B7C8A";
export const TRAINING_ACCENT_SOFT = "#0EA5B7";

export function PageHead({
  eyebrow,
  title,
  sub,
  right,
}: {
  eyebrow: string;
  title: string;
  sub?: string;
  right?: ReactNode;
}) {
  return (
    <header className="mb-7 flex items-start justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        <span
          className="inline-flex items-center rounded-pill px-3 py-1"
          style={{
            background: `linear-gradient(135deg, ${TRAINING_ACCENT_SOFT}, ${TRAINING_ACCENT})`,
            color: "#fff",
            fontFamily: "var(--font-mono-display), ui-monospace, monospace",
            fontSize: 11.5,
            fontWeight: 800,
            letterSpacing: "0.16em",
          }}
        >
          {eyebrow}
        </span>
        <h1 className="mt-3 text-ink-strong">{title}</h1>
        {sub && (
          <p className="mt-2 text-ink-muted font-semibold" style={{ fontSize: 16.5 }}>
            {sub}
          </p>
        )}
      </div>
      {right && <div className="shrink-0 flex items-center gap-2.5 flex-wrap">{right}</div>}
    </header>
  );
}

export function Panel({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-section bg-surface-card p-6 max-md:p-4 ${className}`}
      style={{
        border: "1px solid var(--color-hairline)",
        boxShadow:
          "0 14px 32px -20px rgba(10, 108, 255, 0.16), 0 2px 6px -2px rgba(15, 23, 42, 0.06)",
      }}
    >
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "slate",
  icon,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "teal" | "blue" | "green" | "amber" | "purple" | "slate";
  icon?: ReactNode;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-chip bg-surface-card p-5"
      style={{
        border: "1px solid var(--color-hairline)",
        boxShadow: "0 10px 24px -18px rgba(15,23,42,0.28), 0 1px 2px rgba(15,23,42,0.04)",
      }}
    >
      <span
        aria-hidden
        className="pointer-events-none absolute right-0 top-0 h-24 w-24 rounded-full"
        style={{
          background: `radial-gradient(circle, color-mix(in srgb, var(--color-${tone}) 24%, transparent), transparent 70%)`,
          transform: "translate(30%, -30%)",
        }}
      />
      <div className="relative flex items-center justify-between gap-2">
        <span
          className="uppercase font-bold tracking-[0.10em] text-ink-subtle"
          style={{ fontSize: 11.5 }}
        >
          {label}
        </span>
        {icon && <span style={{ color: `var(--color-${tone}-deep)` }}>{icon}</span>}
      </div>
      <div
        className="relative mt-2.5 tabular-nums font-black text-ink-strong leading-none"
        style={{ fontFamily: "var(--font-display), system-ui, sans-serif", fontSize: 38 }}
      >
        {value}
      </div>
      {hint && (
        <p className="relative mt-2 text-ink-subtle font-semibold" style={{ fontSize: 12.5 }}>
          {hint}
        </p>
      )}
    </div>
  );
}

export function ProgressBar({
  pct,
  tone = "teal",
  height = 10,
}: {
  pct: number;
  tone?: string;
  height?: number;
}) {
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div
      className="w-full overflow-hidden rounded-full"
      style={{ height, background: "var(--color-surface-track)" }}
    >
      <span
        className="block h-full rounded-full"
        style={{
          width: `${clamped === 0 ? 0 : Math.max(clamped, 3)}%`,
          background: `linear-gradient(90deg, var(--color-${tone}), var(--color-${tone}-deep))`,
          transition: "width 600ms cubic-bezier(.2,.8,.2,1)",
        }}
      />
    </div>
  );
}

export function EmptyState({ title, sub }: { title: string; sub?: string }) {
  return (
    <div
      className="rounded-section px-8 py-14 text-center"
      style={{ border: "1px dashed var(--color-hairline-strong)" }}
    >
      <p className="text-ink-strong font-bold" style={{ fontSize: 18 }}>
        {title}
      </p>
      {sub && (
        <p className="mt-2 text-ink-muted" style={{ fontSize: 15 }}>
          {sub}
        </p>
      )}
    </div>
  );
}

/** Read-only star row. The interactive one lives in star-rating.tsx. */
export function Stars({ value, size = 16 }: { value: number | null; size?: number }) {
  if (value == null) return <span className="text-ink-subtle text-[13px]">Not rated yet</span>;
  return (
    <span className="inline-flex items-center gap-1" aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <svg key={i} width={size} height={size} viewBox="0 0 24 24" aria-hidden>
          <path
            d="M12 2.6l2.9 5.9 6.5.95-4.7 4.6 1.1 6.45L12 17.45 6.2 20.5l1.1-6.45L2.6 9.45l6.5-.95L12 2.6z"
            fill={i <= Math.round(value) ? "#f59e0b" : "rgba(15,23,42,0.14)"}
          />
        </svg>
      ))}
      <span className="ml-1 tabular-nums font-bold text-ink-soft" style={{ fontSize: 13 }}>
        {value.toFixed(1)}
      </span>
    </span>
  );
}

/** Small teal pill used for Induction / kind / status markers. */
export function Tag({
  children,
  tone = "teal",
}: {
  children: ReactNode;
  tone?: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-pill px-2.5 py-1 font-bold"
      style={{
        fontSize: 11.5,
        background: `color-mix(in srgb, var(--color-${tone}) 14%, transparent)`,
        color: `var(--color-${tone}-deep)`,
        border: `1px solid color-mix(in srgb, var(--color-${tone}) 30%, transparent)`,
      }}
    >
      {children}
    </span>
  );
}
