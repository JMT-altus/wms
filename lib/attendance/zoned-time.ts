/**
 * Wall-clock → UTC conversion for attendance punches.
 *
 * The same algorithm as the private helper the admin punch actions use
 * (app/(app)/attendance/actions.ts): `${ymd} ${hhmm}` read as wall-clock time in
 * `tz`, returned as the UTC instant. Kept here, pure and importable, so the
 * attendance import and its tests can use it without pulling in a "use server"
 * file.
 */
export function zonedWallClockToUtc(ymd: string, hhmm: string, tz: string): Date {
  const dParts = ymd.split("-").map((n) => parseInt(n, 10));
  const tParts = hhmm.split(":").map((n) => parseInt(n, 10));
  const y = dParts[0] ?? 1970;
  const mo = dParts[1] ?? 1;
  const d = dParts[2] ?? 1;
  const h = tParts[0] ?? 0;
  const mi = tParts[1] ?? 0;
  // Treat the wall-clock fields as if they were UTC, then correct by the zone's
  // offset at that instant. Exact for zones without DST (India).
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, 0);
  return new Date(asUtc - tzOffsetMs(new Date(asUtc), tz));
}

/** Offset (ms) of `tz` from UTC at instant `at` (positive east of UTC). */
export function tzOffsetMs(at: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(at);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  let hour = get("hour");
  if (hour === 24) hour = 0; // some engines emit 24 for midnight
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), hour, get("minute"), get("second"));
  return asUtc - at.getTime();
}

/** An instant as HH:mm on the wall clock of `tz` (for showing an existing punch time). */
export function formatHHmmInTz(at: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(at);
  let h = Number(parts.find((p) => p.type === "hour")?.value);
  if (h === 24) h = 0;
  const m = Number(parts.find((p) => p.type === "minute")?.value);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
