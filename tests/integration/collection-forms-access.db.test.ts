import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite) of Collection and Forms access. The module resolver, the capability guards,
// the layouts and the server actions are all the real code, reading real grant rows stored as the Access and Field
// Permissions pages store them. Only "who is signed in" is mocked. Nothing here can reach a shared database.
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | { id: string; email: string; name: string; isActive: boolean; isAdmin: boolean; departmentId: null } };
});
vi.mock("server-only", () => ({}));
// Company visibility (lib/collections/scope-server.ts) is not under test here: every company is in scope. The real
// resolver, over real coordinator links, is covered by tests/integration/collection-tracker-scope.db.test.ts.
vi.mock("@/lib/collections/scope-server", () => ({ collectionScopeFor: async () => ({ kind: "all" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), unstable_cache: (f: unknown) => f, updateTag: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/db", () => ({
  get db() {
    return h.db;
  },
}));
vi.mock("@/lib/auth/current", () => ({
  getCurrentEmployee: async () => h.me,
  requireUser: async () => h.me,
  requireAdmin: async () => {
    if (!h.me?.isActive || !h.me.isAdmin) throw new Error("Forbidden");
    return h.me;
  },
}));
vi.mock("@/lib/queries/org-settings", () => ({ getOrgSettings: async () => ({ idleTimeoutMinutes: 10 }) }));
vi.mock("@/components/auth/idle-timer-client", () => ({ IdleTimerClient: () => null }));
vi.mock("@/components/layout/header", () => ({ DashboardHeader: () => null }));
vi.mock("@/components/forms/forms-sidebar", () => ({ FormsSidebar: () => null, FormsMobileNav: () => null }));
vi.mock("@/components/collections/collection-sidebar", () => ({ CollectionSidebar: (p: unknown) => p, CollectionMobileNav: () => null }));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let staff: string;
let admin: string;
let auth: typeof import("@/lib/auth/capability");
let CollectionLayout: (typeof import("@/app/(collection-module)/collection/layout"))["default"];
let FormsLayout: (typeof import("@/app/(forms-module)/forms/layout"))["default"];
let collection: typeof import("@/app/(collection-module)/collection/actions");
let kyc: typeof import("@/app/(forms-module)/forms/client-kyc/actions");
let exportXlsx: (typeof import("@/app/(forms-module)/forms/client-kyc/export.xlsx/route"))["GET"];

const grantModule = (moduleId: string, id: string, allowed = true) => pg.query(`insert into module_access_grants (module_id, subject_type, subject_id, allowed) values ($1, 'employee', $2, $3)`, [moduleId, id, allowed]);
const grantField = (key: string, id: string) => pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ($1, 'employee', $2, true)`, [key, id]);
const signIn = (id: string, isAdmin: boolean) => (h.me = { id, email: `${id}@example.test`, name: "Someone", isActive: true, isAdmin, departmentId: null });
const asStaff = () => signIn(staff, false);
const asAdmin = () => signIn(admin, true);

/** A direct URL: the page's layout, which redirects to the hub with ?denied=<module>. */
const opens = async (layout: (p: { children: null }) => Promise<unknown>) => {
  try {
    await layout({ children: null });
    return "opens";
  } catch (err) {
    const digest = (err as { digest?: string }).digest ?? "";
    if (digest.startsWith("NEXT_REDIRECT")) return digest.split(";")[2];
    throw err;
  }
};
const FOLLOW_UP = { partyName: "Alpha Traders", note: "Called" };

beforeAll(async () => {
  const made = await createTestDb({
    employees: schema.employees,
    departments: schema.departments,
    employeeDepartments: schema.employeeDepartments,
    fieldPermissionGrants: schema.fieldPermissionGrants,
    customerMasters: schema.customerMasters,
    lookupItems: schema.lookupItems,
    collectionFollowups: schema.collectionFollowups,
    collectionMasterImports: schema.collectionMasterImports,
    collectionMasterCompanies: schema.collectionMasterCompanies,
  });
  pg = made.pg;
  h.db = made.db;
  const emp = async (name: string, isAdmin: boolean) => (await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', $3) returning id`, [name, `${name}@example.test`, isAdmin])).rows[0]!.id;
  staff = await emp("staff", false);
  admin = await emp("admin", true);
  await pg.query(`insert into collection_master_companies (company_name, name_key) values ('Alpha Traders', 'alphatraders')`);
  auth = await import("@/lib/auth/capability");
  CollectionLayout = (await import("@/app/(collection-module)/collection/layout")).default;
  FormsLayout = (await import("@/app/(forms-module)/forms/layout")).default;
  collection = await import("@/app/(collection-module)/collection/actions");
  kyc = await import("@/app/(forms-module)/forms/client-kyc/actions");
  exportXlsx = (await import("@/app/(forms-module)/forms/client-kyc/export.xlsx/route")).GET;
}, 120_000);
afterAll(async () => {
  await pg.close();
});
beforeEach(async () => {
  await pg.exec("delete from module_access_grants; delete from field_permission_grants; delete from collection_followups;");
  asStaff();
});

describe("the test database matches production's module grants", () => {
  it("refuses what 0076's constraints refuse", async () => {
    await expect(pg.query(`insert into module_access_grants (module_id, subject_type, subject_id, allowed) values ('forms', 'employee', null, true)`)).rejects.toThrow(/module_access_grants_subject_ck/);
    await grantModule("forms", staff);
    await expect(grantModule("forms", staff)).rejects.toThrow(/module_access_grants_subject_uq/);
  });
});

describe("a member of staff, through each entry point", () => {
  it("with neither module: both URLs bounce to the hub and both sets of actions refuse", async () => {
    await grantField("collection.view", staff);
    await grantField("collection.followup.write", staff);
    expect(await opens(CollectionLayout)).toBe("/hub?denied=collection");
    expect(await opens(FormsLayout)).toBe("/hub?denied=forms");
    await expect(auth.requireCollectionCapability("collection.view")).rejects.toThrow("Forbidden");
    await expect(collection.saveFollowUp(FOLLOW_UP)).rejects.toThrow("Forbidden");
    expect(await kyc.addKycLookupOption("x" as never, "New")).toEqual({ ok: false, error: "You don't have access to Forms." });
    expect((await exportXlsx()).status).toBe(403);
    expect(await pg.query(`select 1 from collection_followups`)).toMatchObject({ rows: [] });
  });

  it("with Forms but not Collection: Forms opens, Collection stays shut even with its section permissions", async () => {
    await grantModule("forms", staff);
    await grantField("collection.view", staff);
    await grantField("collection.followup.write", staff);
    expect(await opens(FormsLayout)).toBe("opens");
    expect(await opens(CollectionLayout)).toBe("/hub?denied=collection");
    await expect(collection.saveFollowUp(FOLLOW_UP)).rejects.toThrow("Forbidden");
    expect(Object.values(await auth.getCollectionCapabilities()).every((v) => v === false)).toBe(true);
  });

  it("with Collection but not Forms: Collection opens, Forms stays shut", async () => {
    await grantModule("collection", staff);
    expect(await opens(CollectionLayout)).toBe("opens");
    expect(await opens(FormsLayout)).toBe("/hub?denied=forms");
    expect(await kyc.addKycLookupOption("x" as never, "New")).toEqual({ ok: false, error: "You don't have access to Forms." });
    expect((await exportXlsx()).status).toBe(403);
  });

  it("with the Collection module alone: the door opens but no section does", async () => {
    await grantModule("collection", staff);
    await expect(auth.requireCollectionCapability("collection.view")).rejects.toThrow("Forbidden");
    await expect(collection.saveFollowUp(FOLLOW_UP)).rejects.toThrow("Forbidden");
    expect(Object.values(await auth.getCollectionCapabilities()).every((v) => v === false)).toBe(true);
  });

  it("with the module and one permission: exactly that section, recorded against the session", async () => {
    await grantModule("collection", staff);
    await grantField("collection.view", staff);
    await grantField("collection.followup.write", staff);
    await expect(auth.requireCollectionCapability("collection.view")).resolves.toEqual({ employeeId: staff, capability: "collection.view" });
    await expect(auth.requireCollectionCapability("collection.commitments.view")).rejects.toThrow("Forbidden");
    await expect(collection.saveFollowUp({ ...FOLLOW_UP, createdById: admin })).resolves.toMatchObject({ ok: false }); // a forged author is rejected
    await expect(collection.saveFollowUp(FOLLOW_UP)).resolves.toEqual({ ok: true });
    expect((await pg.query<{ created_by_id: string }>(`select created_by_id from collection_followups`)).rows).toEqual([{ created_by_id: staff }]);
  });

  it("revoking the module stops the next request; the permissions are left as they were", async () => {
    await grantModule("collection", staff);
    await grantField("collection.view", staff);
    await expect(auth.requireCollectionCapability("collection.view")).resolves.toBeTruthy();
    await pg.exec("delete from module_access_grants");
    await expect(auth.requireCollectionCapability("collection.view")).rejects.toThrow("Forbidden");
    expect(await opens(CollectionLayout)).toBe("/hub?denied=collection");
    expect((await pg.query(`select 1 from field_permission_grants`)).rows).toHaveLength(1);
  });

  it("nobody is granted either module by default, and an org-wide On for one doesn't open the other", async () => {
    await pg.query(`insert into module_access_grants (module_id, subject_type, subject_id, allowed) values ('forms', 'everyone', null, true)`);
    expect(await opens(FormsLayout)).toBe("opens");
    expect(await opens(CollectionLayout)).toBe("/hub?denied=collection");
  });
});

describe("an admin", () => {
  it("keeps both through the real admin bypass, with no grant rows at all", async () => {
    asAdmin();
    await grantField("collection.view", admin);
    expect(await opens(CollectionLayout)).toBe("opens");
    expect(await opens(FormsLayout)).toBe("opens");
    await expect(auth.requireCollectionCapability("collection.view")).resolves.toBeTruthy();
  });

  it("a person-level Off for one module blocks only that module", async () => {
    asAdmin();
    await grantField("collection.view", admin);
    await grantModule("collection", admin, false);
    expect(await opens(CollectionLayout)).toBe("/hub?denied=collection");
    await expect(auth.requireCollectionCapability("collection.view")).rejects.toThrow("Forbidden");
    expect(await opens(FormsLayout)).toBe("opens");
  });

  it("the sensitive section permissions are not implied by the module", async () => {
    asAdmin();
    await expect(auth.requireCollectionCapability("collection.balances.import")).rejects.toThrow("Forbidden");
    await expect(auth.requireCollectionCapability("collection.commitments.view")).rejects.toThrow("Forbidden");
  });
});
