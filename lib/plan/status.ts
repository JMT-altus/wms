/**
 * The Project Plan status model — two flows, and the module's ONE permission.
 *
 * CLIENT-SAFE: pure, no `server-only`, no DB. The picker renders what
 * `canSetPlanStatus` allows and the server calls the SAME function before it
 * writes. The dropdown is a courtesy, not a control — a hand-rolled POST is
 * refused by the identical predicate that greyed out the option.
 *
 * The DB-backed half — resolving who the caller actually is relative to a row
 * — lives in `lib/plan/actor.ts`, which is `server-only`. The split matters:
 * the client sends an id and nothing else, so it is never asked who it is and
 * therefore cannot claim to be the owner.
 */

import type { PlanKind } from "@/lib/plan/levels";
import {
  PLAN_RESTRICTED_STATUSES,
  PLAN_WORKING_STATUSES,
  type PlanRestrictedStatus,
  type PlanRestrictedStatusChoice,
  type PlanWorkingStatus,
} from "@/db/enums";

export {
  PLAN_RESTRICTED_STATUSES,
  PLAN_WORKING_STATUSES,
  type PlanRestrictedStatus,
  type PlanRestrictedStatusChoice,
  type PlanWorkingStatus,
};

/** Anything the status picker may emit — either vocabulary. */
export type PlanStatusChoice = PlanWorkingStatus | PlanRestrictedStatusChoice;

/** Default for an untouched row. Not "unknown" — nobody has started. */
export const PLAN_DEFAULT_STATUS: PlanWorkingStatus = "not_started";

const WORKING_SET: ReadonlySet<string> = new Set(PLAN_WORKING_STATUSES);
const RESTRICTED_SET: ReadonlySet<string> = new Set(PLAN_RESTRICTED_STATUSES);

export function isWorkingStatus(v: string): v is PlanWorkingStatus {
  return WORKING_SET.has(v);
}

export function isRestrictedStatus(v: string): v is PlanRestrictedStatusChoice {
  return RESTRICTED_SET.has(v);
}

export function isPlanStatus(v: string): v is PlanStatusChoice {
  return WORKING_SET.has(v) || RESTRICTED_SET.has(v);
}

/**
 * Labels for both vocabularies.
 *
 * `dont_know` reads "Not Read" — the same word the task module's doer picker
 * uses, because a project and the actions under it must never be described in
 * two different languages.
 */
export const PLAN_STATUS_LABEL: Record<PlanStatusChoice, string> = {
  dont_know: "Not Read",
  not_started: "Not Started",
  initiated: "Initiated",
  follow_up: "Follow Up",
  need_info: "Need Info",
  done: "Done",
  abandoned: "Abandoned",
  not_approved: "Not Approved",
  approved: "Approved",
  on_hold: "On Hold",
  cancelled: "Cancelled",
  archived: "Archived",
};

/** Chip tone per status — the working ramp, then the verdict ramp. */
export const PLAN_STATUS_TONE: Record<PlanStatusChoice, string> = {
  dont_know: "#94A3B8",
  not_started: "#64748B",
  initiated: "#0891B2",
  follow_up: "#F59E0B",
  need_info: "#7C3AED",
  done: "#16A34A",
  // Dark and red-ish rather than another grey: `cancelled` and `archived`
  // already hold the two greys in this menu, and three neutrals side by side
  // are three chips nobody can tell apart at a glance.
  abandoned: "#7F1D1D",
  not_approved: "#DC2626",
  approved: "#15803D",
  on_hold: "#B45309",
  cancelled: "#78716C",
  archived: "#57534E",
};

export function planStatusLabel(v: string | null | undefined): string {
  if (!v) return PLAN_STATUS_LABEL[PLAN_DEFAULT_STATUS];
  return isPlanStatus(v) ? PLAN_STATUS_LABEL[v] : v;
}

export function planStatusTone(v: string | null | undefined): string {
  if (!v) return PLAN_STATUS_TONE[PLAN_DEFAULT_STATUS];
  return isPlanStatus(v) ? PLAN_STATUS_TONE[v] : PLAN_STATUS_TONE.not_started;
}

/* ── Who may set what ────────────────────────────────────────────────────── */

/**
 * The caller's relationship to ONE row, as the server resolved it.
 *
 * Every flag is computed server-side on every write (see `actorFor`). Nothing
 * here is ever taken from the browser.
 */
export interface PlanActor {
  id: string;
  isAdmin: boolean;
  /** Owner of this row, or of the project it sits under. */
  isOwner: boolean;
  /** Doer of this row's linked task. */
  isDoer: boolean;
  /** The doer's or owner's supervisor, transitively. */
  isSupervisor: boolean;
}

export type PlanStatusVerdict = { ok: true } | { ok: false; reason: string };

/**
 * The module's ONE permission rule.
 *
 * A WORKING status is a progress report, so the people doing and overseeing
 * the work may file one: admin, the owner, the doer, or their supervisor.
 *
 * A RESTRICTED verdict is an authority decision, so it is admin or the project
 * owner only — NOT the doer who did the work, and not their supervisor. A doer
 * marking their own work "approved" has to be impossible in the API, not
 * merely absent from the dropdown.
 *
 * Returns a REASON rather than a bare false, so the action can say why instead
 * of a flat "Forbidden".
 */
export function canSetPlanStatus(
  actor: PlanActor,
  next: string,
  /**
   * The row's level. A PROJECT is held to the stricter rule below; omitted,
   * the row is treated as anything-but-a-project, which is the looser case.
   */
  kind?: PlanKind,
): PlanStatusVerdict {
  if (!isPlanStatus(next)) {
    return { ok: false, reason: `"${next}" is not a status this module knows.` };
  }

  if (isRestrictedStatus(next)) {
    if (actor.isAdmin || actor.isOwner) return { ok: true };
    if (actor.isDoer) {
      return {
        ok: false,
        reason:
          "Approving, holding or cancelling work is the owner's call, not the doer's. Ask the project owner or an admin.",
      };
    }
    return {
      ok: false,
      reason:
        "Only an admin or the project owner can approve, hold, cancel or archive this.",
    };
  }

  // A PROJECT's status is the exception, and it goes with the verdicts rather
  // than the reports: it is a statement about the whole plan — every milestone,
  // result and action under it — not about a piece of work somebody is doing.
  // A project has no doer of its own either, so the only path this closes is
  // the supervisor's.
  if (kind === "project") {
    if (actor.isAdmin || actor.isOwner) return { ok: true };
    return {
      ok: false,
      reason:
        "A project's status is the owner's to set. Ask the project owner or an admin.",
    };
  }

  if (actor.isAdmin || actor.isOwner || actor.isDoer || actor.isSupervisor) {
    return { ok: true };
  }
  return {
    ok: false,
    reason:
      "You're not on this work. Only its owner, its doer, their supervisor or an admin can report progress on it.",
  };
}

/** The statuses this actor may actually pick, for rendering the menu. */
export function allowedPlanStatuses(
  actor: PlanActor,
  kind?: PlanKind,
): PlanStatusChoice[] {
  return [...PLAN_WORKING_STATUSES, ...PLAN_RESTRICTED_STATUSES].filter(
    (s) => canSetPlanStatus(actor, s, kind).ok,
  );
}

/* ── What the row actually shows ─────────────────────────────────────────── */

/**
 * A restricted verdict OUTRANKS a working status FOR DISPLAY: archived, then
 * approval, then status, then the default.
 *
 * A cancelled project is cancelled whatever its last progress report said —
 * but the report itself is untouched underneath, so "approved" never erases
 * the fact that the work was at Follow Up when the verdict landed.
 */
export function effectivePlanStatus(
  status: string | null | undefined,
  approval: string | null | undefined,
  isArchived?: boolean | null,
): PlanStatusChoice {
  if (isArchived) return "archived";
  if (approval && isRestrictedStatus(approval)) return approval;
  if (status && isWorkingStatus(status)) return status;
  return PLAN_DEFAULT_STATUS;
}

/**
 * True when a verdict is standing on this row.
 *
 * The kanban reads this to refuse a drag: moving a card between WORKING
 * columns while a verdict outranks them would write a status nobody would
 * then see.
 */
export function hasStandingVerdict(
  approval: string | null | undefined,
  isArchived?: boolean | null,
): boolean {
  return Boolean(isArchived) || Boolean(approval && isRestrictedStatus(approval));
}

/** The verdict as it should be stored — `archived` is a boolean, not a string. */
export function verdictColumnValue(
  next: PlanRestrictedStatusChoice,
): PlanRestrictedStatus | null {
  return next === "archived" ? null : next;
}
