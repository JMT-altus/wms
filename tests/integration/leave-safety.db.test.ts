import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Leave safety against a REAL (in-memory PGlite) Postgres built from db/schema.ts.
// Nothing here can reach a shared or production database.
//
//  - races: a hook runs AFTER an action has read a request and BEFORE it writes,
//    so the conditional writes are tested against a genuine change in between;
//  - atomicity: a trigger makes the audit insert fail, and the main change must
//    roll back with it;
//  - safe errors: a trigger raises an error whose text names internal details,
//    and the browser must never see it.
// Only the session is mocked (super-admin status uses a made-up test address).
type Me = { id: string; email: string; isActive: boolean; isAdmin: boolean; name: string; departmentId: string | null };
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | Me, notify: vi.fn(), afterRead: null as null | (() => Promise<unknown>) };
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

let pg: Awaited<ReturnType<typeof createTestDb>>["pg"];
let actions: typeof import("@/app/(app)/attendance/leave/actions");
let matrix: typeof import("@/app/(masters)/master-setup/actions");
const P: Record<string, Me> = {};

const emp = async (key: string, email: string, isAdmin = false) => {
  const id = (await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', $3) returning id`, [key, email, isAdmin])).rows[0]!.id;
  P[key] = { id, email, isActive: true, isAdmin, name: key, departmentId: null };
};
const as = (key: string | null) => {
  h.me = key ? P[key]! : null;
};
const grant = async (key: string, to: string) => {
  const before = h.me;
  as("Super");
  expect(await matrix.setFieldPermission(key, "employee", P[to]!.id, true)).toEqual({ ok: true });
  h.me = before;
};
/** A request filed directly (status and approver chosen by the test). */
const file = async (who: string, approver: string | null, status = "pending") =>
  (
    await pg.query<{ id: string }>(
      `insert into leave_requests (employee_id, approver_id, leave_type, start_date, end_date, days, reason, status) values ($1, $2, 'planned', '2026-11-02', '2026-11-03', 2, 'x', $3) returning id`,
      [P[who]!.id, approver ? P[approver]!.id : null, status],
    )
  ).rows[0]!.id;
const row = async (id: string) =>
  (await pg.query<{ status: string; approver_id: string | null; decided_by_id: string | null }>(`select status, approver_id, decided_by_id from leave_requests where id = $1`, [id])).rows[0]!;
const events = async (type?: string) =>
  (await pg.query<{ event_type: string; employee_id: string; actor_id: string; from_value: unknown; to_value: unknown }>(
    `select event_type, employee_id, actor_id, from_value, to_value from employee_events ${type ? "where event_type = $1" : ""} order by created_at`,
    type ? [type] : [],
  )).rows;
/** Make the next audit insert of this event type fail inside the database. */
const failAudit = (eventType: string) =>
  pg.exec(`create or replace function fail_audit() returns trigger language plpgsql as $$ begin
      if new.event_type = '${eventType}' then raise exception 'audit write failed'; end if; return new; end $$;
    drop trigger if exists fail_audit on employee_events;
    create trigger fail_audit before insert on employee_events for each row execute function fail_audit();`);

/** The real database, with a hook run right after an action reads a leave request (before it writes). */
function withReadHook(base: Record<string | symbol, unknown>) {
  return new Proxy(base, {
    get(target, prop) {
      if (prop !== "query") return Reflect.get(target, prop);
      const query = target.query as Record<string, { findFirst: (...a: unknown[]) => Promise<unknown> }>;
      return new Proxy(query, {
        get(q, table) {
          if (table !== "leaveRequests") return Reflect.get(q, table);
          return {
            ...q.leaveRequests,
            findFirst: async (...a: unknown[]) => {
              const v = await q.leaveRequests!.findFirst(...a);
              const hook = h.afterRead;
              h.afterRead = null;
              if (hook) await hook();
              return v;
            },
          };
        },
      });
    },
  });
}

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
  h.db = withReadHook(made.db as unknown as Record<string | symbol, unknown>);
  await emp("Super", "super@example.test", true);
  await emp("Admin", "admin@example.test", true);
  await emp("Approver", "approver@example.test");
  await emp("Other", "other@example.test");
  await emp("Overrider", "overrider@example.test");
  await emp("Asha", "asha@example.test");
  actions = await import("@/app/(app)/attendance/leave/actions");
  matrix = await import("@/app/(masters)/master-setup/actions");
  for (const who of ["Approver", "Other"]) for (const k of ["leave.approvals.view", "leave.approvals.decide"]) await grant(k, who);
  for (const k of ["leave.approvals.view", "leave.approvals.decide", "leave.approvals.override"]) await grant(k, "Overrider");
}, 180_000);
afterAll(async () => {
  await pg?.close();
});
beforeEach(async () => {
  h.afterRead = null;
  await pg.exec(`drop trigger if exists fail_audit on employee_events; drop trigger if exists fail_leave on leave_requests;
    delete from leave_requests; delete from leave_approvers; delete from employee_events;`);
  h.notify.mockReset().mockResolvedValue(undefined);
});

describe("cancelling", () => {
  it("an employee's own approved leave cannot be cancelled through the ordinary path", async () => {
    const id = await file("Asha", "Approver", "approved");
    as("Asha");
    expect(await actions.cancelLeave({ id })).toEqual({ ok: false, error: "Only pending requests can be cancelled." });
    expect((await row(id)).status).toBe("approved");
    expect(await events("leave_cancelled")).toEqual([]);
  });

  it("…nor by an admin cancelling their OWN approved leave (the ordinary path applies to their own request)", async () => {
    const id = await file("Admin", "Approver", "approved");
    as("Admin");
    expect(await actions.cancelLeave({ id })).toEqual({ ok: false, error: "Only pending requests can be cancelled." });
    expect((await row(id)).status).toBe("approved");
  });

  it("an admin may still cancel SOMEONE ELSE's approved leave (existing admin power), audited from → to", async () => {
    const id = await file("Asha", "Approver", "approved");
    as("Admin");
    expect(await actions.cancelLeave({ id })).toEqual({ ok: true });
    expect(await row(id)).toMatchObject({ status: "cancelled", decided_by_id: P.Admin!.id });
    expect(await events("leave_cancelled")).toEqual([
      expect.objectContaining({ employee_id: P.Asha!.id, actor_id: P.Admin!.id, from_value: { status: "approved" }, to_value: { status: "cancelled" } }),
    ]);
  });

  it("RACE: the request is approved after the employee's check but before the write — the cancellation is refused", async () => {
    const id = await file("Asha", "Approver");
    as("Asha");
    h.afterRead = () => pg.query(`update leave_requests set status = 'approved' where id = $1`, [id]);
    expect(await actions.cancelLeave({ id })).toEqual({ ok: false, error: expect.stringMatching(/changed meanwhile/) });
    expect((await row(id)).status).toBe("approved");
    expect(await events("leave_cancelled")).toEqual([]);
  });

  it("RACE: an admin's cancellation is refused if the status changed after they looked", async () => {
    const id = await file("Asha", "Approver");
    as("Admin");
    h.afterRead = () => pg.query(`update leave_requests set status = 'rejected' where id = $1`, [id]);
    expect((await actions.cancelLeave({ id })).ok).toBe(false);
    expect((await row(id)).status).toBe("rejected");
  });

  it("ATOMIC: if the audit row can't be written, the cancellation is rolled back", async () => {
    const id = await file("Asha", "Approver");
    await failAudit("leave_cancelled");
    as("Asha");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await actions.cancelLeave({ id })).toEqual({ ok: false, error: "Something went wrong and nothing was changed. Please try again." });
    err.mockRestore();
    expect((await row(id)).status).toBe("pending");
  });

  it("an already-cancelled request is reported, not cancelled (or audited) again", async () => {
    const id = await file("Asha", "Approver", "cancelled");
    as("Admin");
    expect(await actions.cancelLeave({ id })).toEqual({ ok: false, error: "This request is already cancelled." });
    expect(await events()).toEqual([]);
  });
});

describe("deciding", () => {
  it("RACE: re-routed to another approver after the check — the assigned approver's decision is refused", async () => {
    const id = await file("Asha", "Approver");
    as("Approver");
    h.afterRead = () => pg.query(`update leave_requests set approver_id = $2 where id = $1`, [id, P.Other!.id]);
    expect(await actions.decideLeave({ id, verdict: "approved" })).toEqual({ ok: false, error: expect.stringMatching(/re-routed/) });
    expect(await row(id)).toMatchObject({ status: "pending", approver_id: P.Other!.id });
    expect(await events("leave_approved")).toEqual([]);
  });

  it("RACE: an override holder's decision is refused if the request was re-routed after they looked", async () => {
    const id = await file("Asha", "Approver");
    as("Overrider");
    h.afterRead = () => pg.query(`update leave_requests set approver_id = $2 where id = $1`, [id, P.Other!.id]);
    expect((await actions.decideLeave({ id, verdict: "approved" })).ok).toBe(false);
    expect((await row(id)).status).toBe("pending");
  });

  it("RACE: cancelled by the employee after the check — the approval is refused", async () => {
    const id = await file("Asha", "Approver");
    as("Approver");
    h.afterRead = () => pg.query(`update leave_requests set status = 'cancelled' where id = $1`, [id]);
    expect((await actions.decideLeave({ id, verdict: "approved" })).ok).toBe(false);
    expect((await row(id)).status).toBe("cancelled");
    expect(await events("leave_approved")).toEqual([]);
  });

  it("an unchanged request is still decided normally (the guard doesn't block valid decisions), with an override on an unassigned one too", async () => {
    const assigned = await file("Asha", "Approver");
    as("Approver");
    expect(await actions.decideLeave({ id: assigned, verdict: "approved" })).toEqual({ ok: true });
    const unassigned = await file("Asha", null);
    as("Overrider");
    expect(await actions.decideLeave({ id: unassigned, verdict: "rejected", note: "Clash with audit week" })).toEqual({ ok: true });
    expect((await events()).map((e) => e.event_type).sort()).toEqual(["leave_approved", "leave_rejected"]);
  });

  it("ATOMIC: if the decision's audit row can't be written, the decision is rolled back", async () => {
    const id = await file("Asha", "Approver");
    await failAudit("leave_approved");
    as("Approver");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await actions.decideLeave({ id, verdict: "approved" })).toEqual({ ok: false, error: "Something went wrong and nothing was changed. Please try again." });
    err.mockRestore();
    expect(await row(id)).toMatchObject({ status: "pending", decided_by_id: null });
  });
});

describe("safe errors: database details never reach the browser", () => {
  it("a failing insert returns a plain message; the details go to the server log only", async () => {
    await pg.exec(`create or replace function fail_leave() returns trigger language plpgsql as $$ begin
        raise exception 'relation "internal_secret_table" violates constraint on host db-internal.example:5432'; end $$;
      create trigger fail_leave before insert on leave_requests for each row execute function fail_leave();`);
    as("Asha");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await actions.applyForLeave({ startDate: "2026-11-02", endDate: "2026-11-03", leaveType: "planned", reason: "Family function" });
    expect(r).toEqual({ ok: false, error: "Something went wrong and nothing was changed. Please try again." });
    expect(JSON.stringify(r)).not.toMatch(/DB:|internal_secret_table|db-internal|5432/);
    expect(err.mock.calls.flat().map(String).join(" ")).toMatch(/\[leave\] filing a leave request failed/);
    err.mockRestore();
  });

  it("no action returns a raw 'DB:' message any more", async () => {
    const src = (await import("node:fs")).readFileSync(new URL("../../app/(app)/attendance/leave/actions.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/error: `DB:|error: "DB:/);
  });
});

describe("approver changes are audited", () => {
  const approverEvents = () => events("leave_approver_changed");

  it("add, make default (recording the previous default) and remove each write one before → after event", async () => {
    as("Admin");
    expect(await actions.setLeaveApprover({ employeeId: P.Approver!.id, action: "make_default" })).toEqual({ ok: true });
    expect(await actions.setLeaveApprover({ employeeId: P.Other!.id, action: "add" })).toEqual({ ok: true });
    expect(await actions.setLeaveApprover({ employeeId: P.Other!.id, action: "make_default" })).toEqual({ ok: true });
    expect(await actions.setLeaveApprover({ employeeId: P.Approver!.id, action: "remove" })).toEqual({ ok: true });
    expect(await approverEvents()).toEqual([
      expect.objectContaining({ employee_id: P.Approver!.id, actor_id: P.Admin!.id, from_value: { listed: false, isDefault: false }, to_value: { listed: true, isDefault: true, action: "make_default" } }),
      expect.objectContaining({ employee_id: P.Other!.id, from_value: { listed: false, isDefault: false }, to_value: { listed: true, isDefault: false, action: "add" } }),
      expect.objectContaining({ employee_id: P.Other!.id, from_value: { listed: true, isDefault: false }, to_value: { listed: true, isDefault: true, action: "make_default", previousDefaultId: P.Approver!.id } }),
      expect.objectContaining({ employee_id: P.Approver!.id, from_value: { listed: true, isDefault: false }, to_value: { listed: false, isDefault: false, action: "remove" } }),
    ]);
    // Exactly one default remains.
    expect((await pg.query(`select employee_id from leave_approvers where is_default`)).rows).toEqual([{ employee_id: P.Other!.id }]);
  });

  it("a change that changes nothing writes no audit row", async () => {
    as("Admin");
    await actions.setLeaveApprover({ employeeId: P.Approver!.id, action: "make_default" });
    const before = (await approverEvents()).length;
    await actions.setLeaveApprover({ employeeId: P.Approver!.id, action: "make_default" });
    await actions.setLeaveApprover({ employeeId: P.Approver!.id, action: "add" });
    await actions.setLeaveApprover({ employeeId: P.Other!.id, action: "remove" }); // was never listed
    expect((await approverEvents()).length).toBe(before);
  });

  it("ATOMIC: if the audit row can't be written, the approver change is rolled back", async () => {
    as("Admin");
    await failAudit("leave_approver_changed");
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await actions.setLeaveApprover({ employeeId: P.Approver!.id, action: "make_default" })).ok).toBe(false);
    err.mockRestore();
    expect((await pg.query(`select 1 from leave_approvers`)).rows).toEqual([]);
  });

  it("still admin-only", async () => {
    as("Asha");
    await expect(actions.setLeaveApprover({ employeeId: P.Asha!.id, action: "make_default" })).rejects.toThrow("Forbidden");
    expect(await approverEvents()).toEqual([]);
  });
});
