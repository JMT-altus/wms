import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests for the PROPOSED migration 0116 (Collection Master +
// follow-ups row-level security) on in-memory PGlite databases — nothing here
// can reach a shared or production database. Tables come from the migration
// files 0110 and 0112 themselves.
//
// PGlite connects as a superuser, which bypasses RLS and would prove nothing,
// so the app runs here as `app_owner`: a plain role (no superuser, no
// BYPASSRLS) that OWNS the tables — the situation of Supabase's `postgres`
// role when it created them. `anon` / `authenticated` get Supabase-style
// default grants, so the "before" state is exposed, as on Supabase.
// Limit: there is no PostgREST here; REST access is tested at the Postgres
// privilege level, which is what PostgREST runs under.
const GRANTED_EMAIL = "granted@example.test";
type Me = { id: string; isAdmin: boolean; isActive: boolean; email: string; name: string };
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | Me, claims: null as null | { email?: string; email_verified?: boolean } };
});
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ rateLimitOrError: () => null }));
vi.mock("@/lib/format", async (orig) => ({ ...(await orig<typeof import("@/lib/format")>()), localDateString: () => "2026-10-21" }));
vi.mock("@/lib/db", () => ({
  get db() {
    if (!h.db) throw new Error("test database not ready");
    return h.db;
  },
}));
vi.mock("@/lib/auth/current", () => ({
  getCurrentEmployee: async () => h.me,
  requireAdmin: async () => {
    if (!h.me?.isAdmin) throw new Error("Forbidden");
    return h.me;
  },
}));
vi.mock("@/lib/auth/session", () => ({ readSession: async () => h.claims }));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";

const sqlOf = (n: string) => readFileSync(resolve(__dirname, "../../db/migrations", n), "utf8");
const M0110 = sqlOf("0110_collection_followups.sql");
const M0112 = sqlOf("0112_collection_master.sql");
const M0116 = sqlOf("0116_collection_master_rls.sql");
const TABLES = ["collection_followups", "collection_master_imports", "collection_master_companies"] as const;

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let master: typeof import("@/app/(forms-module)/forms/collection/master/actions");
let tracker: typeof import("@/app/(forms-module)/forms/collection/actions");
let load: typeof import("@/lib/collections/load");
let queries: typeof import("@/lib/queries/collection-master");
let followups: typeof import("@/lib/queries/collection-followups");
const ids = { admin: "", granted: "", alpha: "", beta: "" };

const asAdmin = () => {
  h.me = { id: ids.admin, isAdmin: true, isActive: true, email: "admin@example.test", name: "Asha" };
  h.claims = { email: "admin@example.test", email_verified: true };
};
/** An admin explicitly granted collection.coordinator.assign in the permission matrix (a grant row). */
const asGranted = () => {
  h.me = { id: ids.granted, isAdmin: true, isActive: true, email: GRANTED_EMAIL, name: "Granted" };
  h.claims = { email: GRANTED_EMAIL, email_verified: true };
};

/** Run `q` as `role` and report allowed / denied (permission or RLS). */
async function asRole(db: Pg, role: string, q: string): Promise<string> {
  await db.exec(`set role ${role}`);
  try {
    await db.query(q);
    return "allowed";
  } catch (e) {
    return /permission denied|row-level security/i.test((e as Error).message) ? "denied" : `error: ${(e as Error).message}`;
  } finally {
    await db.exec(`reset role`);
  }
}
const rls = async (db: Pg) =>
  (await db.query<{ relname: string; on: boolean; forced: boolean }>(
    `select relname, relrowsecurity as on, relforcerowsecurity as forced from pg_class where relname = any($1) order by relname`,
    [[...TABLES]],
  )).rows;

/** A fresh database with Supabase-like roles and default grants. */
async function freshDb(migrations: string[]) {
  const made = await createTestDb({ employees: schema.employees, customerMasters: schema.customerMasters, departments: schema.departments, employeeDepartments: schema.employeeDepartments, fieldPermissionGrants: schema.fieldPermissionGrants });
  for (const m of migrations) await made.pg.exec(m);
  await made.pg.exec(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname = 'app_owner') then create role app_owner nologin nosuperuser nobypassrls; end if;
      if not exists (select 1 from pg_roles where rolname = 'app_other') then create role app_other nologin nosuperuser nobypassrls; end if;
    end $$;
    grant usage on schema public to anon, authenticated, app_owner, app_other;
    grant all on all tables in schema public to anon, authenticated, app_other;
    grant select, insert, update, references on employees, customer_masters to app_owner;
    grant select on departments, employee_departments, field_permission_grants to app_owner;
  `);
  for (const t of TABLES) {
    if ((await made.pg.query<{ r: string | null }>(`select to_regclass('public.${t}')::text as r`)).rows[0]!.r) {
      await made.pg.exec(`alter table ${t} owner to app_owner`);
    }
  }
  return made;
}

beforeAll(async () => {
  const made = await freshDb([M0110, M0112]);
  pg = made.pg;
  h.db = made.db;
  const emp = async (name: string, email: string) =>
    (await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', true) returning id`, [name, email])).rows[0]!.id;
  ids.admin = await emp("Asha", "admin@example.test");
  ids.granted = await emp("Granted", GRANTED_EMAIL);
  // What a super-admin's "Allow" in the permission matrix stores.
  await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ('collection.coordinator.assign', 'employee', $1, true)`, [ids.granted]);
  master = await import("@/app/(forms-module)/forms/collection/master/actions");
  tracker = await import("@/app/(forms-module)/forms/collection/actions");
  load = await import("@/lib/collections/load");
  queries = await import("@/lib/queries/collection-master");
  followups = await import("@/lib/queries/collection-followups");
  // From here on the app's own queries run as the plain owning role.
  await pg.exec(`set role app_owner`);
}, 180_000);
afterAll(async () => {
  await pg?.close();
});

const body = (rows: [string, string, string][]) => ({
  fileName: "MasterFile.xlsx",
  sheetName: "Sheet1",
  mapping: { company: "Name", coordinator: "Unnamed column B", paymentTerms: "Payment Terms" },
  confirmedColumns: { coordinator: true },
  rows: rows.map(([company, coordinator, paymentTerms], i) => ({ rowNo: i + 2, company, coordinator, paymentTerms })),
});

describe("before 0116 — 0110/0112 tables are exposed to the REST roles", () => {
  it("anon and authenticated can read and write them", async () => {
    await pg.exec(`reset role`);
    for (const role of ["anon", "authenticated"]) {
      expect(await asRole(pg, role, `select * from collection_master_companies`)).toBe("allowed");
      expect(await asRole(pg, role, `insert into collection_master_companies (company_name, name_key) values ('Rogue ${role}', 'rogue${role}')`)).toBe("allowed");
      expect(await asRole(pg, role, `select * from collection_followups`)).toBe("allowed");
    }
    await pg.exec(`delete from collection_master_companies where name_key like 'rogue%'`);
    expect((await rls(pg)).every((r) => !r.on)).toBe(true);
    await pg.exec(`set role app_owner`);
  });

  it("the guard: a role that neither owns the tables nor bypasses RLS can't apply 0116 — and nothing changes", async () => {
    await pg.exec(`reset role`);
    await pg.exec(`set role app_other`);
    await expect(pg.exec(M0116)).rejects.toThrow(/neither owns public\.collection_followups nor bypasses RLS/);
    await pg.exec(`reset role`);
    expect((await rls(pg)).every((r) => !r.on)).toBe(true);
    await pg.exec(`set role app_owner`);
  });
});

describe("after 0116", () => {
  beforeAll(async () => {
    // Applied by the owning role — the app's own role.
    await pg.exec(M0116);
    await pg.exec(M0116); // idempotent
    await pg.exec(`reset role`);
  });

  it("RLS is on (not forced) for exactly the three tables, and the REST roles have no privileges", async () => {
    expect(await rls(pg)).toEqual(TABLES.map((relname) => ({ relname, on: true, forced: false })).sort((a, b) => a.relname.localeCompare(b.relname)));
    const grants = await pg.query(
      `select grantee, table_name from information_schema.role_table_grants where table_name = any($1) and grantee in ('anon','authenticated')`,
      [[...TABLES]],
    );
    expect(grants.rows).toEqual([]);
    await pg.exec(`set role app_owner`);
  });

  it("anon and authenticated can no longer read, insert, update or delete", async () => {
    await pg.exec(`reset role`);
    for (const role of ["anon", "authenticated"]) {
      for (const t of TABLES) {
        expect(await asRole(pg, role, `select * from ${t}`)).toBe("denied");
        expect(await asRole(pg, role, `delete from ${t}`)).toBe("denied");
      }
      expect(await asRole(pg, role, `insert into collection_master_companies (company_name, name_key) values ('Rogue', 'rogue')`)).toBe("denied");
      expect(await asRole(pg, role, `update collection_master_companies set coordinator_label = 'Rogue'`)).toBe("denied");
      expect(await asRole(pg, role, `insert into collection_followups (party_name, note) values ('x', 'y')`)).toBe("denied");
    }
    await pg.exec(`set role app_owner`);
  });

  it("the owning app role still imports, re-previews and keeps the audit history", async () => {
    asAdmin();
    const first = await master.importCollectionMaster({ ...body([["Alpha Traders", "MANGESH", "30 days"], ["Beta Corp", "", "Advance"]]), confirm: true });
    if (!first.ok) throw new Error(first.error);
    expect(first.result.totals.inserted).toBe(2);
    const again = await master.previewCollectionMaster(body([["Alpha Traders", "MANGESH", "30 days"]]));
    expect(again.ok && again.preview.storageReady && again.preview.rows[0]!.status).toBe("unchanged");
    expect((await queries.listRecentImports(5)).map((i) => i.source)).toEqual(["file"]);
    const companies = (await load.loadCollectionParties()).parties;
    ids.alpha = companies.find((p) => p.partyName === "Alpha Traders")!.masterId!;
    ids.beta = companies.find((p) => p.partyName === "Beta Corp")!.masterId!;
    expect(companies.map((p) => [p.partyName, p.collectionPerson, p.paymentTerms])).toEqual([
      ["Alpha Traders", "MANGESH", "30 days"],
      ["Beta Corp", null, "Advance"],
    ]);
  });

  it("the owning app role still saves and lists follow-ups", async () => {
    asAdmin();
    expect(await tracker.saveFollowUp({ partyName: "Alpha Traders", note: "Called; cheque next week", nextFollowupDate: "2026-10-28" })).toEqual({ ok: true });
    const list = await followups.listFollowUps();
    expect(list.storageReady).toBe(true);
    expect(list.entries.map((e) => e.note)).toEqual(["Called; cheque next week"]);
  });

  it("capability-gated coordinator editing still works (row lock, update, audit row) as the owning app role", async () => {
    asGranted();
    expect((await queries.listCoordinatorOptions()).labels).toEqual(["MANGESH"]);
    expect(await tracker.assignSalesCoordinator({ companyId: ids.beta, coordinatorLabel: "MANGESH", expected: null })).toEqual({ ok: true, changed: true });
    expect((await load.loadCollectionParties()).parties.find((p) => p.masterId === ids.beta)?.collectionPerson).toBe("MANGESH");
    expect((await queries.listRecentImports(1))[0]).toMatchObject({ source: "tracker-assignment", importedByName: "Granted" });
  });

  it("a non-owner role WITH table grants sees no rows and can't write — why the app's role must own the tables (or bypass RLS)", async () => {
    await pg.exec(`reset role`);
    await pg.exec(`grant all on collection_master_companies to app_other`);
    await pg.exec(`set role app_other`);
    const seen = await pg.query<{ n: number }>(`select count(*)::int as n from collection_master_companies`);
    await pg.exec(`reset role`);
    expect(seen.rows[0]!.n).toBe(0);
    expect(await asRole(pg, "app_other", `insert into collection_master_companies (company_name, name_key) values ('X', 'x')`)).toBe("denied");
    await pg.exec(`set role app_owner`);
  });

  it("deleting an employee still nulls their links (FK actions aren't blocked by RLS)", async () => {
    await pg.exec(`reset role`);
    const extra = (await pg.query<{ id: string }>(`insert into employees (name, email, role) values ('Temp', 'temp@example.test', 'both') returning id`)).rows[0]!.id;
    await pg.query(`update collection_master_companies set updated_by_id = $1 where id = $2`, [extra, ids.alpha]);
    await pg.query(`delete from employees where id = $1`, [extra]);
    expect((await pg.query<{ u: string | null }>(`select updated_by_id as u from collection_master_companies where id = $1`, [ids.alpha])).rows[0]!.u).toBeNull();
    await pg.exec(`set role app_owner`);
  });
});

describe("0116 on a database where 0110 isn't applied", () => {
  it("protects the 0112 tables, skips the missing one with a notice, and protects it when re-run after 0110", async () => {
    const made = await freshDb([M0112]);
    try {
      await made.pg.exec(`set role app_owner`);
      await made.pg.exec(M0116);
      await made.pg.exec(`reset role`);
      expect(await rls(made.pg)).toEqual([
        { relname: "collection_master_companies", on: true, forced: false },
        { relname: "collection_master_imports", on: true, forced: false },
      ]);
      // 0110 later: exposed until 0116 is re-run.
      await made.pg.exec(M0110);
      await made.pg.exec(`grant all on collection_followups to anon; alter table collection_followups owner to app_owner;`);
      expect(await asRole(made.pg, "anon", `select * from collection_followups`)).toBe("allowed");
      await made.pg.exec(`set role app_owner`);
      await made.pg.exec(M0116);
      await made.pg.exec(`reset role`);
      expect(await asRole(made.pg, "anon", `select * from collection_followups`)).toBe("denied");
    } finally {
      await made.pg.close();
    }
  }, 180_000);
});
