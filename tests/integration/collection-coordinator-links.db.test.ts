import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite; migrations 0112, 0115, 0118 and 0120 themselves) for the login ↔ Sales
// Coordinator link: the migration's shape and security, the super-admin-only action (validation, duplicates, own link,
// stale screens, audit), the identity resolver, and end to end: each linked login gets ONLY its own scorecard — including
// a reviewer who is also a salesperson, and an admin/system login marked "not a Sales Coordinator". Made-up people only;
// super-admin status is mocked (the real list is lib/auth/super-admin.ts).
type Me = { id: string; email: string; isAdmin: boolean; isActive: boolean; name: string };
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | Me, supers: new Set<string>() };
});
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
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
vi.mock("@/lib/auth/super-admin", () => ({ isSuperAdmin: (e: string | null | undefined) => !!e && h.supers.has(e) }));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";
import type { CapabilityProof } from "@/lib/auth/capability";
import { scorecardFor } from "@/lib/collections/scorecards";

const sqlOf = (n: string) => readFileSync(resolve(__dirname, "../../db/migrations", n), "utf8");
type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let actions: typeof import("@/app/(admin)/admin/sales-coordinators/actions");
let identity: typeof import("@/lib/collections/salesperson-identity");
let links: typeof import("@/lib/queries/coordinator-links");
let scoreQ: typeof import("@/lib/queries/collection-scorecards");
const P: Record<string, Me> = {};
const CO: Record<string, string> = {};

async function person(key: string, opts: { admin?: boolean; superAdmin?: boolean; active?: boolean } = {}) {
  const email = `${key.toLowerCase()}@example.test`;
  const id = (await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin, is_active) values ($1, $2, 'both', $3, $4) returning id`, [key, email, opts.admin ?? true, opts.active ?? true])).rows[0]!.id;
  P[key] = { id, email, isAdmin: opts.admin ?? true, isActive: opts.active ?? true, name: key };
  if (opts.superAdmin) h.supers.add(email);
}
const as = (k: string) => (h.me = P[k]!);
const set = (employee: string, choice: object, expected: object = { kind: "unconfigured" }) => actions.setCoordinatorLink({ employeeId: P[employee]!.id, choice, expected });
const L = (label: string) => ({ kind: "label", label });
const linkRows = async () => (await pg.query(`select employee_id, coordinator_label from collection_coordinator_links order by employee_id`)).rows;
const events = async () => (await pg.query<{ employee_id: string; actor_id: string; from_value: unknown; to_value: unknown }>(`select employee_id, actor_id, from_value, to_value from employee_events where event_type = 'collection_coordinator_link_set' order by created_at, id`)).rows;

beforeAll(async () => {
  const made = await createTestDb({ employees: schema.employees, customerMasters: schema.customerMasters, departments: schema.departments, employeeDepartments: schema.employeeDepartments, fieldPermissionGrants: schema.fieldPermissionGrants, employeeEvents: schema.employeeEvents });
  pg = made.pg;
  h.db = made.db;
  await pg.exec(`do $$ begin if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if; if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if; end $$;
    alter default privileges in schema public grant all on tables to anon, authenticated;`);
  for (const m of ["0112_collection_master.sql", "0115_collection_review.sql", "0118_collection_escalation_reason.sql", "0120_collection_coordinator_links.sql"]) await pg.exec(sqlOf(m));
  await person("SuperA", { superAdmin: true });
  await person("SuperB", { superAdmin: true }); // a super-admin who is also a salesperson and the reviewer (like the business owner)
  await person("SystemAcct", { superAdmin: true }); // an administrative/system login, not a salesperson
  await person("PlainAdmin");
  await person("SalesG");
  await person("SalesS", { admin: false });
  await person("Leaver", { active: false });
  for (const [name, label] of [["Alpha", "Gauri"], ["Beta", "Gauri"], ["Gamma", "Savita"], ["Delta", "Owner"]] as const) {
    CO[name] = (await pg.query<{ id: string }>(`insert into collection_master_companies (company_name, name_key, coordinator_label) values ($1, $2, $3) returning id`, [name, name.toLowerCase(), label])).rows[0]!.id;
  }
  // The reviewer is whoever holds collection.escalation.review — granted explicitly, separate from any link.
  await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('collection.escalation.review', 'employee', $1, true)`, [P.SuperB!.id]);
  await pg.query(`insert into collection_escalations (company_id, status, escalated_by_id, closed_by_id, closed_at, reason) values ($1, 'closed', $2, $3, now(), 'x'), ($4, 'open', $2, null, null, 'y')`, [CO.Alpha, P.SalesG!.id, P.SuperB!.id, CO.Gamma]);
  actions = await import("@/app/(admin)/admin/sales-coordinators/actions");
  identity = await import("@/lib/collections/salesperson-identity");
  links = await import("@/lib/queries/coordinator-links");
  scoreQ = await import("@/lib/queries/collection-scorecards");
}, 180_000);
afterAll(async () => {
  await pg?.close();
});
beforeEach(() => vi.restoreAllMocks());

describe("migration 0120", () => {
  it("is idempotent, starts empty, has RLS on with no policies, and the REST roles hold nothing", async () => {
    await pg.exec(sqlOf("0120_collection_coordinator_links.sql"));
    expect(await linkRows()).toEqual([]);
    expect((await pg.query(`select relrowsecurity r from pg_class where oid = 'public.collection_coordinator_links'::regclass`)).rows[0]).toEqual({ r: true });
    expect((await pg.query(`select count(*)::int n from pg_policies where tablename = 'collection_coordinator_links'`)).rows[0]).toEqual({ n: 0 });
    for (const role of ["anon", "authenticated"]) {
      expect((await pg.query(`select has_table_privilege('${role}', 'public.collection_coordinator_links', 'SELECT') v`)).rows[0]).toEqual({ v: false });
    }
  });

  it("the database itself refuses a label on two logins and a blank label", async () => {
    await pg.query(`insert into collection_coordinator_links (employee_id, coordinator_label) values ($1, 'Zed')`, [P.Leaver!.id]);
    await expect(pg.query(`insert into collection_coordinator_links (employee_id, coordinator_label) values ($1, 'Zed')`, [P.PlainAdmin!.id])).rejects.toThrow(/duplicate key|unique/);
    await expect(pg.query(`insert into collection_coordinator_links (employee_id, coordinator_label) values ($1, '  ')`, [P.PlainAdmin!.id])).rejects.toThrow(/check/);
    // NULL ("not a Sales Coordinator") may be on many logins
    await pg.query(`insert into collection_coordinator_links (employee_id, coordinator_label) values ($1, null), ($2, null)`, [P.PlainAdmin!.id, P.SalesS!.id]);
    await pg.query(`delete from collection_coordinator_links`);
  });
});

describe("setting a link — super-admins only", () => {
  it("a super-admin links a login to a Collection Master label; audited with who, from and to", async () => {
    as("SuperA");
    expect(await set("SalesG", L("Gauri"))).toEqual({ ok: true, changed: true });
    expect(await identity.salespersonIdentityFor(P.SalesG!)).toEqual({ status: "linked", label: "Gauri" });
    expect(await events()).toEqual([{ employee_id: P.SalesG!.id, actor_id: P.SuperA!.id, from_value: { kind: "unconfigured" }, to_value: { kind: "label", label: "Gauri" } }]);
  });

  it("an ordinary admin, a non-admin, or a signed-out user cannot change any link", async () => {
    as("PlainAdmin");
    expect(await set("SalesS", L("Savita"))).toEqual({ ok: false, error: "Only a super-admin can link logins to Sales Coordinators." });
    h.me = { ...P.SalesS! };
    await expect(set("SalesS", L("Savita"))).rejects.toThrow(/Forbidden/);
    h.me = null;
    await expect(set("SalesS", L("Savita"))).rejects.toThrow(/Forbidden/);
    expect(await identity.salespersonIdentityFor(P.SalesS!)).toEqual({ status: "unconfigured" });
  });

  it("nobody can change their OWN link — not even a super-admin", async () => {
    as("SuperB");
    expect(await set("SuperB", L("Owner"))).toEqual({ ok: false, error: "You can't change your own Sales Coordinator link. Ask another super-admin." });
  });

  it("refuses a label the Collection Master doesn't hold, a label already linked to someone else, and inactive logins", async () => {
    as("SuperA");
    expect(await set("SalesS", L("gauri"))).toEqual({ ok: false, error: "That Sales Coordinator isn't in the Collection Master. Choose one from the list." }); // exact spelling only
    expect(await set("SalesS", L("Gauri"))).toEqual({ ok: false, error: '"Gauri" is already linked to SalesG. Unlink it there first.' });
    expect(await set("Leaver", L("Savita"))).toEqual({ ok: false, error: "That employee no longer exists or is inactive." });
    expect((await set("SalesS", { kind: "label", label: "" })).ok).toBe(false);
  });

  it("a stale screen can't overwrite a change made meanwhile", async () => {
    as("SuperA");
    expect(await set("SalesS", L("Savita"))).toEqual({ ok: true, changed: true });
    expect(await set("SalesS", { kind: "none" }, { kind: "unconfigured" })).toEqual({ ok: false, error: "This link was changed by someone else since you opened the page. Reload and try again." });
    expect(await identity.salespersonIdentityFor(P.SalesS!)).toEqual({ status: "linked", label: "Savita" });
  });

  it("'not a Sales Coordinator' for admin/system logins; clearing returns to 'not configured'; saving the same twice changes nothing", async () => {
    as("SuperA");
    expect(await set("SystemAcct", { kind: "none" })).toEqual({ ok: true, changed: true });
    expect(await set("SystemAcct", { kind: "none" }, { kind: "none" })).toEqual({ ok: true, changed: false });
    expect(await identity.salespersonIdentityFor(P.SystemAcct!)).toEqual({ status: "not-salesperson" });
    expect(await set("PlainAdmin", { kind: "none" })).toEqual({ ok: true, changed: true });
    expect(await set("PlainAdmin", { kind: "unconfigured" }, { kind: "none" })).toEqual({ ok: true, changed: true });
    expect(await identity.salespersonIdentityFor(P.PlainAdmin!)).toEqual({ status: "unconfigured" });
  });

  it("the business owner's login is linked by ANOTHER super-admin to their own label — separate from their reviewer permission", async () => {
    as("SuperA");
    expect(await set("SuperB", L("Owner"))).toEqual({ ok: true, changed: true });
    expect(await identity.salespersonIdentityFor(P.SuperB!)).toEqual({ status: "linked", label: "Owner" });
  });

  it("the admin page lists every active login with its state, and the labels a link may use", async () => {
    const data = await links.listCoordinatorLinks();
    const byName = Object.fromEntries(data.rows.map((r) => [r.name, r.state]));
    expect(byName).toMatchObject({ SalesG: L("Gauri"), SalesS: L("Savita"), SuperB: L("Owner"), SystemAcct: { kind: "none" }, PlainAdmin: { kind: "unconfigured" } });
    expect(byName).not.toHaveProperty("Leaver");
    expect(data.labels).toEqual(["Gauri", "Owner", "Savita"]);
  });
});

describe("end to end: each login gets only its own scorecard", () => {
  const parties = () => Object.entries({ Alpha: "Gauri", Beta: "Gauri", Gamma: "Savita", Delta: "Owner" }).map(([n, l]) => ({ masterId: CO[n]!, coordinatorLabel: l, outstanding: null }));
  const PROOF = { employeeId: "x", capability: "collection.escalation.review" } as unknown as CapabilityProof<"collection.escalation.review">;
  const cardFor = async (who: string, reviewer: boolean) => {
    const id = await identity.salespersonIdentityFor(P[who]!);
    if (id.status !== "linked") return id;
    return scorecardFor(id.label, parties(), { approved: false }, reviewer ? await scoreQ.escalationCountsForSalesperson(PROOF, id.label) : null);
  };

  it("salespeople see their own clients only", async () => {
    expect(await cardFor("SalesG", false)).toEqual({ salesperson: "Gauri", clients: 2, outstanding: { status: "not-configured" }, escalations: { status: "restricted" } });
    expect(await cardFor("SalesS", false)).toEqual({ salesperson: "Savita", clients: 1, outstanding: { status: "not-configured" }, escalations: { status: "restricted" } });
  });

  it("the reviewer-salesperson sees THEIR card (one client) with escalation figures for THEIR clients only", async () => {
    expect(await cardFor("SuperB", true)).toEqual({ salesperson: "Owner", clients: 1, outstanding: { status: "not-configured" }, escalations: { status: "ok", escalated: 0, resolvedByReviewer: 0 } });
  });

  it("the admin/system login gets no salesperson card; an unconfigured login gets the configure message state", async () => {
    expect(await cardFor("SystemAcct", true)).toEqual({ status: "not-salesperson" });
    expect(await cardFor("PlainAdmin", true)).toEqual({ status: "unconfigured" });
  });

  it("without migration 0120 everyone is 'not configured' (nothing guessed), and the admin page says it's not set up", async () => {
    await pg.exec(`alter table collection_coordinator_links rename to collection_coordinator_links_hidden`);
    try {
      expect(await identity.salespersonIdentityFor(P.SalesG!)).toEqual({ status: "unconfigured" });
      expect((await links.listCoordinatorLinks()).storageReady).toBe(false);
      as("SuperA");
      expect(await set("PlainAdmin", { kind: "none" })).toEqual({ ok: false, error: "Sales Coordinator links aren't set up on this database yet (database update 0120 is needed), so nothing was saved." });
    } finally {
      await pg.exec(`alter table collection_coordinator_links_hidden rename to collection_coordinator_links`);
    }
  });

  it("an employee whose NAME equals a label is not linked by it", async () => {
    await person("Savita2");
    await pg.query(`update employees set name = 'Savita' where id = $1`, [P.Savita2!.id]);
    expect(await identity.salespersonIdentityFor(P.Savita2!)).toEqual({ status: "unconfigured" });
  });
});
