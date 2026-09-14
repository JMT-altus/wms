/**
 * The Project Plan level model and numbering engine.
 *
 * CLIENT-SAFE by design — no `server-only`, no DB import, no React. The
 * browser derives every reference number as rows are added, moved and deleted,
 * and the server re-uses the identical predicates to validate a parent/child
 * pair before it writes. One copy of the rules, so the screen and the writes
 * cannot disagree.
 *
 * Nothing in here is ever stored. A ref, a full ref and a day count are all
 * display artefacts of `parent_id` plus sibling order; the moment one is
 * written to a column it starts drifting from the tree it describes.
 */

/** The six levels, outermost first. Index is the depth. */
export const PLAN_KINDS = [
  "project",
  "milestone",
  "result",
  "action",
  "sub_action",
  "sub_sub_action",
] as const;

export type PlanKind = (typeof PLAN_KINDS)[number];

const PLAN_KIND_SET: ReadonlySet<string> = new Set(PLAN_KINDS);

/** Narrowing guard for a `kind` read off a row or a URL. */
export function isPlanKind(value: string | null | undefined): value is PlanKind {
  return typeof value === "string" && PLAN_KIND_SET.has(value);
}

export const KIND_DEPTH: Record<PlanKind, number> = {
  project: 0,
  milestone: 1,
  result: 2,
  action: 3,
  sub_action: 4,
  sub_sub_action: 5,
};

export const KIND_LABEL: Record<PlanKind, string> = {
  project: "Project",
  milestone: "Milestone",
  result: "Result",
  action: "Action",
  sub_action: "Sub-Action",
  sub_sub_action: "Sub-Sub-Action",
};

/** Plural, for the "0 out of 3 milestones" line and the register headers. */
export const KIND_LABEL_PLURAL: Record<PlanKind, string> = {
  project: "Projects",
  milestone: "Milestones",
  result: "Results",
  action: "Actions",
  sub_action: "Sub-Actions",
  sub_sub_action: "Sub-Sub-Actions",
};

/** What a row of this kind may contain. `null` at the bottom of the tree. */
export const CHILD_KIND: Record<PlanKind, PlanKind | null> = {
  project: "milestone",
  milestone: "result",
  result: "action",
  action: "sub_action",
  sub_action: "sub_sub_action",
  sub_sub_action: null,
};

/** What a row of this kind must hang off. `null` for a root. */
export const PARENT_KIND: Record<PlanKind, PlanKind | null> = {
  project: null,
  milestone: "project",
  result: "milestone",
  action: "result",
  sub_action: "action",
  sub_sub_action: "sub_action",
};

/* ── The holding rows ────────────────────────────────────────────────────── */

/**
 * Where work goes when nobody has said where it goes yet.
 *
 * The new-task form asks which project a task belongs to and lets you stop
 * there — people know the project long before anyone has decided which
 * milestone the work serves. But the levels are a strict chain, and a task
 * parented straight onto a Project is a row every rollup quietly disagrees
 * about. So the unanswered questions become real rows under these names.
 *
 * They are ordinary rows. Rename one and it stops being a holding pen; move
 * the work out and it is an empty milestone like any other. Nothing keys off
 * the name except the find-or-create that avoids making a second one.
 *
 * Here rather than beside the action that writes them, because this file is
 * client-safe and the form needs to SAY what will happen before it happens.
 */
export const UNCLASSIFIED_MILESTONE = "Unclassified Milestone";
export const UNCLASSIFIED_RESULT = "Unclassified Result";

/* ── The three predicates, deliberately NOT the same set ─────────────────── */

/**
 * The rows that carry real work and report their status, priority and notes
 * FROM their linked task rather than from the plan row.
 */
export const EXECUTABLE_KINDS = [
  "action",
  "sub_action",
  "sub_sub_action",
] as const satisfies readonly PlanKind[];

/**
 * The rows that get a `tasks` record — THE THREE EXECUTABLES, and only those.
 *
 * A Result used to be in this list, so that people who put an owner and a
 * target date on one would find it in the task list. The cost was a duplicate
 * nobody wanted: a Result and the Action under it are the same piece of work
 * described at two levels, and giving both a task put both in the list. One
 * scheduled Action, one row.
 *
 * A Result stays a CONTAINER (see `isExecutable`) — "0 out of 3 actions" is
 * only trustworthy while it is derived from the work underneath rather than
 * self-reported — and it keeps its own subject, schedule and dates
 * (`hasSchedule`). What it no longer has is a second copy of its child's work
 * on the task list.
 */
export const TASK_KINDS = EXECUTABLE_KINDS;

/**
 * The rows that carry a start, an end and a duration of their own — everything
 * except Project and Milestone.
 *
 * Those two are dated BY THE WORK UNDERNEATH THEM: a project runs from its
 * first action to its last, and a stored pair of dates on the container
 * disagrees with that the moment anything below it moves. One table, three
 * surfaces — the create dialog hides its Schedule block, the register drops
 * Start/End/Duration, the edit dialog drops the same fields.
 */
export const SCHEDULED_KINDS = [
  "result",
  ...EXECUTABLE_KINDS,
] as const satisfies readonly PlanKind[];

const EXECUTABLE_SET: ReadonlySet<string> = new Set(EXECUTABLE_KINDS);
const TASK_SET: ReadonlySet<string> = new Set(TASK_KINDS);
const SCHEDULED_SET: ReadonlySet<string> = new Set(SCHEDULED_KINDS);

/** Does this row report its status from a linked task rather than the node? */
export function isExecutable(kind: string): boolean {
  return EXECUTABLE_SET.has(kind);
}

/** Does this row get a `tasks` record at all? Result counts; a Milestone does not. */
export function hasTask(kind: string): boolean {
  return TASK_SET.has(kind);
}

/** Does this row carry its own start / end / duration? */
export function hasSchedule(kind: string): boolean {
  return SCHEDULED_SET.has(kind);
}

/** The inverse of `isExecutable` — Project, Milestone, Result. */
export function isContainer(kind: string): boolean {
  return isPlanKind(kind) && !isExecutable(kind);
}

/** Is `child` a legal direct child of `parent`? Both directions checked. */
export function isValidChild(parent: PlanKind, child: PlanKind): boolean {
  return CHILD_KIND[parent] === child && PARENT_KIND[child] === parent;
}

/* ── Reference numbering — derived, never stored ─────────────────────────── */

/**
 * Spreadsheet-style letters, 1-based: 1→A, 26→Z, 27→AA, 28→AB.
 *
 * Guards `n < 1` rather than looping: a bad index arriving from a corrupted
 * tree must return something harmless, not hang the render.
 */
export function toLetters(n: number): string {
  if (!Number.isFinite(n) || n < 1) return "";
  let out = "";
  let value = Math.floor(n);
  while (value > 0) {
    const rem = (value - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    value = Math.floor((value - 1) / 26);
  }
  return out;
}

const ROMAN: ReadonlyArray<readonly [number, string]> = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"],
  [100, "C"], [90, "XC"], [50, "L"], [40, "XL"],
  [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

/** 1→I, 4→IV, 2026→MMXXVI. Same `n < 1` guard, same reason. */
export function toRoman(n: number): string {
  if (!Number.isFinite(n) || n < 1) return "";
  let value = Math.floor(n);
  let out = "";
  for (const [num, sym] of ROMAN) {
    while (value >= num) {
      out += sym;
      value -= num;
    }
  }
  return out;
}

/**
 * Strip a ref's letter prefix to get at its ordinal path: "A3" → "3",
 * "SA3.1" → "3.1", "RD" → "D".
 *
 * This is what lets the deep levels APPEND to their parent's ref instead of
 * recomputing a path from the root — a renumber high in the tree then flows
 * all the way down for free.
 *
 * Note the direction: this reads a ref that was just derived from the tree in
 * the same pass. It is NOT a way to find a parent. Nothing may ever parse a
 * ref to discover a relationship; `parent_id` is the only relationship there is.
 */
function ordinalPart(ref: string): string {
  return ref.replace(/^[A-Za-z]+/, "");
}

/**
 * The short label a row shows, from its 1-based position among its siblings
 * OF THE SAME KIND.
 *
 *   Project        P1, P2, P3
 *   Milestone      M1, M2, M3
 *   Result         RA, RB … RZ, RAA   (spreadsheet letters)
 *   Action         A1, A2
 *   Sub-Action     SA3.1, SA3.2       (parent's ordinals, then this one)
 *   Sub-Sub-Action SSA3.1.1
 *
 * Falls back to a bare ordinal when there is no parent ref — a row whose
 * ancestor was archived out from under it still needs to render something.
 */
export function refFor(
  kind: PlanKind,
  index1: number,
  parentRef?: string | null,
): string {
  const n = Number.isFinite(index1) && index1 >= 1 ? Math.floor(index1) : 1;
  switch (kind) {
    case "project":
      return `P${n}`;
    case "milestone":
      return `M${n}`;
    case "result":
      return `R${toLetters(n)}`;
    case "action":
      return `A${n}`;
    case "sub_action": {
      const base = parentRef ? ordinalPart(parentRef) : "";
      return base ? `SA${base}.${n}` : `SA${n}`;
    }
    case "sub_sub_action": {
      const base = parentRef ? ordinalPart(parentRef) : "";
      return base ? `SSA${base}.${n}` : `SSA${n}`;
    }
  }
}

/**
 * The traceability path — every ancestor concatenated: `P3M3RDA5SA1`.
 *
 * Built the same way as `refFor`, by appending this row's own segment to the
 * parent's full ref. Unique across the plan and quotable in an email. Show it
 * in a detail panel, a row tooltip and the CSV export — NEVER as a table
 * column: it gets long fast and a column of these strings is unreadable.
 */
export function fullRefFor(
  kind: PlanKind,
  index1: number,
  parentFullRef?: string | null,
): string {
  const n = Number.isFinite(index1) && index1 >= 1 ? Math.floor(index1) : 1;
  const segment =
    kind === "project" ? `P${n}`
    : kind === "milestone" ? `M${n}`
    : kind === "result" ? `R${toLetters(n)}`
    : kind === "action" ? `A${n}`
    : kind === "sub_action" ? `SA${n}`
    : `SSA${n}`;
  return parentFullRef ? `${parentFullRef}${segment}` : segment;
}

/* ── Duration ────────────────────────────────────────────────────────────── */

/**
 * "2h 30m" / "2 h 30 m" / "2:30" / "90" / "1.5h" → whole minutes.
 *
 * Blank AND unreadable both return null. A bad string must CLEAR the field,
 * never silently store a wrong number — an estimate that quietly became 2
 * minutes because someone typed "2 hrs" is worse than an empty one.
 */
export function parseDuration(input: string | null | undefined): number | null {
  if (input == null) return null;
  const raw = String(input).trim().toLowerCase();
  if (raw === "") return null;

  // "2:30" — h:mm.
  const clock = /^(\d{1,4}):([0-5]?\d)$/.exec(raw);
  if (clock) {
    return Number(clock[1]) * 60 + Number(clock[2]);
  }

  // "2h 30m", "2h", "30m", "1.5h", "90m" — units in either order, spaces free.
  const unit = /^(?:(\d+(?:\.\d+)?)\s*h(?:ours?|rs?)?)?\s*(?:(\d+(?:\.\d+)?)\s*m(?:in(?:ute)?s?)?)?$/.exec(raw);
  if (unit && (unit[1] !== undefined || unit[2] !== undefined)) {
    const hours = unit[1] ? Number(unit[1]) : 0;
    const mins = unit[2] ? Number(unit[2]) : 0;
    const total = Math.round(hours * 60 + mins);
    return Number.isFinite(total) && total >= 0 ? total : null;
  }

  // A bare number is minutes — the same unit the column stores.
  if (/^\d+(?:\.\d+)?$/.test(raw)) {
    const total = Math.round(Number(raw));
    return Number.isFinite(total) && total >= 0 ? total : null;
  }

  return null;
}

/** 150 → "2h 30m", 45 → "45m", 120 → "2h". Null / negative → "". */
export function formatDuration(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes) || minutes < 0) return "";
  const total = Math.round(minutes);
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/* ── Dates ───────────────────────────────────────────────────────────────── */

/**
 * `YYYY-MM-DD` from LOCAL getters.
 *
 * `toISOString().slice(0,10)` is the bug this exists to avoid: it converts to
 * UTC first, so 2026-06-12 23:00 in IST comes back as the 12th but 2026-06-12
 * 00:30 comes back as the 11th.
 */
export function toYmd(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "HH:MM", local. */
export function toHm(d: Date | null | undefined): string {
  if (!d || Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * Build a LOCAL Date from a `YYYY-MM-DD` and an optional `HH:MM`.
 * Null with no date — a time on its own is not a moment.
 */
export function combineDateTime(
  ymd: string | null | undefined,
  hm?: string | null,
): Date | null {
  if (!ymd) return null;
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd.trim());
  if (!dm) return null;
  let hours = 0;
  let mins = 0;
  if (hm) {
    const tm = /^(\d{1,2}):(\d{2})$/.exec(hm.trim());
    if (tm) {
      hours = Number(tm[1]);
      mins = Number(tm[2]);
    }
  }
  const d = new Date(
    Number(dm[1]),
    Number(dm[2]) - 1,
    Number(dm[3]),
    hours,
    mins,
    0,
    0,
  );
  return Number.isNaN(d.getTime()) ? null : d;
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * "12-Jun-2026".
 *
 * A bare `YYYY-MM-DD` is read as a LOCAL day: `new Date("2026-06-12")` is UTC
 * midnight, which renders as the 11th anywhere west of Greenwich. The plan
 * carries plain dates, so this parses them by hand rather than handing them
 * to the Date constructor.
 */
export function formatPlanDate(value: Date | string | null | undefined): string {
  if (!value) return "";
  let d: Date | null;
  if (typeof value === "string") {
    d = combineDateTime(value.slice(0, 10));
    if (!d) {
      const parsed = new Date(value);
      d = Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  } else {
    d = Number.isNaN(value.getTime()) ? null : value;
  }
  if (!d) return "";
  return `${String(d.getDate()).padStart(2, "0")}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

/**
 * Whole days from start to end, INCLUSIVE OF BOTH ENDS — same-day is 1 day,
 * not 0.
 *
 * Compared on local calendar days rather than by subtracting instants, so
 * 18:00 on the 1st → 09:00 on the 3rd is 3 days and not "2.6 rounded". Null
 * unless both ends are known: a range with one end open has no length.
 */
export function durationDays(
  start: Date | string | null | undefined,
  end: Date | string | null | undefined,
): number | null {
  const s = toLocalMidnight(start);
  const e = toLocalMidnight(end);
  if (!s || !e) return null;
  const ms = e.getTime() - s.getTime();
  const days = Math.round(ms / 86_400_000) + 1;
  return days;
}

function toLocalMidnight(value: Date | string | null | undefined): Date | null {
  if (!value) return null;
  if (typeof value === "string") {
    const d = combineDateTime(value.slice(0, 10));
    if (d) return d;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  }
  if (Number.isNaN(value.getTime())) return null;
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

/* ── Level typography ────────────────────────────────────────────────────── */

export interface LevelStyle {
  /** px */
  size: number;
  weight: number;
  italic: boolean;
  /** UPPERCASE via CSS `text-transform`, never a rewrite of the stored name. */
  caps: boolean;
}

/**
 * How each level is SET, in one table imported by every surface that draws a
 * plan row — the hierarchy table, the kanban card, the tree view, the pickers
 * — so the hierarchy reads identically everywhere.
 *
 * The STEPS between levels are the design; the absolute sizes are not. If the
 * column moves, move all six together — which is what happened here: every
 * level went up one point with the rest of the module, and the 14/14/12/12/11
 * /10 ramp became 15/15/13/13/12/11 with the same shape.
 *
 * The bottom four then went up 2pt again — 15/15/15/15/14/13 — because the
 * deep levels were the ones being read and 11px was too small to scan. The
 * ramp is flatter now: Result and Action match Milestone in SIZE and are told
 * apart by weight, case and italics instead, which the levels already carried.
 *
 * Caps is a CSS `text-transform`, never a rewrite: the stored name keeps the
 * case its author typed, so search, the edit box and the CSV export still show
 * "AICL WMS" as written rather than a shouted copy of it.
 */
export const LEVEL_STYLE: Record<PlanKind, LevelStyle> = {
  project:        { size: 15, weight: 700, italic: true,  caps: true },
  milestone:      { size: 15, weight: 700, italic: false, caps: true },
  result:         { size: 15, weight: 400, italic: true,  caps: false },
  action:         { size: 15, weight: 400, italic: false, caps: false },
  sub_action:     { size: 14, weight: 400, italic: true,  caps: false },
  sub_sub_action: { size: 13, weight: 400, italic: true,  caps: false },
};

/** The same table as inline style props, for a name cell. */
export function levelStyleProps(kind: PlanKind): {
  fontSize: number;
  fontWeight: number;
  fontStyle: "italic" | "normal";
  textTransform: "uppercase" | "none";
} {
  const s = LEVEL_STYLE[kind];
  return {
    fontSize: s.size,
    fontWeight: s.weight,
    fontStyle: s.italic ? "italic" : "normal",
    textTransform: s.caps ? "uppercase" : "none",
  };
}
