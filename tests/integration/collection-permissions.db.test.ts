import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite — nothing here can reach a shared or
// production database) for the Collection capabilities end to end: grant rows
// in field_permission_grants → the real resolver (lib/auth/field-access.ts) →
// requireCollectionCapability, and the permission-matrix actions that write
// grants (super-admin rule for sensitive keys, unknown keys, audit rows in
// settings_events). The session is MOCKED; super-admin status is mocked to a
// made-up test address so no real account appears here.
type Me = { id: string; email: string; isActive: boolean; isAdmin: boolean; name: string; departmentId: string | null };
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | Me };
});
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
// The real editEmployee action is exercised below; its Firebase and email clients are never reached.
vi.mock("@/lib/firebase/admin", () => ({ getFirebaseAdminAuth: () => ({}) }));
vi.mock("@/lib/email/resend", () => ({ sendInviteEmail: vi.fn(), sendPasswordChangedByAdminEmail: vi.fn(), sendCredentialsEmail: vi.fn() }));
vi.mock("@/lib/db", () => ({
  get db() {
    if (!h.db) throw new Error("test database not ready");
    return h.db;
  },
}));
vi.mock("@/lib/auth/current", () => ({
  getCurrentEmployee: async () => h.me,
  requireAdmin: async () => {
    if (!h.me?.isActive || !h.me.isAdmin) throw new Error("Forbidden");
    return h.me;
  },
}));
vi.mock("@/lib/auth/super-admin", () => ({ isSuperAdmin: (e: string | null | undefined) => e === "super@example.test" }));

import { eq } from "drizzle-orm";
import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";

const ORDINARY = ["collection.view", "collection.master.import", "collection.followup.write", "collection.confirmation.set", "collection.escalation.create"] as const;
const SENSITIVE = ["collection.coordinator.assign", "collection.commitments.view", "collection.commitments.edit", "collection.escalation.review", "collection.escalation.close"] as const;

let pg: Awaited<ReturnType<typeof createTestDb>>["pg"];
let cap: typeof import("@/lib/auth/capability");
let matrix: typeof import("@/app/(masters)/master-setup/actions");
let fieldAccess: typeof import("@/lib/auth/field-access");
const ids = { super: "", admin: "", admin2: "", plain: "", dept: "" };
const people: Record<string, Me> = {};
const as = (k: keyof typeof ids) => {
  h.me = people[k]!;
};
const count = async (sql: string, p: unknown[] = []) => (await pg.query<{ n: number }>(sql, p)).rows[0]!.n;
const allowed = async (key: (typeof ORDINARY)[number] | (typeof SENSITIVE)[number]) =>
  cap.requireCollectionCapability(key).then(
    () => true,
    (e: Error) => (e.message === "Forbidden" ? false : Promise.reject(e)),
  );

beforeAll(async () => {
  const made = await createTestDb({
    employees: schema.employees,
    departments: schema.departments,
    employeeDepartments: schema.employeeDepartments,
    fieldPermissionGrants: schema.fieldPermissionGrants,
    settingsEvents: schema.settingsEvents,
    employeeEvents: schema.employeeEvents,
    moduleAccessGrants: schema.moduleAccessGrants,
  });
  pg = made.pg;
  h.db = made.db;
  ids.dept = (await pg.query<{ id: string }>(`insert into departments (name) values ('Accounts') returning id`)).rows[0]!.id;
  const emp = async (k: keyof typeof ids, name: string, email: string, isAdmin: boolean) => {
    const id = (await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', $3) returning id`, [name, email, isAdmin])).rows[0]!.id;
    ids[k] = id;
    people[k] = { id, email, isActive: true, isAdmin, name, departmentId: null };
  };
  await emp("super", "Super", "super@example.test", true);
  await emp("admin", "Asha", "asha@example.test", true);
  await emp("admin2", "Ravi", "ravi@example.test", true);
  await emp("plain", "Pat", "pat@example.test", false);
  cap = await import("@/lib/auth/capability");
  matrix = await import("@/app/(masters)/master-setup/actions");
  fieldAccess = await import("@/lib/auth/field-access");
}, 180_000);
afterAll(async () => {
  await pg?.close();
});

describe("defaults with no grants at all", () => {
  it("an admin has every ordinary capability and no sensitive one", async () => {
    as("admin");
    for (const k of ORDINARY) expect(await allowed(k)).toBe(true);
    for (const k of SENSITIVE) expect(await allowed(k)).toBe(false);
  });

  it("a super-admin has the ordinary ones but NO sensitive one without an explicit grant", async () => {
    as("super");
    for (const k of ORDINARY) expect(await allowed(k)).toBe(true);
    for (const k of SENSITIVE) expect(await allowed(k)).toBe(false);
  });

  it("a non-admin has nothing in Collection (the Forms area is admin-only)", async () => {
    as("plain");
    for (const k of [...ORDINARY, ...SENSITIVE]) expect(await allowed(k)).toBe(false);
  });
});

describe("granting through the permission matrix", () => {
  it("a non-super-admin can't grant or revoke a sensitive capability — for themselves, others, a department or everyone — and nothing is written", async () => {
    as("admin");
    for (const k of SENSITIVE) {
      for (const [type, id] of [["employee", ids.admin], ["employee", ids.admin2], ["department", ids.dept], ["everyone", null]] as const) {
        for (const value of [true, false, null]) {
          // A department Allow/Deny is refused for everyone (no department layer); everything else needs a super-admin.
          const error =
            type === "department" && value !== null
              ? "Sensitive permissions can be granted only to a person or organisation-wide, not to a department."
              : "Only a super-admin can grant or revoke this permission.";
          expect(await matrix.setFieldPermission(k, type, id, value)).toEqual({ ok: false, error });
        }
      }
    }
    expect(await count(`select count(*)::int as n from field_permission_grants`)).toBe(0);
    expect(await count(`select count(*)::int as n from settings_events`)).toBe(0);
  });

  it("unknown keys are rejected for everyone, super-admins included", async () => {
    for (const who of ["admin", "super"] as const) {
      as(who);
      for (const k of ["collection.anything", "collection.commitments.VIEW", "", "x".repeat(81)]) {
        expect(await matrix.setFieldPermission(k, "employee", ids.admin, true)).toEqual({ ok: false, error: "Unknown permission." });
      }
    }
    expect(await count(`select count(*)::int as n from field_permission_grants`)).toBe(0);
  });

  it("a super-admin grants each sensitive capability explicitly — audited — and it takes effect on the next request", async () => {
    for (const k of SENSITIVE) {
      as("admin");
      expect(await allowed(k)).toBe(false);
      as("super");
      expect(await matrix.setFieldPermission(k, "employee", ids.admin, true)).toEqual({ ok: true });
      as("admin");
      expect(await allowed(k)).toBe(true);
    }
    const audit = await pg.query<{ scope: string; actor_id: string; target_id: string; to_value: Record<string, unknown> }>(
      `select scope, actor_id, target_id, to_value from settings_events order by created_at`,
    );
    expect(audit.rows).toHaveLength(SENSITIVE.length);
    expect(audit.rows[0]).toMatchObject({ scope: "field_access", actor_id: ids.super, target_id: ids.admin, to_value: { fieldKey: SENSITIVE[0], subjectType: "employee", allowed: true, sensitive: true } });
  });

  it("the proof carries the signed-in employee's id, never anything from the caller", async () => {
    as("admin");
    expect(await cap.requireCollectionCapability("collection.commitments.view")).toEqual({ employeeId: ids.admin, capability: "collection.commitments.view" });
  });

  it("review doesn't grant close, and close doesn't grant review", async () => {
    as("super");
    await matrix.setFieldPermission("collection.escalation.close", "employee", ids.admin, null);
    as("admin");
    expect(await allowed("collection.escalation.review")).toBe(true);
    expect(await allowed("collection.escalation.close")).toBe(false);
    as("super");
    await matrix.setFieldPermission("collection.escalation.close", "employee", ids.admin2, true);
    as("admin2");
    expect(await allowed("collection.escalation.close")).toBe(true);
    expect(await allowed("collection.escalation.review")).toBe(false);
  });

  it("every granted employee is a reviewer — no single person is assumed", async () => {
    as("super");
    await matrix.setFieldPermission("collection.escalation.review", "employee", ids.admin2, true);
    for (const who of ["admin", "admin2"] as const) {
      as(who);
      expect(await allowed("collection.escalation.review")).toBe(true);
    }
  });

  it("a revoke (super-admin) is audited with the previous value and stops access on the next request", async () => {
    as("admin");
    expect(await allowed("collection.commitments.view")).toBe(true);
    as("super");
    expect(await matrix.setFieldPermission("collection.commitments.view", "employee", ids.admin, null)).toEqual({ ok: true });
    as("admin");
    expect(await allowed("collection.commitments.view")).toBe(false);
    const last = (await pg.query<{ from_value: { allowed: boolean | null }; to_value: { allowed: boolean | null } }>(`select from_value, to_value from settings_events order by created_at desc limit 1`)).rows[0]!;
    expect(last).toMatchObject({ from_value: { allowed: true }, to_value: { allowed: null } });
  });

  it("an explicit person-level deny beats an org-wide grant, deterministically", async () => {
    as("super");
    await matrix.setFieldPermission("collection.commitments.edit", "everyone", null, true);
    await matrix.setFieldPermission("collection.commitments.edit", "employee", ids.admin2, false);
    as("admin2");
    expect(await allowed("collection.commitments.edit")).toBe(false);
    as("super");
    expect(await allowed("collection.commitments.edit")).toBe(true); // the org-wide grant is explicit
    await matrix.setFieldPermission("collection.commitments.edit", "everyone", null, null);
    expect(await allowed("collection.commitments.edit")).toBe(false); // super-admin status alone isn't enough
  });

  it("a deactivated employee holds nothing, grants or not", async () => {
    h.me = { ...people.admin!, isActive: false };
    expect(await allowed("collection.view")).toBe(false);
    expect(await allowed("collection.escalation.review")).toBe(false);
  });

  it("a non-super-admin's 'clear all' keeps sensitive grants and is audited", async () => {
    as("admin");
    // An ordinary override the admin may manage, next to the sensitive grants a super-admin made.
    expect(await matrix.setFieldPermission("collection.followup.write", "employee", ids.admin2, false)).toEqual({ ok: true });
    const before = await count(`select count(*)::int as n from field_permission_grants where subject_id = $1`, [ids.admin2]);
    const res = await matrix.clearFieldSubject("employee", ids.admin2);
    expect(res.ok).toBe(true);
    const kept = await pg.query<{ field_key: string }>(`select field_key from field_permission_grants where subject_id = $1 order by field_key`, [ids.admin2]);
    expect(kept.rows.map((r) => r.field_key)).toEqual(["collection.commitments.edit", "collection.escalation.close", "collection.escalation.review"]);
    expect(before - kept.rows.length).toBe(1);
    expect(res.ok && "keptSensitive" in res && res.keptSensitive).toBe(3);
    const audit = (await pg.query<{ event_type: string; actor_id: string }>(`select event_type, actor_id from settings_events order by created_at desc limit 1`)).rows[0]!;
    expect(audit).toEqual({ event_type: "cleared", actor_id: ids.admin });
  });
});

describe("permissions outside Collection are unchanged", () => {
  it("an admin still sets an ordinary field permission (audited now), and it still applies", async () => {
    as("admin");
    expect(await matrix.setFieldPermission("enquiry.avg_rate", "employee", ids.plain, true)).toEqual({ ok: true });
    as("plain");
    expect((await fieldAccess.getMyFieldAccess())["enquiry.avg_rate"]).toEqual({ allowed: true, source: "employee" });
    expect((await fieldAccess.getMyFieldAccess())["forecast.avg_rate"]).toEqual({ allowed: false, source: "default" });
    as("super");
    expect((await fieldAccess.getMyFieldAccess())["master.customer"]).toEqual({ allowed: true, source: "super-admin" });
    as("admin");
    expect((await fieldAccess.getMyFieldAccess())["master.customer"]).toEqual({ allowed: true, source: "admin" });
  });
});

describe("sensitive capabilities have no department layer", () => {
  const LEGACY = "Legacy Collections";
  let legacyDept = "";
  let otherDept = "";
  /** The signed-in employee as the database has it NOW (incl. the legacy department_id the resolver reads). */
  const asStored = async (id: string) => {
    const r = (await pg.query<{ email: string; is_active: boolean; is_admin: boolean; name: string; department_id: string | null }>(
      `select email, is_active, is_admin, name, department_id from employees where id = $1`,
      [id],
    )).rows[0]!;
    h.me = { id, email: r.email, isActive: r.is_active, isAdmin: r.is_admin, name: r.name, departmentId: r.department_id };
  };
  const newAdmin = async (name: string) =>
    (await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', true) returning id`, [name, `${name.toLowerCase()}@example.test`])).rows[0]!.id;
  let dina = "";
  let eli = "";
  let employeesActions: typeof import("@/app/(admin)/admin/employees/actions");
  let moduleAccess: typeof import("@/lib/auth/module-access");

  beforeAll(async () => {
    legacyDept = (await pg.query<{ id: string }>(`insert into departments (name) values ($1) returning id`, [LEGACY])).rows[0]!.id;
    otherDept = (await pg.query<{ id: string }>(`insert into departments (name) values ('Dispatch') returning id`)).rows[0]!.id;
    // Legacy rows written before this change (allow AND deny), directly — the action no longer accepts them.
    for (const k of SENSITIVE) {
      await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ($1, 'department', $2, true)`, [k, legacyDept]);
    }
    dina = await newAdmin("Dina");
    eli = await newAdmin("Eli");
    employeesActions = await import("@/app/(admin)/admin/employees/actions");
    moduleAccess = await import("@/lib/auth/module-access");
  });

  it("a department-level sensitive grant or deny is refused — for an admin AND a super-admin — with nothing written or audited", async () => {
    const before = [await count(`select count(*)::int as n from field_permission_grants`), await count(`select count(*)::int as n from settings_events`)];
    for (const who of ["admin", "super"] as const) {
      as(who);
      for (const k of SENSITIVE) {
        for (const value of [true, false]) {
          expect(await matrix.setFieldPermission(k, "department", otherDept, value)).toEqual({
            ok: false,
            error: "Sensitive permissions can be granted only to a person or organisation-wide, not to a department.",
          });
        }
      }
    }
    expect([await count(`select count(*)::int as n from field_permission_grants`), await count(`select count(*)::int as n from settings_events`)]).toEqual(before);
  });

  it("an admin self-assigning into a department with legacy sensitive grants (real editEmployee) gains nothing", async () => {
    await asStored(dina);
    expect(await employeesActions.editEmployee(dina, { departmentIds: [legacyDept], primaryDepartmentId: legacyDept })).toEqual({ ok: true });
    expect(await count(`select count(*)::int as n from employee_departments where employee_id = $1 and department_id = $2`, [dina, legacyDept])).toBe(1);
    await asStored(dina); // now carries the legacy department_id too
    expect(h.me?.departmentId).toBe(legacyDept);
    for (const k of SENSITIVE) expect(await allowed(k)).toBe(false);
  });

  it("assigning another employee into it (real editEmployee) gains them nothing either", async () => {
    await asStored(ids.admin);
    expect(await employeesActions.editEmployee(eli, { departmentIds: [legacyDept] })).toEqual({ ok: true });
    await asStored(eli);
    for (const k of SENSITIVE) expect(await allowed(k)).toBe(false);
  });

  it("a direct person-level grant still works — through the super-admin path only", async () => {
    await asStored(ids.admin);
    expect((await matrix.setFieldPermission("collection.escalation.review", "employee", eli, true)).ok).toBe(false);
    as("super");
    expect(await matrix.setFieldPermission("collection.escalation.review", "employee", eli, true)).toEqual({ ok: true });
    await asStored(eli);
    expect(await allowed("collection.escalation.review")).toBe(true);
    expect(await allowed("collection.escalation.close")).toBe(false); // the legacy department row is still ignored
  });

  it("ordinary department grants and department module access still apply", async () => {
    await asStored(ids.admin);
    expect(await matrix.setFieldPermission("collection.followup.write", "department", legacyDept, false)).toEqual({ ok: true });
    await pg.query(`insert into module_access_grants (module_id, subject_type, subject_id, allowed) values ('targets', 'department', $1, false)`, [legacyDept]);
    await asStored(dina);
    expect(await allowed("collection.followup.write")).toBe(false); // the department deny beats the admin default
    expect(await allowed("collection.view")).toBe(true);
    const testDb = h.db as Awaited<ReturnType<typeof createTestDb>>["db"];
    const [stored] = await testDb.select().from(schema.employees).where(eq(schema.employees.id, dina));
    const access = await moduleAccess.getModuleAccessFor(stored!);
    expect(access.targets).toEqual({ allowed: false, source: "department" });
  });

  it("only a super-admin can clear a legacy sensitive department row; the clear is audited, and fails closed if the audit can't be written", async () => {
    await asStored(ids.admin);
    expect(await matrix.setFieldPermission("collection.commitments.view", "department", legacyDept, null)).toEqual({ ok: false, error: "Only a super-admin can grant or revoke this permission." });
    const stillThere = `select count(*)::int as n from field_permission_grants where field_key = 'collection.commitments.view' and subject_type = 'department' and subject_id = $1`;
    expect(await count(stillThere, [legacyDept])).toBe(1);

    as("super");
    // Audit unavailable → the clear is rolled back with it.
    await pg.exec(`alter table settings_events add constraint test_block_field_access check (scope <> 'field_access') not valid`);
    expect((await matrix.setFieldPermission("collection.commitments.view", "department", legacyDept, null)).ok).toBe(false);
    expect(await count(stillThere, [legacyDept])).toBe(1);
    await pg.exec(`alter table settings_events drop constraint test_block_field_access`);

    expect(await matrix.setFieldPermission("collection.commitments.view", "department", legacyDept, null)).toEqual({ ok: true });
    expect(await count(stillThere, [legacyDept])).toBe(0);
    const audit = (await pg.query<{ actor_id: string; from_value: { allowed: boolean }; to_value: { allowed: null; subjectType: string } }>(
      `select actor_id, from_value, to_value from settings_events order by created_at desc limit 1`,
    )).rows[0]!;
    expect(audit).toMatchObject({ actor_id: ids.super, from_value: { allowed: true }, to_value: { allowed: null, subjectType: "department" } });
    // The other four legacy sensitive rows are untouched — nothing is deleted silently.
    const left = await pg.query<{ field_key: string }>(
      `select field_key from field_permission_grants where subject_type = 'department' and subject_id = $1 order by field_key`,
      [legacyDept],
    );
    expect(left.rows.map((r) => r.field_key)).toEqual([
      "collection.commitments.edit",
      "collection.coordinator.assign",
      "collection.escalation.close",
      "collection.escalation.review",
      "collection.followup.write", // the ordinary department grant set above
    ]);
  });
});
