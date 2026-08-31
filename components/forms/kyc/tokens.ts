/**
 * The Client KYC area's accent, kept apart from `fields.tsx`.
 *
 * `fields.tsx` is a "use client" module; the Address Book is a server
 * component and importing the constants from there would drag the whole
 * control library into a read-only table's bundle. Both files read these.
 *
 * Indigo is not a new colour — `--color-indigo` / `--color-indigo-deep` are
 * already in globals.css alongside every other named hue.
 */
export const KYC_ACCENT = "var(--color-indigo-deep)";
export const KYC_ACCENT_SOFT = "color-mix(in srgb, var(--color-indigo) 8%, transparent)";
