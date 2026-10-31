import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite) of employee-wise company visibility in Collection: an ordinary login sees ONLY
// the Collection Master companies whose Sales Coordinator (`coordinator_label`) is the label a super-admin linked to that
// login (collection_coordinator_links); a super-admin sees every company; anyone unlinked sees none. The real scope
// resolver, loader, pages, queries and server actions run over real rows; only "who is signed in" is mocked, and the
// super-admin resolver is mocked to a test address (the production list is a code constant). No production identity
// appears anywhere here.
type Me = { id: string; isAdmin: boolean; isActive: boolean; email: string; name: string; departmentId: null };
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | Me };
});
vi.mock("server-only", () => ({}));
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
vi.mock("@/components/collections/collection-tracker", () => ({ CollectionTracker: () => null }));
vi.mock("@/components/collections/collection-dashboard", () => ({ CollectionDashboard: () => null }));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let tracker: typeof import("@/app/(collection-module)/collection/actions");
let commitments: typeof import("@/app/(collection-module)/collection/commitments/actions");
let master: typeof import("@/lib/queries/collection-master");
let scopeMod: typeof import("@/lib/collections/scope-server");
let TrackerPage: (typeof import("@/app/(collection-module)/collection/tracker/page"))["default"];
let DashboardPage: (typeof import("@/app/(collection-module)/collection/dashboard/page"))["default"];
let MasterPage: (typeof import("@/app/(collection-module)/collection/master/page"))["default"];
let MasterCompanyPage: (typeof import("@/app/(collection-module)/collection/master/[id]/page"))["default"];

/** Test identities only: four coordinators, one unlinked login, one login marked "not a coordinator", one super-admin. */
const PEOPLE = ["bhavisha", "jyotsna", "saroj", "gauri", "nolink", "notsales", "super"] as const;
type Who = (typeof PEOPLE)[number];
const LABEL: Partial<Record<Who, string>> = { bhavisha: "Bhavisha", jyotsna: "Jyotsna", saroj: "Saroj", gauri: "Gauri" };
const ids = {} as Record<Who, string>;
const co: Record<string, string> = {};
const as = (who: Who) => (h.me = { id: ids[who], isAdmin: who === "super" || who === "gauri", isActive: true, email: who === "super" ? "super@example.test" : `${who}@example.test`, name: who, departmentId: null });
const grant = (key: string, id: string | null, subject: "everyone" | "employee" = "employee") => pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ($1, $2, $3, true)`, [key, subject, id]);

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
const trackerRows = async () => {
  const props = findProps(await TrackerPage(), "CollectionTracker")!;
  return { names: (props.rows as { partyName: string }[]).map((r) => r.partyName).sort(), empty: props.emptyMessage as string | undefined, scopeNote: props.scopeNote as string | undefined };
};
const dashboardNames = async () => ((findProps(await DashboardPage(), "CollectionDashboard")!.rows as { partyName: string }[]).map((r) => r.partyName).sort());
const outcome = async (p: Promise<unknown>) => {
  try {
    await p;
    return "opens";
  } catch (err) {
    const e = err as { digest?: string; message?: string };
    return e.digest === "NEXT_NOT_FOUND" ? "not found" : e.message;
  }
};

beforeAll(async () => {
  const made = await createTestDb({
    employees: schema.employees,
    customerMasters: schema.customerMasters,
    departments: schema.departments,
    employeeDepartments: schema.employeeDepartments,
    fieldPermissionGrants: schema.fieldPermissionGrants,
    collectionMasterImports: schema.collectionMasterImports,
    collectionMasterCompanies: schema.collectionMasterCompanies,
    collectionCoordinatorLinks: schema.collectionCoordinatorLinks,
    collectionFollowups: schema.collectionFollowups,
    collectionCommitments: schema.collectionCommitments,
    collectionAmountConfirmations: schema.collectionAmountConfirmations,
    collectionConfirmedAmounts: schema.collectionConfirmedAmounts,
    collectionEscalations: schema.collectionEscalations,
  });
  pg = made.pg;
  h.db = made.db;
  for (const who of PEOPLE) {
    ids[who] = (await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', $3) returning id`, [who, who === "super" ? "super@example.test" : `${who}@example.test`, who === "super" || who === "gauri"])).rows[0]!.id;
    if (who !== "super") await pg.query(`insert into module_access_grants (module_id, subject_type, subject_id, allowed) values ('collection', 'employee', $1, true)`, [ids[who]]);
  }
  // The links a super-admin keeps: login → Sales Coordinator label. "notsales" is explicitly marked not a coordinator (NULL); "nolink" has no row.
  for (const who of ["bhavisha", "jyotsna", "saroj", "gauri"] as const) await pg.query(`insert into collection_coordinator_links (employee_id, coordinator_label, set_by_id) values ($1, $2, $3)`, [ids[who], LABEL[who], ids.super]);
  await pg.query(`insert into collection_coordinator_links (employee_id, coordinator_label, set_by_id) values ($1, null, $2)`, [ids.notsales, ids.super]);
  const company = async (name: string, label: string | null) => (co[name] = (await pg.query<{ id: string }>(`insert into collection_master_companies (company_name, name_key, coordinator_label) values ($1, $2, $3) returning id`, [name, name.toLowerCase().replace(/[^a-z0-9]/g, ""), label])).rows[0]!.id);
  await company("B One", "Bhavisha");
  await company("B Two", "Bhavisha");
  await company("J One", "Jyotsna");
  await company("S One", "Saroj");
  await company("G One", "Gauri");
  await company("G Two", "Gauri");
  await company("Unassigned Co", null);
  await company("Other Label Co", "Mangesh"); // a label no login is linked to
  // Ordinary Collection capabilities for everyone in the module; the commitment section for everyone too.
  for (const key of ["collection.view", "collection.followup.write", "collection.confirmation.set", "collection.escalation.create", "collection.commitments.view", "collection.commitments.edit"]) await grant(key, null, "everyone");
  tracker = await import("@/app/(collection-module)/collection/actions");
  commitments = await import("@/app/(collection-module)/collection/commitments/actions");
  master = await import("@/lib/queries/collection-master");
  scopeMod = await import("@/lib/collections/scope-server");
  TrackerPage = (await import("@/app/(collection-module)/collection/tracker/page")).default;
  DashboardPage = (await import("@/app/(collection-module)/collection/dashboard/page")).default;
  MasterPage = (await import("@/app/(collection-module)/collection/master/page")).default;
  MasterCompanyPage = (await import("@/app/(collection-module)/collection/master/[id]/page")).default;
}, 180_000);
afterAll(async () => {
  await pg?.close();
});
beforeEach(() => as("super"));

describe("who sees which companies", () => {
  it.each([
    ["bhavisha", ["B One", "B Two"]],
    ["jyotsna", ["J One"]],
    ["saroj", ["S One"]],
    ["gauri", ["G One", "G Two"]],
  ] as [Who, string[]][])("%s sees only the companies assigned to their linked Sales Coordinator — in the Tracker, the Dashboard and the Master", async (who, expected) => {
    as(who);
    const t = await trackerRows();
    expect(t.names).toEqual(expected);
    expect(t.scopeNote).toBe(`Showing the companies assigned to you as Sales Coordinator (${LABEL[who]}).`);
    expect(await dashboardNames()).toEqual(expected);
    const list = await master.listMasterCompanies({ scope: await scopeMod.collectionScopeFor() });
    expect(list.rows.map((r) => r.companyName).sort()).toEqual(expected);
    expect(list.total).toBe(expected.length);
  });

  it("an ordinary login never sees unassigned companies, another coordinator's companies, or a label nobody is linked to", async () => {
    as("gauri"); // an admin, but not a super-admin: an ordinary login here
    const t = await trackerRows();
    expect(t.names).not.toContain("Unassigned Co");
    expect(t.names).not.toContain("Other Label Co");
    expect(t.names).not.toContain("B One");
  });

  it("a login without a link, or marked not a Sales Coordinator, sees nothing and is told why", async () => {
    as("nolink");
    let t = await trackerRows();
    expect(t.names).toEqual([]);
    expect(t.empty).toMatch(/isn't linked to a Sales Coordinator yet/);
    expect((await master.listMasterCompanies({ scope: await scopeMod.collectionScopeFor() })).total).toBe(0);
    as("notsales");
    t = await trackerRows();
    expect(t.names).toEqual([]);
    expect(t.empty).toMatch(/marked as not a Sales Coordinator/);
  });

  it("a super-admin sees every company: assigned, unassigned and labels nobody is linked to — with no scope note", async () => {
    as("super");
    const t = await trackerRows();
    expect(t.names).toEqual(["B One", "B Two", "G One", "G Two", "J One", "Other Label Co", "S One", "Unassigned Co"]);
    expect(t.scopeNote).toBeUndefined();
    expect((await master.listMasterCompanies({ scope: await scopeMod.collectionScopeFor() })).total).toBe(8);
    expect((await master.listMasterCompanies({ scope: await scopeMod.collectionScopeFor(), coordinator: "unassigned" })).rows.map((r) => r.companyName)).toEqual(["Unassigned Co"]);
  });

  it("search, the unassigned filter and paging run inside the scope — a query term can't reach another coordinator's company", async () => {
    as("bhavisha");
    const scope = await scopeMod.collectionScopeFor();
    expect((await master.listMasterCompanies({ scope, query: "One" })).rows.map((r) => r.companyName)).toEqual(["B One"]);
    expect((await master.listMasterCompanies({ scope, query: "Gauri" })).total).toBe(0); // searching by the other coordinator's label
    expect((await master.listMasterCompanies({ scope, coordinator: "unassigned" })).total).toBe(0);
    expect((await master.listMasterCompanies({ scope, page: 1 })).rows).toEqual([]);
    expect((await master.listMasterCompanies({ scope, page: 0 })).total).toBe(2);
  });
});

describe("direct access by id or name", () => {
  it("the Master company page: own company opens; another coordinator's, an unassigned one and a guessed id are all 'not found'", async () => {
    as("bhavisha");
    expect(await outcome(MasterCompanyPage({ params: Promise.resolve({ id: co["B One"]! }) }))).toBe("opens");
    expect(await outcome(MasterCompanyPage({ params: Promise.resolve({ id: co["G One"]! }) }))).toBe("not found");
    expect(await outcome(MasterCompanyPage({ params: Promise.resolve({ id: co["Unassigned Co"]! }) }))).toBe("not found");
    expect(await outcome(MasterCompanyPage({ params: Promise.resolve({ id: "00000000-0000-4000-8000-000000000000" }) }))).toBe("not found");
    as("super");
    expect(await outcome(MasterCompanyPage({ params: Promise.resolve({ id: co["G One"]! }) }))).toBe("opens");
    expect(await outcome(MasterCompanyPage({ params: Promise.resolve({ id: co["Unassigned Co"]! }) }))).toBe("opens");
  });

  it("every Tracker server action refuses another coordinator's company by id or by name, and accepts the caller's own", async () => {
    as("jyotsna");
    const other = co["G One"]!;
    const own = co["J One"]!;
    expect(await tracker.saveFollowUp({ partyName: "G One", note: "x" })).toEqual({ ok: false, error: "That party isn't in the collection data, so nothing was saved." });
    expect(await tracker.setConfirmedAmount({ companyId: other, amount: "100" })).toMatchObject({ ok: false, error: expect.stringMatching(/isn't in the Collection Master/) });
    expect(await tracker.escalateForReview({ companyId: other, reason: "Trying another coordinator's company." })).toMatchObject({ ok: false, error: expect.stringMatching(/isn't in the Collection Master/) });
    expect(await commitments.getCompanyCommitment(other)).toEqual({ ok: false, error: "That company isn't in the Collection Master." });
    expect(await commitments.saveCompanyCommitment({ companyId: other, amount: "5000", committedDate: "2099-01-01" })).toMatchObject({ ok: false, error: expect.stringMatching(/isn't in the Collection Master/) });
    expect(await tracker.setConfirmedAmount({ companyId: co["Unassigned Co"]!, amount: "100" })).toMatchObject({ ok: false });
    // Nothing was written against the other company.
    expect((await pg.query(`select count(*)::int n from collection_followups where party_name = 'G One'`)).rows).toEqual([{ n: 0 }]);
    expect((await pg.query(`select count(*)::int n from collection_confirmed_amounts where company_id = $1`, [other])).rows).toEqual([{ n: 0 }]);
    expect((await pg.query(`select count(*)::int n from collection_escalations`)).rows).toEqual([{ n: 0 }]);
    // Own company: everything works.
    expect(await tracker.saveFollowUp({ partyName: "J One", nextFollowupDate: "2099-01-15", note: "Own company" })).toEqual({ ok: true });
    expect(await tracker.setConfirmedAmount({ companyId: own, amount: "₹1,250.50" })).toEqual({ ok: true });
    expect(await commitments.saveCompanyCommitment({ companyId: own, amount: "5000", committedDate: "2099-01-01" })).toMatchObject({ ok: true });
    expect(await commitments.getCompanyCommitment(own)).toMatchObject({ ok: true, commitment: { amount: "5000.00" } });
    expect(await tracker.escalateForReview({ companyId: own, reason: "Customer disputes the invoice amount." })).toEqual({ ok: true });
    expect((await pg.query<{ a: string }>(`select confirmed_amount_at_escalation::text a from collection_escalations where company_id = $1`, [own])).rows).toEqual([{ a: "1250.50" }]);
  });

  it("a super-admin may act on any company, including an unassigned one", async () => {
    as("super");
    expect(await tracker.saveFollowUp({ partyName: "Unassigned Co", note: "Seen by the super-admin" })).toEqual({ ok: true });
    expect(await commitments.getCompanyCommitment(co["G One"]!)).toMatchObject({ ok: true });
  });
});

describe("reassignment moves visibility", () => {
  it("a coordinator may hand their own company on; it then shows for the new coordinator and leaves the old one's Tracker, with its history intact", async () => {
    await grant("collection.coordinator.assign", ids.gauri);
    await grant("collection.coordinator.assign", ids.super); // sensitive: explicit even for a super-admin
    as("gauri");
    expect(await tracker.saveFollowUp({ partyName: "G Two", note: "Before the handover" })).toEqual({ ok: true });
    // Another coordinator's company can't be reassigned, even with the capability.
    expect(await tracker.assignSalesCoordinator({ companyId: co["B One"], coordinatorLabel: "Gauri", expected: "Bhavisha" })).toMatchObject({ ok: false });
    expect((await pg.query<{ l: string }>(`select coordinator_label l from collection_master_companies where id = $1`, [co["B One"]])).rows).toEqual([{ l: "Bhavisha" }]);
    // Own company → Saroj.
    expect(await tracker.assignSalesCoordinator({ companyId: co["G Two"], coordinatorLabel: "Saroj", expected: "Gauri" })).toMatchObject({ ok: true, changed: true });
    expect((await trackerRows()).names).toEqual(["G One"]);
    as("saroj");
    const t = await trackerRows();
    expect(t.names).toEqual(["G Two", "S One"]);
    expect(await outcome(MasterCompanyPage({ params: Promise.resolve({ id: co["G Two"]! }) }))).toBe("opens");
    expect((await pg.query(`select note from collection_followups where party_name = 'G Two'`)).rows).toEqual([{ note: "Before the handover" }]);
    expect((await pg.query(`select count(*)::int n from collection_master_companies`)).rows).toEqual([{ n: 8 }]);
    // A super-admin (holding the capability) may move any company; back to Gauri here.
    as("super");
    expect(await tracker.assignSalesCoordinator({ companyId: co["G Two"], coordinatorLabel: "Gauri", expected: "Saroj" })).toMatchObject({ ok: true, changed: true });
    as("gauri");
    expect((await trackerRows()).names).toEqual(["G One", "G Two"]);
  });

  it("changing the login's link (what a super-admin keeps) changes the scope on the next request; the Tracker's own scope never comes from the browser", async () => {
    as("nolink");
    expect((await trackerRows()).names).toEqual([]);
    await pg.query(`insert into collection_coordinator_links (employee_id, coordinator_label, set_by_id) values ($1, 'Mangesh', $2)`, [ids.nolink, ids.super]);
    expect((await trackerRows()).names).toEqual(["Other Label Co"]);
    await pg.query(`delete from collection_coordinator_links where employee_id = $1`, [ids.nolink]);
    expect((await trackerRows()).names).toEqual([]);
    expect(await scopeMod.collectionScopeFor()).toEqual({ kind: "none", reason: "unconfigured" });
  });
});
