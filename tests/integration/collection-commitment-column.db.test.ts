import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite; the commitments table from migration 0114's own SQL) of the commitment shown in
// the Collection Amount Confirmation column and the popup's history: the REAL commitment actions and the REAL Tracker page
// with the real capability resolver over real grant rows. Mocked: who is signed in, and the Collection scope.
type Me = { id: string; isAdmin: boolean; isActive: boolean; email: string; name: string; departmentId: null };
type Scope = { kind: "all" } | { kind: "coordinator"; label: string };
const h = vi.hoisted(() => {
  process.env.DATABASE_URL = "postgres://nobody:nothing@db.invalid:1/never";
  return { db: null as unknown, me: null as null | Me, scope: { kind: "all" } as Scope };
});
vi.mock("server-only", () => ({}));
vi.mock("@/lib/collections/scope-server", () => ({ collectionScopeFor: async () => h.scope }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), updateTag: vi.fn(), unstable_cache: (fn: unknown) => fn, revalidateTag: vi.fn() }));
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
vi.mock("@/components/collections/collection-tracker", () => ({ CollectionTracker: () => null }));

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";
import { commitmentLabel } from "@/lib/collections/commitment-display";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let actions: typeof import("@/app/(collection-module)/collection/commitments/actions");
let TrackerPage: (typeof import("@/app/(collection-module)/collection/tracker/page"))["default"];

let owner: string; // collection.view + commitments.view + commitments.edit
let viewer: string; // collection.view + commitments.view (no edit)
let staff: string; // collection.view only
const as = (id: string, name: string) => (h.me = { id, isAdmin: false, isActive: true, email: `${id}@example.test`, name, departmentId: null });
const ids: Record<string, string> = {};

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
type Row = { partyName: string; masterId: string; commitment?: { amount: string; committedDate: string; recordedAt: Date; recordedByName: string | null } | null; confirmedAmount?: unknown };
async function tracker() {
  const props = (await findProps(await TrackerPage(), "CollectionTracker"))!;
  const rows = props.rows as Row[];
  return { rows: Object.fromEntries(rows.map((r) => [r.partyName, r])), names: rows.map((r) => r.partyName).sort(), canSee: props.canSeeCommitments as boolean | undefined };
}
const count = async () => (await pg.query<{ n: number }>(`select count(*)::int n from collection_commitments`)).rows[0]!.n;

beforeAll(async () => {
  const made = await createTestDb({
    employees: schema.employees,
    customerMasters: schema.customerMasters,
    departments: schema.departments,
    employeeDepartments: schema.employeeDepartments,
    fieldPermissionGrants: schema.fieldPermissionGrants,
    collectionMasterImports: schema.collectionMasterImports,
    collectionMasterCompanies: schema.collectionMasterCompanies,
    collectionFollowups: schema.collectionFollowups,
    collectionAmountConfirmations: schema.collectionAmountConfirmations,
    collectionConfirmedAmounts: schema.collectionConfirmedAmounts,
    collectionEscalations: schema.collectionEscalations,
  });
  pg = made.pg;
  h.db = made.db;
  await pg.exec(readFileSync(resolve(__dirname, "../../db/migrations/0114_collection_commitments.sql"), "utf8"));
  const emp = async (name: string) => (await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', false) returning id`, [name, `${name}@example.test`])).rows[0]!.id;
  owner = await emp("Asha");
  viewer = await emp("Bala");
  staff = await emp("Chitra");
  const grant = async (id: string, keys: string[]) => {
    await pg.query(`insert into module_access_grants (module_id, subject_type, subject_id, allowed) values ('collection', 'employee', $1, true)`, [id]);
    for (const key of keys) await pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ($1, 'employee', $2, true)`, [key, id]);
  };
  await grant(owner, ["collection.view", "collection.commitments.view", "collection.commitments.edit"]);
  await grant(viewer, ["collection.view", "collection.commitments.view"]);
  await grant(staff, ["collection.view"]);
  for (const [name, key, coord] of [["Alpha Traders", "alphatraders", "RIYA"], ["Beta Works", "betaworks", "MANGESH"]] as const) {
    ids[name] = (await pg.query<{ id: string }>(`insert into collection_master_companies (company_name, name_key, coordinator_label) values ($1, $2, $3) returning id`, [name, key, coord])).rows[0]!.id;
  }
  actions = await import("@/app/(collection-module)/collection/commitments/actions");
  TrackerPage = (await import("@/app/(collection-module)/collection/tracker/page")).default;
}, 180_000);
afterAll(async () => {
  await pg?.close();
});

describe("the commitment in the Collection Amount Confirmation column", () => {
  it("6: with none recorded, a holder's row says so (null) and nobody is shown a half value", async () => {
    as(owner, "Asha");
    const t = await tracker();
    expect(t.rows["Alpha Traders"]!.commitment).toBeNull();
    expect(commitmentLabel(t.rows["Alpha Traders"]!.commitment)).toBeNull();
  });

  it("1: once recorded through the popup's action, the row carries exactly that amount and date; 7: only an editor can record", async () => {
    as(staff, "Chitra");
    await expect(actions.saveCompanyCommitment({ companyId: ids["Alpha Traders"], amount: "100000", committedDate: "2026-11-04" })).rejects.toThrow("Forbidden");
    as(viewer, "Bala");
    await expect(actions.saveCompanyCommitment({ companyId: ids["Alpha Traders"], amount: "100000", committedDate: "2026-11-04" })).rejects.toThrow("Forbidden");
    expect(await count()).toBe(0);
    as(owner, "Asha");
    const r = await actions.saveCompanyCommitment({ companyId: ids["Alpha Traders"], amount: "100000", committedDate: "2026-11-04" });
    expect(r).toMatchObject({ ok: true, commitment: { amount: "100000.00", committedDate: "2026-11-04" } });
    const t = await tracker();
    expect(t.rows["Alpha Traders"]!.commitment).toMatchObject({ amount: "100000.00", committedDate: "2026-11-04", recordedByName: "Asha" });
    expect(commitmentLabel(t.rows["Alpha Traders"]!.commitment)).toBe("₹1,00,000 – 04/11/26");
    expect(t.rows["Beta Works"]!.commitment).toBeNull();
  });

  it("2 + 3 + 5: changing the amount, then the date, updates the row each time, and every earlier commitment stays in the history", async () => {
    as(owner, "Asha");
    await actions.saveCompanyCommitment({ companyId: ids["Alpha Traders"], amount: "125000.50", committedDate: "2026-11-04" });
    expect(commitmentLabel((await tracker()).rows["Alpha Traders"]!.commitment)).toBe("₹1,25,000.50 – 04/11/26");
    await actions.saveCompanyCommitment({ companyId: ids["Alpha Traders"], amount: "125000.50", committedDate: "2026-11-10" });
    expect(commitmentLabel((await tracker()).rows["Alpha Traders"]!.commitment)).toBe("₹1,25,000.50 – 10/11/26");
    expect(await count()).toBe(3); // nothing was overwritten
    const g = await actions.getCompanyCommitment(ids["Alpha Traders"]);
    if (!g.ok) throw new Error(g.error);
    expect(g.commitment).toMatchObject({ amount: "125000.50", committedDate: "2026-11-10" });
    expect(g.history.map((e) => [e.amount, e.committedDate, e.recordedByName])).toEqual([
      ["125000.50", "2026-11-10", "Asha"],
      ["125000.50", "2026-11-04", "Asha"],
      ["100000.00", "2026-11-04", "Asha"],
    ]);
    // Newest first, each with its own time.
    expect(g.history[0]!.recordedAt.getTime()).toBeGreaterThanOrEqual(g.history[1]!.recordedAt.getTime());
    expect(g.history[1]!.recordedAt.getTime()).toBeGreaterThanOrEqual(g.history[2]!.recordedAt.getTime());
  });

  it("4: the history reads the same for a viewer who may not edit, and is refused to someone without commitments.view", async () => {
    as(viewer, "Bala");
    const g = await actions.getCompanyCommitment(ids["Alpha Traders"]);
    expect(g.ok && g.history.length).toBe(3);
    as(staff, "Chitra");
    await expect(actions.getCompanyCommitment(ids["Alpha Traders"])).rejects.toThrow("Forbidden");
  });

  it("8: the page sends the commitment only to holders of collection.commitments.view; the existing confirmed-amount value is separate", async () => {
    as(viewer, "Bala");
    const v = await tracker();
    expect(v.rows["Alpha Traders"]!.commitment).toMatchObject({ amount: "125000.50" });
    as(staff, "Chitra");
    const s = await tracker();
    expect(s.names).toEqual(["Alpha Traders", "Beta Works"]); // the Tracker itself is unchanged for them
    expect("commitment" in s.rows["Alpha Traders"]!).toBe(false);
    expect(JSON.stringify(s.rows)).not.toContain("125000");
    expect(s.rows["Alpha Traders"]!.confirmedAmount ?? null).toBeNull();
  });

  it("9: a Sales Coordinator sees the commitment only on their own companies, because they see only those companies", async () => {
    as(owner, "Asha");
    await actions.saveCompanyCommitment({ companyId: ids["Beta Works"], amount: "500", committedDate: "2026-12-01" });
    h.scope = { kind: "coordinator", label: "RIYA" };
    const t = await tracker();
    expect(t.names).toEqual(["Alpha Traders"]);
    expect(commitmentLabel(t.rows["Alpha Traders"]!.commitment)).toBe("₹1,25,000.50 – 10/11/26");
    // A company outside the scope can't be read or written through the popup's actions either.
    await expect(actions.getCompanyCommitment(ids["Beta Works"])).resolves.toMatchObject({ ok: false });
    await expect(actions.saveCompanyCommitment({ companyId: ids["Beta Works"], amount: "1", committedDate: "2026-12-02" })).resolves.toMatchObject({ ok: false });
    h.scope = { kind: "all" };
    expect(commitmentLabel((await tracker()).rows["Beta Works"]!.commitment)).toBe("₹500 – 01/12/26");
    expect(await count()).toBe(4);
  });
});
