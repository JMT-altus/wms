import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// REAL-POSTGRES tests (in-memory PGlite; migrations 0115, 0118 and 0123 by their own SQL) for the confirmed amount under
// Collection Amount Confirmation, through the REAL server actions with the real module and capability resolvers over real
// grant rows. Only "who is signed in" is mocked. Invented data only; nothing here can reach a shared database.
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

import * as schema from "@/db/schema";
import { createTestDb } from "./_pglite";

type Pg = Awaited<ReturnType<typeof createTestDb>>["pg"];
let pg: Pg;
let actions: typeof import("@/app/(collection-module)/collection/actions");
let commitments: typeof import("@/app/(collection-module)/collection/commitments/actions");
let q: typeof import("@/lib/queries/collection-review");
let setter: string; // collection.confirmation.set + escalation.create
let viewer: string; // collection.view only
let reviewer: string; // escalation.review + close
let ALPHA = "";
let BETA = "";
const as = (id: string) => (h.me = { id, isAdmin: id !== viewer, isActive: true, email: `${id}@example.test`, name: id === setter ? "Asha" : id === reviewer ? "Reviewer" : "Viewer", departmentId: null });
const count = async (sql: string, p: unknown[] = []) => (await pg.query<{ n: number }>(sql, p)).rows[0]!.n;
const amounts = async (companyId: string) => (await pg.query<{ amount: string; name: string | null }>(`select a.amount::text as amount, e.name from collection_confirmed_amounts a left join employees e on e.id = a.recorded_by_id where a.company_id = $1 order by a.recorded_at, a.id`, [companyId])).rows;
const yesNo = async (companyId: string) => (await pg.query<{ value: string }>(`select value from collection_amount_confirmations where company_id = $1 order by recorded_at`, [companyId])).rows.map((r) => r.value);

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
  });
  pg = made.pg;
  h.db = made.db;
  for (const m of ["0115_collection_review.sql", "0118_collection_escalation_reason.sql", "0123_collection_confirmed_amounts.sql"]) {
    await pg.exec(readFileSync(resolve(__dirname, "../../db/migrations", m), "utf8"));
  }
  const emp = async (name: string, isAdmin: boolean) => (await pg.query<{ id: string }>(`insert into employees (name, email, role, is_admin) values ($1, $2, 'both', $3) returning id`, [name, `${name}@example.test`, isAdmin])).rows[0]!.id;
  setter = await emp("Asha", true);
  viewer = await emp("Viewer", false); // ordinary staff: the Collection module by grant, collection.view only
  reviewer = await emp("Reviewer", true);
  await pg.query(`insert into module_access_grants (module_id, subject_type, subject_id, allowed) values ('collection', 'employee', $1, true)`, [viewer]);
  const grant = (key: string, id: string) => pg.query(`insert into field_permission_grants (field_key, subject_type, subject_id, allowed) values ($1, 'employee', $2, true)`, [key, id]);
  for (const key of ["collection.view", "collection.confirmation.set", "collection.escalation.create"]) await grant(key, setter);
  await grant("collection.view", viewer);
  for (const key of ["collection.view", "collection.escalation.review", "collection.escalation.close"]) await grant(key, reviewer);
  const co = async (name: string, key: string) => (await pg.query<{ id: string }>(`insert into collection_master_companies (company_name, name_key, coordinator_label) values ($1, $2, 'MANGESH') returning id`, [name, key])).rows[0]!.id;
  ALPHA = await co("Alpha Traders", "alphatraders");
  BETA = await co("Beta Works", "betaworks");
  actions = await import("@/app/(collection-module)/collection/actions");
  commitments = await import("@/app/(collection-module)/collection/commitments/actions");
  q = await import("@/lib/queries/collection-review");
}, 180_000);
afterAll(async () => {
  await pg?.close();
});
beforeEach(() => as(setter));

describe("migration 0123", () => {
  it("is safe to re-run, keeps RLS on, and the database refuses a zero, negative or orphaned amount", async () => {
    await pg.exec(readFileSync(resolve(__dirname, "../../db/migrations/0123_collection_confirmed_amounts.sql"), "utf8"));
    const r = await pg.query<{ relname: string; rls: boolean }>(`select relname, relrowsecurity as rls from pg_class where relname in ('collection_confirmed_amounts','collection_amount_confirmations','collection_escalations') order by relname`);
    expect(r.rows).toEqual([
      { relname: "collection_amount_confirmations", rls: true },
      { relname: "collection_confirmed_amounts", rls: true },
      { relname: "collection_escalations", rls: true },
    ]);
    await expect(pg.query(`insert into collection_confirmed_amounts (company_id, amount) values ($1, 0)`, [ALPHA])).rejects.toThrow(/amount_check/);
    await expect(pg.query(`insert into collection_confirmed_amounts (company_id, amount) values ($1, -1)`, [ALPHA])).rejects.toThrow(/amount_check/);
    await expect(pg.query(`insert into collection_confirmed_amounts (company_id, amount) values ('00000000-0000-4000-8000-000000000000', 5)`)).rejects.toThrow(/foreign key/i);
    await expect(pg.query(`insert into collection_escalations (company_id, confirmed_amount_at_escalation) values ($1, 0)`, [BETA])).rejects.toThrow(/confirmed_amount_check/);
    // The Yes/No table and its CHECK are exactly as 0115 left them.
    await expect(pg.query(`insert into collection_amount_confirmations (company_id, value) values ($1, '25450.50')`, [ALPHA])).rejects.toThrow(/value_check/);
    expect(await count(`select count(*)::int n from information_schema.columns where table_name = 'collection_amount_confirmations'`)).toBe(5);
  });

  it("the schema code declares the same constraints and indexes as the SQL (new table and the escalation column)", async () => {
    const names = async (db: typeof pg) =>
      (
        await db.query<{ name: string }>(
          `select conname as name from pg_constraint where conrelid in ('collection_confirmed_amounts'::regclass, 'collection_escalations'::regclass) and contype in ('c','u')
           union select indexname from pg_indexes where tablename in ('collection_confirmed_amounts','collection_escalations') and indexname not like '%_pkey'
           union select column_name from information_schema.columns where table_name = 'collection_escalations'
           order by 1`,
        )
      ).rows.map((r) => r.name);
    const viaSchema = await createTestDb({
      employees: schema.employees,
      customerMasters: schema.customerMasters,
      collectionMasterImports: schema.collectionMasterImports,
      collectionMasterCompanies: schema.collectionMasterCompanies,
      collectionAmountConfirmations: schema.collectionAmountConfirmations,
      collectionConfirmedAmounts: schema.collectionConfirmedAmounts,
      collectionEscalations: schema.collectionEscalations,
    });
    try {
      expect(await names(viaSchema.pg)).toEqual(await names(pg));
      const col = await viaSchema.pg.query<{ t: string }>(`select data_type || ':' || numeric_precision || ',' || numeric_scale as t from information_schema.columns where table_name = 'collection_confirmed_amounts' and column_name = 'amount'`);
      expect(col.rows[0]!.t).toBe("numeric:14,2");
    } finally {
      await viaSchema.pg.close();
    }
  }, 60_000);
});

describe("entering the confirmed amount (collection.confirmation.set)", () => {
  it("saves a valid amount for a listed company as the signed-in employee, exact to the paise, and reads it back", async () => {
    expect(await actions.setConfirmedAmount({ companyId: ALPHA, amount: "₹25,450.50" })).toEqual({ ok: true });
    expect(await amounts(ALPHA)).toEqual([{ amount: "25450.50", name: "Asha" }]);
    const latest = await q.latestConfirmedAmounts([ALPHA, BETA]);
    expect(latest.storageReady).toBe(true);
    expect(latest.byCompany.get(ALPHA)).toMatchObject({ amount: "25450.50", recordedByName: "Asha" });
    expect(latest.byCompany.has(BETA)).toBe(false);
  });

  it("keeps every change as history; the newest is current, and decimals are never rounded", async () => {
    await new Promise((r) => setTimeout(r, 5));
    expect(await actions.setConfirmedAmount({ companyId: ALPHA, amount: "25450.5" })).toEqual({ ok: true }); // same value again is still an entry
    await new Promise((r) => setTimeout(r, 5));
    expect(await actions.setConfirmedAmount({ companyId: ALPHA, amount: "311855013.28" })).toEqual({ ok: true });
    expect((await amounts(ALPHA)).map((r) => r.amount)).toEqual(["25450.50", "25450.50", "311855013.28"]);
    expect((await q.latestConfirmedAmounts([ALPHA])).byCompany.get(ALPHA)?.amount).toBe("311855013.28");
  });

  it("refuses invalid, zero, negative and over-precise amounts, extra fields and unknown companies — nothing is written", async () => {
    const before = await count(`select count(*)::int n from collection_confirmed_amounts`);
    for (const amount of ["-5", "0", "12.345", "abc", "1e5", "1234567890123", ""]) {
      const r = await actions.setConfirmedAmount({ companyId: ALPHA, amount });
      expect(r.ok, amount).toBe(false);
    }
    expect((await actions.setConfirmedAmount({ companyId: ALPHA, amount: 500 })).ok).toBe(false);
    expect((await actions.setConfirmedAmount({ companyId: ALPHA, amount: "500", recordedById: viewer })).ok).toBe(false);
    expect(await actions.setConfirmedAmount({ companyId: "00000000-0000-4000-8000-000000000000", amount: "500" })).toEqual({ ok: false, error: "That company isn't in the Collection Master, so nothing was saved." });
    expect(await count(`select count(*)::int n from collection_confirmed_amounts`)).toBe(before);
  });

  it("is refused without the capability — a Tracker viewer, and an admin whose grant was revoked — before anything is written", async () => {
    const before = await count(`select count(*)::int n from collection_confirmed_amounts`);
    as(viewer);
    await expect(actions.setConfirmedAmount({ companyId: ALPHA, amount: "100" })).rejects.toThrow("Forbidden");
    as(setter);
    await pg.query(`update field_permission_grants set allowed = false where field_key = 'collection.confirmation.set' and subject_id = $1`, [setter]);
    await expect(actions.setConfirmedAmount({ companyId: ALPHA, amount: "100" })).rejects.toThrow("Forbidden");
    await pg.query(`update field_permission_grants set allowed = true where field_key = 'collection.confirmation.set' and subject_id = $1`, [setter]);
    // Without the Collection module nothing works either, whatever the capabilities.
    await pg.query(`insert into module_access_grants (module_id, subject_type, subject_id, allowed) values ('collection', 'employee', $1, false)`, [setter]);
    await expect(actions.setConfirmedAmount({ companyId: ALPHA, amount: "100" })).rejects.toThrow("Forbidden");
    await pg.query(`delete from module_access_grants where subject_id = $1`, [setter]);
    expect(await count(`select count(*)::int n from collection_confirmed_amounts`)).toBe(before);
  });

  it("never touches the Yes/No answer: the Yes/No history is exactly what was recorded there, and the amount's history is separate", async () => {
    await q.recordConfirmation({ employeeId: setter, capability: "collection.confirmation.set" } as never, ALPHA, "yes");
    expect(await yesNo(ALPHA)).toEqual(["yes"]);
    expect(await actions.setConfirmedAmount({ companyId: ALPHA, amount: "25000" })).toEqual({ ok: true });
    expect(await yesNo(ALPHA)).toEqual(["yes"]);
    expect((await q.latestConfirmations([ALPHA])).byCompany.get(ALPHA)?.value).toBe("yes");
    expect((await amounts(ALPHA)).at(-1)).toEqual({ amount: "25000.00", name: "Asha" });
  });
});

describe("escalation snapshots", () => {
  it("records the confirmed amount in force beside the Yes/No answer in force; reviewers see both, and closing keeps them", async () => {
    expect(await actions.escalateForReview({ companyId: ALPHA, reason: "Customer disputes the invoice amount." })).toEqual({ ok: true });
    const row = (await pg.query<{ c: string | null; a: string | null; reason: string }>(`select confirmation_at_escalation c, confirmed_amount_at_escalation::text a, reason from collection_escalations where company_id = $1 and status = 'open'`, [ALPHA])).rows[0]!;
    expect(row).toEqual({ c: "yes", a: "25000.00", reason: "Customer disputes the invoice amount." });
    // A later amount doesn't rewrite the snapshot.
    await new Promise((r) => setTimeout(r, 5));
    expect(await actions.setConfirmedAmount({ companyId: ALPHA, amount: "26000" })).toEqual({ ok: true });
    as(reviewer);
    const list = await q.listOpenEscalationsForReview({ employeeId: reviewer, capability: "collection.escalation.review" } as never);
    expect(list).toMatchObject({ storageReady: true, reasonStorageReady: true });
    expect(list.rows.find((r) => r.companyId === ALPHA)).toMatchObject({ companyName: "Alpha Traders", confirmationAtEscalation: "yes", confirmedAmountAtEscalation: "25000.00", reason: "Customer disputes the invoice amount.", escalatedByName: "Asha" });
    expect((await q.latestConfirmedAmounts([ALPHA])).byCompany.get(ALPHA)?.amount).toBe("26000.00");
    // The existing review workflow: close, and the snapshot stays on the closed record.
    const id = list.rows.find((r) => r.companyId === ALPHA)!.id;
    expect(await commitments.closeEscalation({ escalationId: id })).toEqual({ ok: true });
    const closed = (await pg.query<{ status: string; a: string | null; c: string | null }>(`select status, confirmed_amount_at_escalation::text a, confirmation_at_escalation c from collection_escalations where id = $1`, [id])).rows[0]!;
    expect(closed).toEqual({ status: "closed", a: "25000.00", c: "yes" });
  });

  it("a company with no amount entered escalates with a null amount snapshot (nothing is invented); a repeat is refused as before", async () => {
    expect(await actions.escalateForReview({ companyId: BETA, reason: "No response to three reminders." })).toEqual({ ok: true });
    const row = (await pg.query<{ c: string | null; a: string | null }>(`select confirmation_at_escalation c, confirmed_amount_at_escalation::text a from collection_escalations where company_id = $1 and status = 'open'`, [BETA])).rows[0]!;
    expect(row).toEqual({ c: null, a: null });
    expect((await actions.escalateForReview({ companyId: BETA, reason: "Again." })).ok).toBe(false);
    expect(await count(`select count(*)::int n from collection_escalations where company_id = $1`, [BETA])).toBe(1);
  });

  it("the Tracker page hands every Tracker user the current amount (and nothing of commitments), and refuses without collection.view", async () => {
    const { isValidElement } = await import("react");
    const { default: Page } = await import("@/app/(collection-module)/collection/tracker/page");
    const findProps = (node: unknown, name: string): Record<string, unknown> | null => {
      if (!isValidElement(node)) return null;
      const el = node as { type: unknown; props: Record<string, unknown> & { children?: unknown } };
      if (typeof el.type === "function" && (el.type as { name?: string }).name === name) return el.props;
      const kids = el.props.children;
      for (const k of Array.isArray(kids) ? kids : [kids]) {
        const f = findProps(k, name);
        if (f) return f;
      }
      return null;
    };
    as(viewer);
    const props = findProps(await Page(), "CollectionTracker")!;
    const rows = props.rows as { partyName: string; confirmedAmount: { amount: string; recordedByName: string | null } | null; confirmation: { value: string } | null }[];
    expect(rows.find((r) => r.partyName === "Alpha Traders")!.confirmedAmount).toMatchObject({ amount: "26000.00", recordedByName: "Asha" });
    expect(rows.find((r) => r.partyName === "Alpha Traders")!.confirmation).toMatchObject({ value: "yes" });
    expect(rows.find((r) => r.partyName === "Beta Works")!.confirmedAmount).toBeNull();
    expect(props).toMatchObject({ canSetConfirmation: false, amountStorageReady: true });
    expect(JSON.stringify(props.rows)).not.toMatch(/committed|commitment/i);
    await pg.query(`update field_permission_grants set allowed = false where field_key = 'collection.view' and subject_id = $1`, [viewer]);
    await expect(Page()).rejects.toThrow("Forbidden");
    await pg.query(`update field_permission_grants set allowed = true where field_key = 'collection.view' and subject_id = $1`, [viewer]);
  });
});
