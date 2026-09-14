import { describe, expect, it } from "vitest";
import { DOER_TASK_STATUSES } from "@/db/enums";
import {
  PLAN_DEFAULT_STATUS,
  PLAN_RESTRICTED_STATUSES,
  PLAN_STATUS_LABEL,
  PLAN_STATUS_TONE,
  PLAN_WORKING_STATUSES,
  allowedPlanStatuses,
  canSetPlanStatus,
  effectivePlanStatus,
  hasStandingVerdict,
  isRestrictedStatus,
  isWorkingStatus,
  planStatusLabel,
  verdictColumnValue,
  type PlanActor,
} from "@/lib/plan/status";

const nobody: PlanActor = {
  id: "u-nobody",
  isAdmin: false,
  isOwner: false,
  isDoer: false,
  isSupervisor: false,
};
const admin: PlanActor = { ...nobody, id: "u-admin", isAdmin: true };
const owner: PlanActor = { ...nobody, id: "u-owner", isOwner: true };
const doer: PlanActor = { ...nobody, id: "u-doer", isDoer: true };
const supervisor: PlanActor = { ...nobody, id: "u-sup", isSupervisor: true };

describe("the two vocabularies", () => {
  it("the working six ARE the task module's doer statuses", () => {
    // Deliberate: a project and the actions under it must never be described
    // in two different languages.
    expect([...PLAN_WORKING_STATUSES]).toEqual([...DOER_TASK_STATUSES]);
  });

  it("dont_know reads 'Not Read'", () => {
    expect(PLAN_STATUS_LABEL.dont_know).toBe("Not Read");
    expect(planStatusLabel("dont_know")).toBe("Not Read");
  });

  it("defaults an untouched row to Not Started", () => {
    expect(PLAN_DEFAULT_STATUS).toBe("not_started");
    expect(planStatusLabel(null)).toBe("Not Started");
    expect(planStatusLabel(undefined)).toBe("Not Started");
  });

  it("labels and tones cover every value in both lists", () => {
    for (const s of [...PLAN_WORKING_STATUSES, ...PLAN_RESTRICTED_STATUSES]) {
      expect(PLAN_STATUS_LABEL[s]).toBeTruthy();
      expect(PLAN_STATUS_TONE[s]).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it("keeps the two sets disjoint", () => {
    for (const s of PLAN_WORKING_STATUSES) {
      expect(isWorkingStatus(s)).toBe(true);
      expect(isRestrictedStatus(s)).toBe(false);
    }
    for (const s of PLAN_RESTRICTED_STATUSES) {
      expect(isRestrictedStatus(s)).toBe(true);
      expect(isWorkingStatus(s)).toBe(false);
    }
  });

  it("archived is a choice, but never a column value", () => {
    // It is stored as is_archived, not as a seventh string.
    expect(PLAN_RESTRICTED_STATUSES).toContain("archived");
    expect(verdictColumnValue("archived")).toBeNull();
    expect(verdictColumnValue("approved")).toBe("approved");
  });
});

describe("canSetPlanStatus — working status is a progress report", () => {
  it("lets admin, owner, doer and supervisor report progress", () => {
    for (const actor of [admin, owner, doer, supervisor]) {
      expect(canSetPlanStatus(actor, "follow_up").ok).toBe(true);
      expect(canSetPlanStatus(actor, "done").ok).toBe(true);
    }
  });

  it("refuses a stranger, with a reason", () => {
    const v = canSetPlanStatus(nobody, "done");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/not on this work/i);
  });
});

describe("canSetPlanStatus — a verdict is an authority decision", () => {
  it("allows admin and the project owner", () => {
    for (const s of PLAN_RESTRICTED_STATUSES) {
      expect(canSetPlanStatus(admin, s).ok).toBe(true);
      expect(canSetPlanStatus(owner, s).ok).toBe(true);
    }
  });

  it("REFUSES the doer approving their own work", () => {
    // This has to be impossible in the API, not merely absent from the
    // dropdown.
    const v = canSetPlanStatus(doer, "approved");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/owner's call, not the doer's/i);
  });

  it("refuses the doer's supervisor too", () => {
    // A supervisor may report progress but may not rule on it.
    expect(canSetPlanStatus(supervisor, "approved").ok).toBe(false);
    expect(canSetPlanStatus(supervisor, "cancelled").ok).toBe(false);
    expect(canSetPlanStatus(supervisor, "initiated").ok).toBe(true);
  });

  it("refuses a status this module has never heard of", () => {
    const v = canSetPlanStatus(admin, "transferred");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/not a status/i);
  });
});

describe("a PROJECT's status is owner-or-admin, even for a progress report", () => {
  it("allows the admin and the project owner", () => {
    expect(canSetPlanStatus(admin, "initiated", "project").ok).toBe(true);
    expect(canSetPlanStatus(owner, "done", "project").ok).toBe(true);
  });

  it("REFUSES a supervisor, who may report on every other level", () => {
    // The only path this actually closes: a project has no doer of its own.
    expect(canSetPlanStatus(supervisor, "initiated", "milestone").ok).toBe(true);
    const v = canSetPlanStatus(supervisor, "initiated", "project");
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.reason).toMatch(/owner's to set/i);
  });

  it("refuses a stranger and a doer alike", () => {
    expect(canSetPlanStatus(nobody, "initiated", "project").ok).toBe(false);
    expect(canSetPlanStatus(doer, "initiated", "project").ok).toBe(false);
  });

  it("leaves every other level on the progress-report rule", () => {
    for (const kind of ["milestone", "result", "action", "sub_action", "sub_sub_action"] as const) {
      expect(canSetPlanStatus(doer, "done", kind).ok).toBe(true);
      expect(canSetPlanStatus(supervisor, "done", kind).ok).toBe(true);
    }
  });

  it("still refuses a verdict from anyone but admin or owner, project or not", () => {
    expect(canSetPlanStatus(supervisor, "approved", "project").ok).toBe(false);
    expect(canSetPlanStatus(doer, "approved", "action").ok).toBe(false);
    expect(canSetPlanStatus(owner, "approved", "project").ok).toBe(true);
  });

  it("treats an omitted kind as the looser case", () => {
    // Callers that genuinely have no row in hand must not be silently
    // tightened — the server always passes the real kind.
    expect(canSetPlanStatus(supervisor, "initiated").ok).toBe(true);
  });
});

describe("allowedPlanStatuses", () => {
  it("gives an admin everything", () => {
    expect(allowedPlanStatuses(admin)).toHaveLength(
      PLAN_WORKING_STATUSES.length + PLAN_RESTRICTED_STATUSES.length,
    );
  });

  it("gives a doer the working six and nothing else", () => {
    expect(allowedPlanStatuses(doer)).toEqual([...PLAN_WORKING_STATUSES]);
  });

  it("offers a supervisor nothing at all on a project", () => {
    // Which is what makes the picker render a plain locked chip there.
    expect(allowedPlanStatuses(supervisor, "project")).toEqual([]);
    expect(allowedPlanStatuses(supervisor, "action")).toEqual([...PLAN_WORKING_STATUSES]);
  });

  it("gives a stranger nothing", () => {
    expect(allowedPlanStatuses(nobody)).toEqual([]);
  });
});

describe("effectivePlanStatus — the verdict outranks the report", () => {
  it("ranks archived over everything", () => {
    expect(effectivePlanStatus("done", "approved", true)).toBe("archived");
  });

  it("ranks a verdict over a working status", () => {
    // A cancelled project is cancelled whatever its last progress report said.
    expect(effectivePlanStatus("follow_up", "cancelled", false)).toBe("cancelled");
    expect(effectivePlanStatus("done", "not_approved", false)).toBe("not_approved");
  });

  it("falls through to the working status, then the default", () => {
    expect(effectivePlanStatus("initiated", null, false)).toBe("initiated");
    expect(effectivePlanStatus(null, null, false)).toBe("not_started");
    expect(effectivePlanStatus(undefined, undefined, undefined)).toBe("not_started");
  });

  it("ignores a value from the wrong vocabulary in either slot", () => {
    expect(effectivePlanStatus("approved", null, false)).toBe("not_started");
    expect(effectivePlanStatus("done", "follow_up", false)).toBe("done");
  });
});

describe("hasStandingVerdict", () => {
  it("is true for a verdict or an archive, false for a bare report", () => {
    // The kanban reads this to refuse a drag: moving a card between working
    // columns would write a status nobody would then see.
    expect(hasStandingVerdict("approved", false)).toBe(true);
    expect(hasStandingVerdict(null, true)).toBe(true);
    expect(hasStandingVerdict(null, false)).toBe(false);
    expect(hasStandingVerdict("follow_up", false)).toBe(false);
  });
});
