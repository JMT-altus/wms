import { describe, it, expect } from "vitest";
import {
  canSignOff,
  grantableStageFor,
  hasReachedLevel,
  isAwaitingFinalSignOff,
  levelAfterDecision,
  nextApprovalStage,
  type ApprovalActor,
  type ApprovalTaskShape,
} from "@/lib/tasks/approval-levels";

const DOER = "11111111-1111-1111-1111-111111111111";
const INITIATOR = "22222222-2222-2222-2222-222222222222";
const MANAGER = "33333333-3333-3333-3333-333333333333";
const FOUNDER = "44444444-4444-4444-4444-444444444444";
const STRANGER = "55555555-5555-5555-5555-555555555555";

const task = (over: Partial<ApprovalTaskShape> = {}): ApprovalTaskShape => ({
  doerId: DOER,
  initiatorId: INITIATOR,
  status: "done",
  approvalStatus: null,
  approvalLevel: "none",
  ...over,
});

const actor = (id: string, over: Partial<ApprovalActor> = {}): ApprovalActor => ({
  id,
  isAdmin: false,
  isSuperAdmin: false,
  isDoersManager: false,
  ...over,
});

const managerActor = actor(MANAGER, { isDoersManager: true });
const founderActor = actor(FOUNDER, { isAdmin: true, isSuperAdmin: true });
const adminActor = actor(INITIATOR, { isAdmin: true });

describe("the ladder", () => {
  it("runs none → manager → admin and stops", () => {
    expect(nextApprovalStage("none")).toBe("manager");
    expect(nextApprovalStage("manager")).toBe("admin");
    expect(nextApprovalStage("admin")).toBeNull();
  });

  it("compares stages by rank, not equality", () => {
    expect(hasReachedLevel("admin", "manager")).toBe(true);
    expect(hasReachedLevel("manager", "manager")).toBe(true);
    expect(hasReachedLevel("manager", "admin")).toBe(false);
    expect(hasReachedLevel("none", "manager")).toBe(false);
  });
});

describe("grantableStageFor", () => {
  it("gives the founder the admin stage, not the manager stage", () => {
    // The higher stage subsumes the lower one — making the founder press
    // Approve twice would be theatre.
    expect(grantableStageFor(founderActor)).toBe("admin");
  });

  it("gives a plain admin and a direct manager the manager stage", () => {
    expect(grantableStageFor(adminActor)).toBe("manager");
    expect(grantableStageFor(managerActor)).toBe("manager");
  });

  it("gives an unrelated employee nothing", () => {
    expect(grantableStageFor(actor(STRANGER))).toBeNull();
  });
});

describe("canSignOff", () => {
  it("refuses while the doer has not finished", () => {
    const d = canSignOff(task({ status: "initiated" }), managerActor);
    expect(d).toEqual({ allowed: false, reason: "not-done" });
  });

  it("lets the manager grant stage one on finished work", () => {
    expect(canSignOff(task(), managerActor)).toEqual({
      allowed: true,
      stage: "manager",
    });
  });

  it("refuses self-approval even for the founder", () => {
    const selfFounder = actor(DOER, { isAdmin: true, isSuperAdmin: true });
    expect(canSignOff(task(), selfFounder)).toEqual({
      allowed: false,
      reason: "self",
    });
  });

  it("tells a manager that stage two is the founder's alone", () => {
    const t = task({ approvalStatus: "approved", approvalLevel: "manager" });
    expect(canSignOff(t, managerActor)).toEqual({
      allowed: false,
      reason: "founder-only",
    });
  });

  it("lets the founder grant final sign-off after the manager", () => {
    const t = task({ approvalStatus: "approved", approvalLevel: "manager" });
    expect(canSignOff(t, founderActor)).toEqual({ allowed: true, stage: "admin" });
  });

  it("lets the founder sign off directly, skipping an absent manager stage", () => {
    expect(canSignOff(task(), founderActor)).toEqual({
      allowed: true,
      stage: "admin",
    });
  });

  it("has nothing left to offer once final sign-off is in", () => {
    const t = task({ approvalStatus: "approved", approvalLevel: "admin" });
    expect(canSignOff(t, founderActor)).toEqual({
      allowed: false,
      reason: "already",
    });
  });

  it("refuses an employee with no approval relationship", () => {
    expect(canSignOff(task(), actor(STRANGER))).toEqual({
      allowed: false,
      reason: "not-permitted",
    });
  });

  it("still allows stage two once status has moved off done", () => {
    // After a manager approves, `status` carries the verdict value — which is
    // a legitimate place to stand while the founder signs off.
    const t = task({
      status: "approved",
      approvalStatus: "approved",
      approvalLevel: "manager",
    });
    expect(canSignOff(t, founderActor)).toEqual({ allowed: true, stage: "admin" });
  });
});

describe("levelAfterDecision", () => {
  it("advances on approval", () => {
    expect(levelAfterDecision("none", "approved", "manager")).toBe("manager");
    expect(levelAfterDecision("manager", "approved", "admin")).toBe("admin");
  });

  it("resets to none on a rejection — a verdict is not a sign-off", () => {
    expect(levelAfterDecision("manager", "not_approved", "manager")).toBe("none");
    expect(levelAfterDecision("admin", "not_approved", "admin")).toBe("none");
  });

  it("never walks the ladder backwards", () => {
    expect(levelAfterDecision("admin", "approved", "manager")).toBe("admin");
  });

  it("treats cancelled and transferred as non-advancing too", () => {
    expect(levelAfterDecision("manager", "cancelled", "manager")).toBe("none");
    expect(levelAfterDecision("manager", "transferred", "admin")).toBe("none");
  });
});

describe("isAwaitingFinalSignOff", () => {
  it("is true only for manager-approved work", () => {
    expect(
      isAwaitingFinalSignOff(
        task({ approvalStatus: "approved", approvalLevel: "manager" }),
      ),
    ).toBe(true);
  });

  it("is false once the founder has signed and before the manager has", () => {
    expect(
      isAwaitingFinalSignOff(
        task({ approvalStatus: "approved", approvalLevel: "admin" }),
      ),
    ).toBe(false);
    expect(isAwaitingFinalSignOff(task())).toBe(false);
  });

  it("is false for a rejection sitting at manager level", () => {
    expect(
      isAwaitingFinalSignOff(
        task({ approvalStatus: "not_approved", approvalLevel: "manager" }),
      ),
    ).toBe(false);
  });
});
