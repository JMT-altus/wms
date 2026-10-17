/**
 * The dashboard's "Due dates" filter: open tasks grouped by how far their due
 * date is from today. Presentation-agnostic — the list, the URL value and the
 * date ranges the query applies all live here so they cannot drift apart.
 */
export const DUE_BUCKETS = [
  { value: "overdue", label: "Overdue" },
  { value: "o22", label: "22 or more days overdue" },
  { value: "o15", label: "15 to 21 days overdue" },
  { value: "o8", label: "8 to 14 days overdue" },
  { value: "o4", label: "4 to 7 days overdue" },
  { value: "o1", label: "1 to 3 days overdue" },
  { value: "today", label: "On Due Date (0 days)" },
  { value: "b1", label: "1 to 3 days before due date" },
  { value: "b4", label: "4 to 7 days before due date" },
  { value: "b8", label: "8 or more days before due date" },
] as const;

export type DueBucket = (typeof DUE_BUCKETS)[number]["value"];

const VALUES = new Set<string>(DUE_BUCKETS.map((b) => b.value));
export const isDueBucket = (v: unknown): v is DueBucket => typeof v === "string" && VALUES.has(v);

const DAY = 24 * 60 * 60 * 1000;
/** India Standard Time — the app's calendar (the same one the task due dates use). */
const IST_OFFSET_MS = 330 * 60 * 1000;

/** Start of the current day in IST, as an instant. */
export function startOfTodayIst(now: Date): Date {
  const shifted = new Date(now.getTime() + IST_OFFSET_MS);
  return new Date(
    Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate()) - IST_OFFSET_MS,
  );
}

/**
 * The range of due dates a bucket covers. `from` is inclusive, `to` exclusive;
 * either may be open. With S = the start of today, a task k days overdue has
 * S - due >= k days, so "k..m days overdue" is S-(m+1)d < due <= S-kd.
 */
export function dueBucketRange(
  bucket: DueBucket,
  now: Date,
): { from?: Date; to?: Date } {
  const S = startOfTodayIst(now).getTime();
  const at = (days: number) => new Date(S + days * DAY);
  switch (bucket) {
    case "overdue":
      return { to: at(0) };
    case "o22":
      return { to: at(-21) }; // due < S-21d  ⇔  22+ whole days overdue
    case "o15":
      return { from: at(-21), to: at(-14) };
    case "o8":
      return { from: at(-14), to: at(-7) };
    case "o4":
      return { from: at(-7), to: at(-3) };
    case "o1":
      return { from: at(-3), to: at(0) };
    case "today":
      return { from: at(0), to: at(1) };
    case "b1":
      return { from: at(1), to: at(4) };
    case "b4":
      return { from: at(4), to: at(8) };
    case "b8":
      return { from: at(8) };
  }
}
