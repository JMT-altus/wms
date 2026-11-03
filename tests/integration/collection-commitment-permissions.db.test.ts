import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite) of the two separate commitment permissions, through the REAL permission
// resolver reading real grant rows exactly as Field Permissions stores them, the real Collection layout (rail), the real
// Tracker and Commitments & Escalations pages, and the real server actions. Only "who is signed in" is mocked.
//
//   collection.commitments.view / .edit  → the Commitment section in a company's popup (Collection Tracker)
//   collection.commitments.page          → the Commitments & Escalations page (Collection rail)
//
// All three are sensitive: explicit grants only (a person, or organisation-wide), never implied by admin status, and none
// implies another. Nothing here can reach a shared or production database; no identity is hard-coded anywhere.
type Me = { id: string; isAdmin: boolean; isActive: boolean; email: string; name: string; departmentId: null };
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | Me };
});
vi.mock("server-only", () => ({}));
// Company visibility (lib/collections/scope-server.ts) is not under test here: every company is in scope. The real
// resolver, over real coordinator links, is covered by tests/integration/collection-tracker-scope.db.test.ts.
vi.mock("@/lib/collections/scope-server", () => ({ collectionScopeFor: async () => ({ kind: "all" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw Object.assign(new Error("NEXT_NOT_FOUND"), { digest: "NEXT_NOT_FOUND" });
  },
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT:${url}`), { digest: `NEXT_REDIRECT;replace;${url};307;` });
  },
}));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/db", () => ({
  get db() {
    if (!h.db) throw new Error("test database not ready");
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
vi.mock("@/lib/auth/super-admin", () => ({ isSuperAdmin: (email: string | null | undefined) => email === "super@example.test" }));
vi.mock("@/lib/queries/org-settings", () => ({ getOrgSettings: async () => ({ idleTimeoutMinutes: 10 }) }));
vi.mock("@/components/auth/idle-timer-client", () => ({ IdleTimerClient: () => null }));
vi.mock("@/components/layout/header", () => ({ DashboardHeader: () => null }));
vi.mock("@/components/collections/collection-sidebar", () => ({ CollectionSidebar: (p: unknown) => p, CollectionMobileNav: () => null }));
vi.mock("@/components/collections/collection-tracker", () => ({ CollectionTracker: () => null }));
vi.mock("@/components/collections/commitments-table", () => ({ CommitmentsTable: () => null }));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let matrix: typeof import("@/app/(masters)/master-setup/actions");
let commitments: typeof import("@/app/(collection-module)/collection/commitments/actions");
let tracker: typeof import("@/app/(collection-module)/collection/actions");
let CollectionLayout: (typeof import("@/app/(collection-module)/collection/layout"))["default"];
let CommitmentsPage: (typeof import("@/app/(collection-module)/collection/commitments/page"))["default"];
let EscalationsPage: (typeof import("@/app/(collection-module)/collection/escalations/page"))["default"];
let TrackerPage: (typeof import("@/app/(collection-module)/collection/tracker/page"))["default"];
const ids: Record<string, string> = {};
let ALPHA = "";

const as = (who: "staff" | "other" | "admin" | "superAdmin") => (h.me = { id: ids[who]!, isAdmin: who === "admin" || who === "superAdmin", isActive: true, email: who === "superAdmin" ? "super@example.test" : `${who}@example.test`, name: who, departmentId: null });
/** A grant exactly as the matrix stores it (the super-admin path is what writes sensitive grants in the app; here the rows are written directly, as the matrix would). */
const grant = (key: string, subject: "everyone" | "employee", id: string | null, allowed: boolean) => pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ($1, $2, $3, $4)`, [key, subject, id, allowed]);
const clearGrants = () => pg.exec("delete from field_permission_grants");
const outcome = async (p: Promise<unknown>) => {
  try {
    await p;
    return "opens";
  } catch (err) {
    const e = err as { digest?: string; message?: string };
    if (e.digest?.startsWith("NEXT_REDIRECT")) return e.digest.split(";")[2];
    if (e.digest === "NEXT_NOT_FOUND") return "not found";
    return e.message;
  }
};
function findProps(node: ReactNode, name: string): Record<string, unknown> | null {
  if (!isValidElement(node)) return null;
  const el = node as ReactElement<Record<string, unknown> & { children?: ReactNode }>;
  if (typeof el.type === "function" && (el.type as { name?: string }).name === name) return el.props;
  const kids = el.props.children;
  for (const k of Array.isArray(kids) ? kids : [kids]) {
    const f = findProps(k as ReactNode, name);
    if (f) return f;
  }
  return null;
}
/** What the rail is told (the real layout decides from the real resolver). */
const rail = async () => {
  const tree = await CollectionLayout({ children: null });
  return findProps(tree, "CollectionSidebar") as { showCommitments: boolean; showEscalations: boolean; showCollection: boolean } | null;
};
/** What the Tracker page tells the popup. */
const popupFlags = async () => {
  const props = findProps(await TrackerPage(), "CollectionTracker")!;
  return { view: props.canSeeCommitments as boolean, record: props.canEditCommitments as boolean, reviewQueue: props.reviewQueue };
};

beforeAll(async () => {
  const made = await createTestDb({
    employees: schema.employees,
    customerMasters: schema.customerMasters,
    departments: schema.departments,
    employeeDepartments: schema.employeeDepartments,
    fieldPermissionGrants: schema.fieldPermissionGrants,
    settingsEvents: schema.settingsEvents,
    collectionMasterImports: schema.collectionMasterImports,
    collectionMasterCompanies: schema.collectionMasterCompanies,
    collectionFollowups: schema.collectionFollowups,
    collectionCommitments: schema.collectionCommitments,
    collectionAmountConfirmations: schema.collectionAmountConfirmations,
    collectionConfirmedAmounts: schema.collectionConfirmedAmounts,
    collectionEscalations: schema.collectionEscalations,
  });
  pg = made.pg;
  h.db = made.db;
  const emp = async (name: string, isAdmin: boolean, email = `${name}@example.test`) => (await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', $3) returning id`, [name, email, isAdmin])).rows[0]!.id;
  ids.staff = await emp("staff", false);
  ids.other = await emp("other", false);
  ids.admin = await emp("admin", true);
  ids.superAdmin = await emp("superAdmin", true, "super@example.test");
  // Ordinary staff enter the Collection module by grant (admins through the bypass); every Collection screen needs collection.view.
  for (const who of ["staff", "other"]) await pg.query(`insert into module_access_grants (module_id, subject_type, subject_id, allowed) values ('collection', 'employee', $1, true)`, [ids[who]]);
  ALPHA = (await pg.query<{ id: string }>(`insert into collection_master_companies (company_name, name_key, coordinator_label) values ('Alpha Traders', 'alphatraders', 'MANGESH') returning id`)).rows[0]!.id;
  matrix = await import("@/app/(masters)/master-setup/actions");
  commitments = await import("@/app/(collection-module)/collection/commitments/actions");
  tracker = await import("@/app/(collection-module)/collection/actions");
  CollectionLayout = (await import("@/app/(collection-module)/collection/layout")).default;
  CommitmentsPage = (await import("@/app/(collection-module)/collection/commitments/page")).default;
  EscalationsPage = (await import("@/app/(collection-module)/collection/escalations/page")).default;
  TrackerPage = (await import("@/app/(collection-module)/collection/tracker/page")).default;
}, 180_000);
afterAll(async () => {
  await pg?.close();
});
beforeEach(async () => {
  await clearGrants();
  await grant("collection.view", "everyone", null, true); // the Tracker itself, for everyone in the module
  as("staff");
});

describe("the registry", () => {
  it("has three independent, sensitive, default-off keys with labels an administrator cannot confuse", async () => {
    const { PERMISSION_FIELDS } = await import("@/db/enums");
    const by = Object.fromEntries(PERMISSION_FIELDS.map((f) => [f.key, f]));
    expect(by["collection.commitments.view"]).toMatchObject({ label: "Collection Tracker — Company Popup — Commitment Section: View", group: "Collections", sensitive: true, defaultAllowed: false, adminBypass: false, superAdminBypass: false });
    expect(by["collection.commitments.edit"]).toMatchObject({ label: "Collection Tracker — Company Popup — Commitment Section: Record", group: "Collections", sensitive: true, defaultAllowed: false });
    expect(by["collection.commitments.page"]).toMatchObject({ label: "Collection — Commitments Page Access", group: "Collections", sensitive: true, defaultAllowed: false, adminBypass: false, superAdminBypass: false });
    // No name, email or identity anywhere in the registry entries or the guards.
    const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
    for (const p of ["db/enums.ts", "app/(collection-module)/collection/commitments/page.tsx", "app/(collection-module)/collection/escalations/page.tsx", "lib/collections/review-rows.ts", "app/(collection-module)/collection/commitments/actions.ts", "app/(collection-module)/collection/layout.tsx", "lib/auth/capability.ts"]) {
      expect(read(p), p).not.toMatch(/mihir|@gmail|@jmt/i);
    }
  });
});

describe("the company popup's Commitment section (Permission A)", () => {
  it("organisation-wide On lets every eligible employee see and record; the page stays shut", async () => {
    await grant("collection.commitments.view", "everyone", null, true);
    await grant("collection.commitments.edit", "everyone", null, true);
    for (const who of ["staff", "other", "admin"] as const) {
      as(who);
      expect(await popupFlags(), who).toMatchObject({ view: true, record: true });
      expect(await commitments.getCompanyCommitment(ALPHA)).toMatchObject({ ok: true, commitment: null });
      expect(await outcome(CommitmentsPage()), who).toBe("not found");
      expect((await rail())?.showCommitments, who).toBe(false);
    }
    as("staff");
    const saved = await commitments.saveCompanyCommitment({ companyId: ALPHA, amount: "125000.50", committedDate: "2099-11-05" });
    expect(saved).toMatchObject({ ok: true, commitment: { amount: "125000.50", committedDate: "2099-11-05" } });
    expect((await commitments.getCompanyCommitment(ALPHA)).ok && (await commitments.getCompanyCommitment(ALPHA))).toMatchObject({ commitment: { amount: "125000.50" } });
  });

  it("organisation-wide Off: nobody sees it (admins and super-admins included) and the actions refuse before any data is read", async () => {
    await grant("collection.commitments.view", "everyone", null, false);
    for (const who of ["staff", "admin", "superAdmin"] as const) {
      as(who);
      expect(await popupFlags(), who).toMatchObject({ view: false, record: false });
      await expect(commitments.getCompanyCommitment(ALPHA)).rejects.toThrow("Forbidden");
      await expect(commitments.saveCompanyCommitment({ companyId: ALPHA, amount: "1", committedDate: "2099-01-01" })).rejects.toThrow("Forbidden");
    }
  });

  it("an individual Allow works with organisation-wide Off; an individual Deny beats organisation-wide On", async () => {
    await grant("collection.commitments.view", "employee", ids.staff!, true);
    as("staff");
    expect(await popupFlags()).toMatchObject({ view: true, record: false }); // view only: no Record
    expect(await commitments.getCompanyCommitment(ALPHA)).toMatchObject({ ok: true });
    await expect(commitments.saveCompanyCommitment({ companyId: ALPHA, amount: "1", committedDate: "2099-01-01" })).rejects.toThrow("Forbidden");
    as("other");
    expect(await popupFlags()).toMatchObject({ view: false, record: false });
    await expect(commitments.getCompanyCommitment(ALPHA)).rejects.toThrow("Forbidden");
    // Everyone On, but this person Off.
    await clearGrants();
    await grant("collection.view", "everyone", null, true);
    await grant("collection.commitments.view", "everyone", null, true);
    await grant("collection.commitments.edit", "everyone", null, true);
    await grant("collection.commitments.view", "employee", ids.other!, false);
    await grant("collection.commitments.edit", "employee", ids.other!, false);
    as("other");
    expect(await popupFlags()).toMatchObject({ view: false, record: false });
    await expect(commitments.getCompanyCommitment(ALPHA)).rejects.toThrow("Forbidden");
    await expect(commitments.saveCompanyCommitment({ companyId: ALPHA, amount: "1", committedDate: "2099-01-01" })).rejects.toThrow("Forbidden");
    as("staff");
    expect(await popupFlags()).toMatchObject({ view: true, record: true });
  });

  it("the page key alone never opens the popup section", async () => {
    await grant("collection.commitments.page", "employee", ids.staff!, true);
    as("staff");
    expect(await popupFlags()).toMatchObject({ view: false, record: false });
    await expect(commitments.getCompanyCommitment(ALPHA)).rejects.toThrow("Forbidden");
  });
});

describe("the Commitments page (Permission B) and the separate Escalations page", () => {
  it("is shut by default — rail entry hidden, direct URL not found — for staff, admins and super-admins, whatever else they hold", async () => {
    await grant("collection.commitments.view", "everyone", null, true);
    await grant("collection.commitments.edit", "everyone", null, true);
    await grant("collection.escalation.review", "employee", ids.admin!, true);
    for (const who of ["staff", "admin", "superAdmin"] as const) {
      as(who);
      expect((await rail())?.showCommitments, who).toBe(false);
      expect(await outcome(CommitmentsPage()), who).toBe("not found");
    }
    // Review opens the separate Escalations page instead (its own rail entry), never the Commitments page.
    as("admin");
    expect((await rail())?.showEscalations).toBe(true);
    expect(await outcome(EscalationsPage())).toBe("opens");
    expect((await popupFlags()).reviewQueue).toEqual({ openCount: 0, href: "/collection/escalations" });
    as("staff");
    expect((await rail())?.showEscalations).toBe(false);
    expect(await outcome(EscalationsPage())).toBe("not found");
  });

  it("an individually authorised employee sees the rail entry and opens the page; revoking it stops the next request", async () => {
    await grant("collection.commitments.page", "employee", ids.staff!, true);
    await grant("collection.commitments.view", "everyone", null, true);
    as("staff");
    expect((await rail())?.showCommitments).toBe(true);
    const props = findProps(await CommitmentsPage(), "CommitmentsTable")!;
    expect(props).toMatchObject({ showCommitments: true, showEscalations: false });
    as("other");
    expect((await rail())?.showCommitments).toBe(false);
    expect(await outcome(CommitmentsPage())).toBe("not found");
    // Revoke (explicit deny) and clear: both stop the next request.
    as("staff");
    await pg.query(`update field_permission_grants set allowed = false where field_key = 'collection.commitments.page' and subject_id = $1`, [ids.staff]);
    expect((await rail())?.showCommitments).toBe(false);
    expect(await outcome(CommitmentsPage())).toBe("not found");
    await pg.query(`delete from field_permission_grants where field_key = 'collection.commitments.page'`);
    expect(await outcome(CommitmentsPage())).toBe("not found");
  });

  it("organisation-wide On opens it for everyone in the module; a person-level Deny still shuts it for that person", async () => {
    await grant("collection.commitments.page", "everyone", null, true);
    await grant("collection.commitments.page", "employee", ids.other!, false);
    as("staff");
    expect((await rail())?.showCommitments).toBe(true);
    expect(await outcome(CommitmentsPage())).toBe("opens");
    as("other");
    expect((await rail())?.showCommitments).toBe(false);
    expect(await outcome(CommitmentsPage())).toBe("not found");
    // Without the Collection module the page is refused before the key is even consulted.
    await pg.query(`update module_access_grants set allowed = false where subject_id = $1`, [ids.staff]);
    as("staff");
    expect(await outcome(CommitmentsPage())).toBe("not found");
    await pg.query(`update module_access_grants set allowed = true where subject_id = $1`, [ids.staff]);
  });

  it("each page shows only its own records: commitments with the popup View key, escalations with Review on their own page; closing still needs Close", async () => {
    await grant("collection.commitments.page", "employee", ids.staff!, true);
    as("staff");
    let props = findProps(await CommitmentsPage(), "CommitmentsTable")!;
    expect(props).toMatchObject({ showCommitments: false, showEscalations: false, canClose: false, rows: [] });
    await grant("collection.escalation.review", "employee", ids.staff!, true);
    // Review never adds escalations to the Commitments page; it opens the Escalations page.
    props = findProps(await CommitmentsPage(), "CommitmentsTable")!;
    expect(props).toMatchObject({ showCommitments: false, showEscalations: false });
    props = findProps(await EscalationsPage(), "CommitmentsTable")!;
    expect(props).toMatchObject({ showCommitments: false, showEscalations: true, canClose: false });
    expect((await popupFlags()).reviewQueue).toEqual({ openCount: 0, href: "/collection/escalations" });
    await grant("collection.commitments.view", "employee", ids.staff!, true);
    props = findProps(await CommitmentsPage(), "CommitmentsTable")!;
    expect(props).toMatchObject({ showCommitments: true, showEscalations: false });
    expect((props.rows as { companyName: string; amount: string | null }[]).map((r) => [r.companyName, r.amount])).toEqual([["Alpha Traders", "125000.50"]]); // the commitment recorded earlier is still there
    // The Escalations page still reads no commitment, even for someone who may see them.
    expect((findProps(await EscalationsPage(), "CommitmentsTable")!.rows as unknown[]).length).toBe(0);
    await grant("collection.escalation.close", "employee", ids.staff!, true);
    expect(findProps(await EscalationsPage(), "CommitmentsTable")).toMatchObject({ canClose: true });
    expect(findProps(await CommitmentsPage(), "CommitmentsTable")).toMatchObject({ canClose: false });
  });
});

describe("the existing workflows and grants", () => {
  it("record → escalate → review → close still works end to end for people holding each capability", async () => {
    await grant("collection.commitments.view", "everyone", null, true);
    await grant("collection.commitments.edit", "everyone", null, true);
    await grant("collection.escalation.create", "everyone", null, true);
    await grant("collection.commitments.page", "employee", ids.admin!, true);
    await grant("collection.escalation.review", "employee", ids.admin!, true);
    await grant("collection.escalation.close", "employee", ids.admin!, true);
    as("staff");
    expect(await commitments.saveCompanyCommitment({ companyId: ALPHA, amount: "300000", committedDate: "2099-12-01" })).toMatchObject({ ok: true });
    expect(await tracker.escalateForReview({ companyId: ALPHA, reason: "Customer disputes the invoice amount." })).toEqual({ ok: true });
    as("admin");
    // The commitment on the Commitments page (no escalation there); the escalation on the Escalations page (no amount there).
    const committed = findProps(await CommitmentsPage(), "CommitmentsTable")!.rows as { companyName: string; amount: string | null; escalation: unknown }[];
    expect(committed).toHaveLength(1);
    expect(committed[0]).toMatchObject({ companyName: "Alpha Traders", amount: "300000.00", escalation: null });
    const rows = findProps(await EscalationsPage(), "CommitmentsTable")!.rows as { companyName: string; amount: string | null; escalation: { id: string; reason: string | null } | null }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ companyName: "Alpha Traders", amount: null, escalation: { reason: "Customer disputes the invoice amount." } });
    expect(await commitments.closeEscalation({ escalationId: rows[0]!.escalation!.id })).toEqual({ ok: true });
    as("staff");
    await expect(commitments.closeEscalation({ escalationId: rows[0]!.escalation!.id })).rejects.toThrow("Forbidden");
    // History is intact: both commitments ever recorded, the escalation closed, nothing deleted.
    expect((await pg.query(`select count(*)::int n from collection_commitments where company_id = $1`, [ALPHA])).rows).toEqual([{ n: 2 }]);
    expect((await pg.query(`select status from collection_escalations where company_id = $1`, [ALPHA])).rows).toEqual([{ status: "closed" }]);
  });

  it("the matrix writes the page key through the same audited super-admin path as every sensitive grant; a plain admin is refused", async () => {
    as("admin");
    expect(await matrix.setFieldPermission("collection.commitments.page", "employee", ids.staff!, true)).toMatchObject({ ok: false });
    as("superAdmin");
    expect(await matrix.setFieldPermission("collection.commitments.page", "employee", ids.staff!, true)).toEqual({ ok: true });
    expect(await matrix.setFieldPermission("collection.commitments.page", "everyone", null, false)).toEqual({ ok: true });
    expect((await matrix.setFieldPermission("collection.commitments.page", "department", ids.staff!, true)).ok).toBe(false); // sensitive: never a department
    const audit = await pg.query<{ n: number }>(`select count(*)::int n from settings_events where scope = 'field_access' and (coalesce(target_id, '') || coalesce(from_value::text, '') || coalesce(to_value::text, '')) like '%collection.commitments.page%'`);
    expect(audit.rows[0]!.n).toBeGreaterThanOrEqual(2);
    as("staff");
    expect(await outcome(CommitmentsPage())).toBe("opens"); // the person-level Allow beats the org-wide Off
  });
});
