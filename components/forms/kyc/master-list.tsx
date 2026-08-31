"use client";

import { KYC_ACCENT, KYC_ACCENT_SOFT } from "./tokens";

/**
 * The pieces the four Client KYC lists share on top of the app's `DataTable`:
 * the tinted type pill in a cell, and the distinct-values helper behind every
 * filter chip.
 *
 * Client Master, Contact Master, Address Book and Bank Master each render the
 * same pill; four private copies would drift the moment one of them was
 * restyled. The table chrome itself is not duplicated here — that is
 * `components/admin/master/data-table.tsx`, unchanged and shared with the
 * Masters module.
 */

/** The tinted chip a row uses for its record type, and for "Primary". */
export function TypePill({ label, strong = false }: { label: string; strong?: boolean }) {
  return (
    <span
      className="inline-flex rounded-pill px-2 py-0.5 font-bold whitespace-nowrap"
      style={{
        fontSize: strong ? 9 : 10.5,
        letterSpacing: strong ? "0.06em" : undefined,
        textTransform: strong ? "uppercase" : undefined,
        background: KYC_ACCENT_SOFT,
        color: KYC_ACCENT,
      }}
    >
      {label}
    </span>
  );
}

/** Distinct non-empty values in a column, sorted, for its filter chip. */
export function distinctValues<T>(rows: T[], pick: (row: T) => string | null): string[] {
  const seen = new Set<string>();
  for (const r of rows) {
    const v = pick(r)?.trim();
    if (v) seen.add(v);
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}
