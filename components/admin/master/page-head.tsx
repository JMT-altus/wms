import type { ReactNode } from "react";

/**
 * Shared header for the master-data pages, matching the existing admin pages
 * (eyebrow · italic serif h1 · body-lg lede) so these five don't read as a
 * bolted-on section.
 */
export function MasterPageHead({
  eyebrow,
  title,
  lede,
  right,
}: {
  eyebrow: string;
  title: string;
  lede: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="mb-8 flex items-start justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        <div className="text-[10px] uppercase tracking-[0.18em] text-ink-subtle font-bold">
          {eyebrow}
        </div>
        <h1
          className="mt-1 text-ink-strong max-md:!text-[32px]"
          style={{
            fontFamily: "var(--font-serif)",
            fontStyle: "italic",
            fontWeight: 500,
            fontSize: 44,
            lineHeight: 1.05,
            letterSpacing: "-0.02em",
          }}
        >
          {title}
        </h1>
        <p className="text-body-lg text-ink-subtle mt-2 max-w-3xl tabular-nums">{lede}</p>
      </div>
      {right && <div className="shrink-0">{right}</div>}
    </header>
  );
}
