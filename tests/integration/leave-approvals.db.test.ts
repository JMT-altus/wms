import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The Leave Approvals workflow against a REAL (in-memory PGlite) Postgres built
// from db/schema.ts. Nothing here can reach a shared or production database.
//
// Access is the permission matrix: the three `leave.approvals.*` capabilities are
// granted and revoked through the real Field Permissions action (as a
// super-admin), resolved by the real resolver, and enforced by the real queries
// and actions. Only the session is mocked; super-admin status is mocked to a
// made-up test address so no real account appears here.
type Me = { id: string; email: string; isActive: boolean; isAdmin: boolean; name: string; departmentId: string | null };
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | Me, notify: vi.fn() };
});
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn() }));
vi.mock("@/lib/db", () => ({
  get db() {
    if (!h.db) throw new Error("test database not ready");
    return h.db;
  },
}));
vi.mock("@/lib/auth/current", () => ({
  getCurrentEmployee: async () => h.me,
  requireUser: async () => {
    if (!h.me) throw new Error("not signed in");
    return h.me;
  },
  requireAdmin: async () => {
    if (!h.me?.isActive || !h.me.isAdmin) throw new Error("Forbidden");
    return h.me;
  },
}));
vi.mock("@/lib/auth/super-admin", () => ({ isSuperAdmin: (e: string | null | undefined) => e === "super@example.test" }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/notifications/dispatch", () => ({ notify: (...a: unknown[]) => h.notify(...a) }));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";

const VIEW = "leave.approvals.view";
const DECIDE = "leave.approvals.decide";
const OVERRIDE = "leave.approvals.override";

let pg: Awaited<ReturnType<typeof createTestDb>>["pg"];
let actions: typeof import("@/app/(app)/attendance/leave/actions");
let q: typeof import("@/lib/queries/leave");
let cap: typeof import("@/lib/auth/capability");
let matrix: typeof import("@/app/(masters)/master-setup/actions");
const P: Record<string, Me> = {};

const emp = async (key: string, email: string, isAdmin = false) => {
  const id = (
    await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', $3) returning id`, [key, email, isAdmin])
  ).rows[0]!.id;
  P[key] = { id, email, isActive: true, isAdmin, name: key, departmentId: null };
};
const as = (key: string | null) => {
  h.me = key ? P[key]! : null;
};
/** An administrator (a super-admin) grants or revokes a capability for one person, through the real action. */
const grant = async (key: string, to: string, value: boolean | null) => {
  const before = h.me;
  as("Super");
  const r = await matrix.setFieldPermission(key, "employee", P[to]!.id, value);
  h.me = before;
  expect(r).toEqual({ ok: true });
};
const status = async (id: string) => (await pg.query<{ status: string }>(`select status from leave_requests where id = $1`, [id])).rows[0]!.status;
const approverOf = async (id: string) => (await pg.query<{ approver_id: string | null }>(`select approver_id from leave_requests where id=$1`, [id])).rows[0]!.approver_id;

/**
 * File a request as `key`. With no `routedTo` it goes through the real
 * `applyForLeave` (routed to the configured default); with one it is inserted
 * directly (null = routed to nobody in particular).
 */
const file = async (key: string, start: string, end: string, routedTo?: string | null) => {
  const before = h.me;
  as(key);
  try {
    if (routedTo !== undefined) {
      return (
        await pg.query<{ id: string }>(
          `insert into leave_requests (employee_id, approver_id, leave_type, start_date, end_date, days, reason) values ($1, $2, 'planned', $3, $4, 1, 'x') returning id`,
          [P[key]!.id, routedTo ? P[routedTo]!.id : null, start, end],
        )
      ).rows[0]!.id;
    }
    const r = await actions.applyForLeave({ startDate: start, endDate: end, leaveType: "planned", reason: "Family function" });
    if (!r.ok) throw new Error(r.error);
    return r.id;
  } finally {
    h.me = before;
  }
};
/** The queue the page would show this person (null = the page is a 404 for them). */
const queue = async (key: string) => {
  as(key);
  const caps = await cap.getLeaveCapabilityProofs();
  return caps.view ? q.listPendingApprovalsFor(caps.view, caps.override) : null;
};
const names = (rows: { employeeName: string }[] | null) => rows?.map((r) => r.employeeName).sort();

beforeAll(async () => {
  const made = await createTestDb({
    employees: schema.employees,
    departments: schema.departments,
    employeeDepartments: schema.employeeDepartments,
    fieldPermissionGrants: schema.fieldPermissionGrants,
    settingsEvents: schema.settingsEvents,
    leaveRequests: schema.leaveRequests,
    leaveApprovers: schema.leaveApprovers,
    employeeEvents: schema.employeeEvents,
  });
  pg = made.pg;
  h.db = made.db;
  await emp("Super", "super@example.test", true);
  await emp("Admin", "admin@example.test", true); // an admin with NO leave grants
  await emp("Approver", "approver@example.test"); // the default approver: view + decide
  await emp("OtherApprover", "other.approver@example.test"); // a second approver: view + decide
  await emp("ViewOnly", "viewonly@example.test"); // view only
  await emp("DecideOnly", "decideonly@example.test"); // decide without view
  await emp("Overrider", "overrider@example.test"); // view + decide + override
  await emp("Asha", "asha@example.test");
  await emp("Ravi", "ravi@example.test");
  await emp("Staff", "staff@example.test"); // ordinary employee, no grants
  actions = await import("@/app/(app)/attendance/leave/actions");
  q = await import("@/lib/queries/leave");
  cap = await import("@/lib/auth/capability");
  matrix = await import("@/app/(masters)/master-setup/actions");
}, 180_000);
afterAll(async () => {
  await pg?.close();
});
beforeEach(async () => {
  for (const k of Object.keys(P)) P[k]!.isActive = true;
  await pg.exec(`delete from leave_requests; delete from leave_approvers; delete from employee_events; delete from field_permission_grants; delete from settings_events;`);
  h.notify.mockReset().mockResolvedValue(undefined);
  // Routing: an admin picks the default approver (the Leave Approvers card).
  as("Admin");
  expect(await actions.setLeaveApprover({ employeeId: P.Approver!.id, action: "make_default" })).toEqual({ ok: true });
  expect(await actions.setLeaveApprover({ employeeId: P.OtherApprover!.id, action: "add" })).toEqual({ ok: true });
  // Permissions: a super-admin grants them in Field Permissions (nothing is automatic).
  for (const k of [VIEW, DECIDE]) await grant(k, "Approver", true);
  for (const k of [VIEW, DECIDE]) await grant(k, "OtherApprover", true);
  await grant(VIEW, "ViewOnly", true);
  await grant(DECIDE, "DecideOnly", true);
  for (const k of [VIEW, DECIDE, OVERRIDE]) await grant(k, "Overrider", true);
});

describe("granting and revoking through Field Permissions", () => {
  it("nothing is automatic: an admin and a super-admin with no grant hold none of the capabilities", async () => {
    for (const who of ["Admin", "Super", "Staff"]) {
      as(who);
      expect(await cap.getLeaveCapabilityProofs()).toEqual({ view: null, decide: null, override: null });
      expect(await queue(who)).toBeNull();
    }
  });

  it("a grant gives exactly that capability, and only to that person", async () => {
    as("ViewOnly");
    const c = await cap.getLeaveCapabilityProofs();
    expect([c.view !== null, c.decide !== null, c.override !== null]).toEqual([true, false, false]);
    as("Staff");
    expect((await cap.getLeaveCapabilityProofs()).view).toBeNull();
  });

  it("only a super-admin can grant or revoke them — an ordinary admin is refused and nothing changes", async () => {
    as("Admin");
    const r = await matrix.setFieldPermission(VIEW, "employee", P.Staff!.id, true);
    expect(r.ok).toBe(false);
    as("Staff");
    expect((await cap.getLeaveCapabilityProofs()).view).toBeNull();
    as("Admin");
    expect((await matrix.setFieldPermission(VIEW, "employee", P.Approver!.id, null)).ok).toBe(false);
    as("Approver");
    expect((await cap.getLeaveCapabilityProofs()).view).not.toBeNull();
  });

  it("can't be granted to a department (a department-membership edit must not widen leave access)", async () => {
    as("Super");
    const dept = (await pg.query<{ id: string }>(`insert into departments (name) values ('Ops') returning id`)).rows[0]!.id;
    expect((await matrix.setFieldPermission(VIEW, "department", dept, true)).ok).toBe(false);
  });

  it("a grant is audited", async () => {
    expect((await pg.query(`select 1 from settings_events where to_value->>'fieldKey' = $1`, [VIEW])).rows.length).toBeGreaterThan(0);
  });

  it("revocation takes effect on the very next request — for the page, the queue and the action", async () => {
    const id = await file("Asha", "2026-11-02", "2026-11-03");
    expect(names(await queue("Approver"))).toEqual(["Asha"]);
    await grant(DECIDE, "Approver", null); // revoked
    as("Approver");
    expect((await actions.decideLeave({ id, verdict: "approved" })).ok).toBe(false);
    expect(await status(id)).toBe("pending");
    await grant(VIEW, "Approver", false); // an explicit deny
    expect(await queue("Approver")).toBeNull();
  });

  it("an inactive employee holds nothing, whatever they were granted", async () => {
    P.Approver!.isActive = false;
    as("Approver");
    expect(await cap.getLeaveCapabilityProofs()).toEqual({ view: null, decide: null, override: null });
  });

  it("the default approver's access is reported from the same grants (for the settings warning)", async () => {
    expect(await q.getDefaultApproverAccess()).toEqual({ view: true, decide: true });
    await grant(DECIDE, "Approver", null);
    expect(await q.getDefaultApproverAccess()).toEqual({ view: true, decide: false });
    await pg.exec(`delete from field_permission_grants`);
    expect(await q.getDefaultApproverAccess()).toEqual({ view: false, decide: false });
  });

  it("navigation: the Leave Approvals entry needs the view grant — nothing else shows it", async () => {
    const keys = ["leave.approvals.view"];
    const held = async (who: string) => (as(who), cap.getHeldCapabilities(keys));
    expect(await held("Approver")).toEqual(keys);
    expect(await held("ViewOnly")).toEqual(keys);
    expect(await held("DecideOnly")).toEqual([]);
    for (const who of ["Admin", "Super", "Staff"]) expect(await held(who)).toEqual([]);
    h.me = null;
    expect(await cap.getHeldCapabilities(keys)).toEqual([]);
  });
});

describe("default approver configuration (routing only)", () => {
  it("is whoever an admin picked — resolved through leave_approvers, not named in code", async () => {
    expect((await q.getDefaultLeaveApprover())?.employeeId).toBe(P.Approver!.id);
    expect(await q.getDefaultApproverStatus()).toEqual({ state: "ok", name: "Approver" });
  });

  it("changing the default leaves exactly one default", async () => {
    as("Admin");
    await actions.setLeaveApprover({ employeeId: P.OtherApprover!.id, action: "make_default" });
    expect((await q.listLeaveApprovers()).filter((r) => r.isDefault).map((r) => r.employeeId)).toEqual([P.OtherApprover!.id]);
  });

  it("only an admin can change it", async () => {
    as("Staff");
    await expect(actions.setLeaveApprover({ employeeId: P.Staff!.id, action: "make_default" })).rejects.toThrow("Forbidden");
    expect((await q.getDefaultLeaveApprover())?.employeeId).toBe(P.Approver!.id);
  });

  it("being listed as an approver grants no access by itself", async () => {
    await pg.exec(`delete from field_permission_grants`);
    expect(await queue("Approver")).toBeNull();
    const id = await file("Asha", "2026-11-02", "2026-11-03");
    as("Approver");
    expect((await actions.decideLeave({ id, verdict: "approved" })).ok).toBe(false);
    expect(await status(id)).toBe("pending");
  });

  it("candidates offered to the admin carry their e-mail, so the right account is picked", async () => {
    const list = await q.listApproverCandidates();
    expect(list.find((p) => p.name === "Asha")).toEqual({ id: P.Asha!.id, name: "Asha", email: "asha@example.test" });
  });
});

describe("routing a new request", () => {
  it("goes to the configured default approver, and the approver is told", async () => {
    const id = await file("Asha", "2026-11-02", "2026-11-03");
    expect(await approverOf(id)).toBe(P.Approver!.id);
    expect(await status(id)).toBe("pending");
    expect(h.notify).toHaveBeenCalledWith(expect.objectContaining({ userId: P.Approver!.id }));
  });

  it("the approver's own request is not routed to themselves", async () => {
    expect(await approverOf(await file("Approver", "2026-11-05", "2026-11-05"))).toBeNull();
  });

  it("with no default configured the request still files", async () => {
    await pg.exec(`delete from leave_approvers`);
    expect(await approverOf(await file("Asha", "2026-11-09", "2026-11-09"))).toBeNull();
  });
});

describe("the review queue", () => {
  it("shows an approver all of their assigned pending requests, with who is asking — and nobody else's", async () => {
    await file("Asha", "2026-11-02", "2026-11-03");
    await file("Ravi", "2026-11-04", "2026-11-04");
    await file("Staff", "2026-11-06", "2026-11-06", "OtherApprover");
    await file("Asha", "2026-11-20", "2026-11-20", null);
    const rows = (await queue("Approver"))!;
    expect(names(rows)).toEqual(["Asha", "Ravi"]);
    expect(rows.find((r) => r.employeeName === "Asha")!.employeeEmail).toBe("asha@example.test");
  });

  it("never lists the viewer's own request", async () => {
    await file("Approver", "2026-11-05", "2026-11-05", "Approver");
    expect(await queue("Approver")).toEqual([]);
  });

  it("the override widens the queue to every pending request, still never the viewer's own", async () => {
    await file("Asha", "2026-11-02", "2026-11-03");
    await file("Ravi", "2026-11-04", "2026-11-04", "OtherApprover");
    await file("Staff", "2026-11-06", "2026-11-06", null);
    await file("Overrider", "2026-11-09", "2026-11-09", "Approver");
    expect(names(await queue("Overrider"))).toEqual(["Asha", "Ravi", "Staff"]);
  });

  it("a view-only user sees their assigned queue; an ordinary employee, an admin and a super-admin without grants get none", async () => {
    await file("Asha", "2026-11-02", "2026-11-03", "ViewOnly");
    expect(names(await queue("ViewOnly"))).toEqual(["Asha"]);
    for (const who of ["Staff", "Admin", "Super"]) expect(await queue(who)).toBeNull();
  });

  it("decided requests drop out of the queue", async () => {
    const id = await file("Asha", "2026-11-02", "2026-11-03");
    as("Approver");
    await actions.decideLeave({ id, verdict: "approved" });
    expect(await queue("Approver")).toEqual([]);
  });
});

describe("deciding", () => {
  it("the assigned approver approves: status, reviewer, time and an audit row are recorded; the employee is told", async () => {
    const id = await file("Asha", "2026-11-02", "2026-11-03");
    as("Approver");
    expect(await actions.decideLeave({ id, verdict: "approved", note: "Enjoy" })).toEqual({ ok: true });
    const row = (
      await pg.query<{ status: string; decided_by_id: string; decided_at: Date | null; decision_note: string }>(
        `select status, decided_by_id, decided_at, decision_note from leave_requests where id=$1`,
        [id],
      )
    ).rows[0]!;
    expect(row.status).toBe("approved");
    expect(row.decided_by_id).toBe(P.Approver!.id);
    expect(row.decided_at).not.toBeNull();
    expect(row.decision_note).toBe("Enjoy");
    expect((await pg.query<{ actor_id: string }>(`select actor_id from employee_events where event_type = 'leave_approved'`)).rows).toEqual([{ actor_id: P.Approver!.id }]);
    expect(h.notify).toHaveBeenLastCalledWith(expect.objectContaining({ userId: P.Asha!.id, title: expect.stringContaining("approved") }));
  });

  it("rejecting needs a reason; with one it records the rejection", async () => {
    const id = await file("Asha", "2026-11-02", "2026-11-03");
    as("Approver");
    expect((await actions.decideLeave({ id, verdict: "rejected" })).ok).toBe(false);
    expect(await status(id)).toBe("pending");
    expect(await actions.decideLeave({ id, verdict: "rejected", note: "Peak week" })).toEqual({ ok: true });
    expect(await status(id)).toBe("rejected");
  });

  it("a view-only reviewer cannot approve or reject — by calling the action directly — and nothing changes", async () => {
    const id = await file("Asha", "2026-11-02", "2026-11-03", "ViewOnly");
    as("ViewOnly");
    expect(await actions.decideLeave({ id, verdict: "approved" })).toEqual({ ok: false, error: expect.stringMatching(/not authorised/) });
    expect((await actions.decideLeave({ id, verdict: "rejected", note: "no" })).ok).toBe(false);
    expect(await status(id)).toBe("pending");
  });

  it("an ordinary employee, an admin and a super-admin without the grant cannot decide", async () => {
    const id = await file("Asha", "2026-11-02", "2026-11-03");
    for (const who of ["Staff", "Admin", "Super"]) {
      as(who);
      expect((await actions.decideLeave({ id, verdict: "approved" })).ok).toBe(false);
    }
    expect(await status(id)).toBe("pending");
  });

  it("a reviewer with decide only (no view) can still decide what is assigned to them, but is not shown the queue", async () => {
    const id = await file("Asha", "2026-11-02", "2026-11-03", "DecideOnly");
    expect(await queue("DecideOnly")).toBeNull();
    as("DecideOnly");
    expect(await actions.decideLeave({ id, verdict: "approved" })).toEqual({ ok: true });
  });

  it("an authorised reviewer cannot decide a request assigned to someone else or to nobody", async () => {
    const elsewhere = await file("Asha", "2026-11-02", "2026-11-03", "OtherApprover");
    const nobody = await file("Ravi", "2026-11-04", "2026-11-04", null);
    as("Approver");
    for (const id of [elsewhere, nobody]) {
      expect((await actions.decideLeave({ id, verdict: "approved" })).ok).toBe(false);
      expect(await status(id)).toBe("pending");
    }
  });

  it("the override (with decide) can decide anyone's request — but never the reviewer's own", async () => {
    const theirs = await file("Asha", "2026-11-02", "2026-11-03", "OtherApprover");
    const own = await file("Overrider", "2026-11-09", "2026-11-09", "Overrider");
    as("Overrider");
    expect(await actions.decideLeave({ id: theirs, verdict: "approved" })).toEqual({ ok: true });
    expect(await actions.decideLeave({ id: own, verdict: "approved" })).toEqual({ ok: false, error: expect.stringMatching(/your own/) });
    expect(await status(own)).toBe("pending");
  });

  it("the override alone is worth nothing: without 'approve or reject' the action refuses", async () => {
    await grant(DECIDE, "Overrider", null);
    const id = await file("Asha", "2026-11-02", "2026-11-03", "OtherApprover");
    as("Overrider");
    expect((await actions.decideLeave({ id, verdict: "approved" })).ok).toBe(false);
    expect(await status(id)).toBe("pending");
  });

  it("an employee cannot approve their own request, however they are authorised", async () => {
    const own = await file("OtherApprover", "2026-11-02", "2026-11-03", "OtherApprover");
    as("OtherApprover");
    expect((await actions.decideLeave({ id: own, verdict: "approved" })).ok).toBe(false);
    const mine = await file("Asha", "2026-12-01", "2026-12-01");
    as("Asha");
    expect((await actions.decideLeave({ id: mine, verdict: "approved" })).ok).toBe(false);
  });

  it("an already-decided request cannot be decided again — not even by an override holder", async () => {
    const id = await file("Asha", "2026-11-02", "2026-11-03");
    as("Approver");
    await actions.decideLeave({ id, verdict: "approved" });
    for (const who of ["Approver", "Overrider"]) {
      as(who);
      expect(await actions.decideLeave({ id, verdict: "rejected", note: "changed my mind" })).toEqual({ ok: false, error: expect.stringMatching(/already been approved/) });
    }
    expect(await status(id)).toBe("approved");
    expect((await pg.query(`select 1 from employee_events where event_type in ('leave_approved','leave_rejected')`)).rows.length).toBe(1);
  });

  it("if the request is withdrawn between the read and the write, the conditional update refuses", async () => {
    const id = await file("Asha", "2026-11-02", "2026-11-03");
    as("Approver");
    await pg.query(`update leave_requests set status='cancelled' where id=$1`, [id]);
    expect((await actions.decideLeave({ id, verdict: "approved" })).ok).toBe(false);
    expect(await status(id)).toBe("cancelled");
  });

  it("an unknown request id is reported, not thrown", async () => {
    as("Approver");
    expect(await actions.decideLeave({ id: "00000000-0000-4000-8000-000000000000", verdict: "approved" })).toEqual({ ok: false, error: "Leave request not found" });
  });
});

describe("re-routing existing pending requests (an explicit admin action)", () => {
  it("moves only pending requests that are not with the default, audits each, and changes no decision", async () => {
    const unrouted = await file("Asha", "2026-11-02", "2026-11-03", null);
    const wrong = await file("Ravi", "2026-11-04", "2026-11-04", "OtherApprover");
    const already = await file("Staff", "2026-11-06", "2026-11-06", "Approver");
    const own = await file("Approver", "2026-11-09", "2026-11-09", null);
    const decided = await file("Asha", "2026-12-01", "2026-12-01", "OtherApprover");
    await pg.query(`update leave_requests set status='approved' where id=$1`, [decided]);

    as("Admin");
    expect(await actions.reassignPendingLeave()).toEqual({ ok: true, moved: 2, routedTo: "Approver" });
    expect(await approverOf(unrouted)).toBe(P.Approver!.id);
    expect(await approverOf(wrong)).toBe(P.Approver!.id);
    expect(await approverOf(already)).toBe(P.Approver!.id);
    expect(await approverOf(own)).toBeNull();
    expect(await approverOf(decided)).toBe(P.OtherApprover!.id);
    expect(await status(decided)).toBe("approved");
    expect((await pg.query(`select 1 from employee_events where event_type='leave_rerouted'`)).rows.length).toBe(2);
    expect(await actions.reassignPendingLeave()).toEqual({ ok: true, moved: 0, routedTo: "Approver" });
  });

  it("is admin-only and needs a default approver", async () => {
    await file("Asha", "2026-11-02", "2026-11-03", null);
    as("Approver");
    await expect(actions.reassignPendingLeave()).rejects.toThrow("Forbidden");
    as("Admin");
    await pg.exec(`delete from leave_approvers`);
    expect(await actions.reassignPendingLeave()).toEqual({ ok: false, error: "Set an active default approver first." });
  });
});
