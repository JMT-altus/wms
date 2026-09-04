/**
 * Two-stage sign-off — the pure rules behind `tasks.approval_level`.
 *
 * The module keeps THREE independent axes and this file owns the third:
 *
 *   status          — the DOER's progress report ("what have I done?")
 *   approval_status — the MANAGER's verdict     ("is this acceptable?")
 *   approval_level  — how far that verdict has TRAVELLED
 *
 * The ladder is `none → manager → admin`:
 *
 *   none    nobody has ruled yet
 *   manager the doer's direct manager (or an admin) accepted the work
 *   admin   final sign-off, which ONLY a founder can give
 *
 * Collapsing the level into the verdict is the classic mistake — it makes
 * "approved" mean two different things depending on who pressed the button,
 * and there is then no way to ask "which approved tasks still need the
 * founder?" The whole point of the second stage is that the question has an
 * answer.
 *
 * Pure and client-safe: no DB, no `server-only`, no schema import, so the
 * detail page can hide the buttons it knows the server would reject using the
 * exact same function the server defends with.
 */

import type { ApprovalLevel, ApprovalStatus } from "@/db/enums";

/**
 * Who is asking. `isSuperAdmin` is this repo's founder concept
 * (lib/auth/super-admin.ts — a fixed email allow-list); `isDoersManager` is
 * the direct-manager relationship the caller resolves from the DB, matching
 * how `canApprove` in lib/auth/task-permissions.ts already takes it.
 */
export interface ApprovalActor {
  id: string;
  isAdmin: boolean;
  /** Founder. The ONLY person who can reach the `admin` stage. */
  isSuperAdmin: boolean;
  /** True when this actor is the direct manager of the task's doer. */
  isDoersManager: boolean;
}

/** The task fields the ladder needs. Nothing else is consulted. */
export interface ApprovalTaskShape {
  doerId: string | null;
  initiatorId: string;
  status: string;
  approvalStatus: ApprovalStatus | null;
  approvalLevel: ApprovalLevel;
}

/**
 * A stage someone can actually GRANT. `none` is a starting position, not
 * something anyone signs off, so it is excluded here — that keeps callers from
 * having to defend against a "granted level of none".
 */
export type GrantableStage = Exclude<ApprovalLevel, "none">;

/** Ladder order, so "has it got at least this far?" is a comparison. */
const LEVEL_RANK: Record<ApprovalLevel, number> = {
  none: 0,
  manager: 1,
  admin: 2,
};

export function approvalLevelRank(level: ApprovalLevel): number {
  return LEVEL_RANK[level];
}

/** True when `level` has reached `atLeast` on the ladder. */
export function hasReachedLevel(
  level: ApprovalLevel,
  atLeast: ApprovalLevel,
): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[atLeast];
}

/**
 * The stage this actor is capable of granting, ignoring the task entirely.
 *
 * A founder signs off at `admin`; a manager or a plain admin signs off at
 * `manager`. Returns null for someone who can never sign anything off.
 *
 * Note a founder is also an admin here — but they grant `admin`, not
 * `manager`, because the higher stage subsumes the lower one and asking the
 * founder to press Approve twice would be theatre.
 */
export function grantableStageFor(actor: ApprovalActor): GrantableStage | null {
  if (actor.isSuperAdmin) return "admin";
  if (actor.isAdmin || actor.isDoersManager) return "manager";
  return null;
}

/** The next stage after `level`, or null once the ladder is topped out. */
export function nextApprovalStage(level: ApprovalLevel): ApprovalLevel | null {
  if (level === "none") return "manager";
  if (level === "manager") return "admin";
  return null;
}

/**
 * Why a sign-off is not on offer. Returned instead of a bare false so the UI
 * can say the actual reason and the server can map it onto an error code
 * rather than a generic "forbidden".
 */
export type SignOffBlock =
  | "not-done" // the doer hasn't finished; there is nothing to rule on
  | "self" // you cannot sign off your own work
  | "already" // this stage (or a higher one) is already granted
  | "founder-only" // final sign-off is the founder's alone
  | "not-permitted"; // no manager / admin / founder relationship

export type SignOffDecision =
  | { allowed: true; stage: GrantableStage }
  | { allowed: false; reason: SignOffBlock };

/**
 * Can this actor advance this task's sign-off, and to which stage?
 *
 * The server calls this before writing and the detail page calls it to decide
 * whether to render the button at all — one function, so the two can never
 * drift into disagreeing about who may approve what.
 */
export function canSignOff(
  task: ApprovalTaskShape,
  actor: ApprovalActor,
): SignOffDecision {
  // Stage 1 rules on FINISHED work, so the doer has to have finished it. Once
  // the manager has ruled, `status` moves to the verdict value ("approved") —
  // which is still a legitimate place to stand while the founder signs off.
  const ruledOn = task.approvalStatus != null;
  if (task.status !== "done" && !ruledOn) {
    return { allowed: false, reason: "not-done" };
  }

  // Nobody signs off their own work — not even the founder. This is the one
  // rule the whole two-stage flow exists to protect.
  if (task.doerId != null && actor.id === task.doerId) {
    return { allowed: false, reason: "self" };
  }

  const stage = grantableStageFor(actor);
  if (stage == null) return { allowed: false, reason: "not-permitted" };

  // Already at or past what this actor can grant. A manager looking at a
  // manager-approved task has nothing left to add; only the founder does.
  if (hasReachedLevel(task.approvalLevel, stage)) {
    return {
      allowed: false,
      reason: stage === "admin" ? "already" : "founder-only",
    };
  }

  return { allowed: true, stage };
}

/**
 * The resulting `approval_level` after a decision lands.
 *
 * A REJECTION never advances the ladder: "not approved" is a verdict, not a
 * sign-off, and letting it tick the level up would leave a rejected task
 * looking manager-approved. It resets to `none` so the work can be redone and
 * re-submitted through the same two stages.
 */
export function levelAfterDecision(
  current: ApprovalLevel,
  decision: ApprovalStatus,
  stage: GrantableStage,
): ApprovalLevel {
  if (decision !== "approved") return "none";
  // Never go backwards: an admin-signed task stays admin-signed even if a
  // manager presses Approve afterwards.
  return LEVEL_RANK[stage] > LEVEL_RANK[current] ? stage : current;
}

/** Copy for the sign-off state, so no component inlines a string. */
export const SIGN_OFF_BLOCK_MESSAGES: Record<SignOffBlock, string> = {
  "not-done": "The doer hasn't marked this done yet.",
  self: "You can't sign off your own work.",
  already: "This task already has final sign-off.",
  "founder-only": "Manager approval is in. Final sign-off is the founder's.",
  "not-permitted": "You're not on this task's approval chain.",
};

/**
 * True when the task is approved by a manager but still waiting on the
 * founder — the state the "Awaiting final sign-off" filter and badge key off.
 */
export function isAwaitingFinalSignOff(task: ApprovalTaskShape): boolean {
  return task.approvalStatus === "approved" && task.approvalLevel === "manager";
}
